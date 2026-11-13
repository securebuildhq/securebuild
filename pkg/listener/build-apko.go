package listener

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/go-github/v61/github"
	"github.com/securebuildhq/securebuild/pkg/apk"
	"github.com/securebuildhq/securebuild/pkg/gitspec"
	image "github.com/securebuildhq/securebuild/pkg/image"
	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

var ErrRepositoryPackageUnavailable = errors.New("package is not available in the APK repository")

const (
	repositoryPublicationRetryInterval = 10 * time.Second
	// Publication is asynchronous and batched. Allow an indexing backlog or
	// repository outage to recover without keeping a worker or builder occupied.
	repositoryPublicationTimeout = 30 * time.Minute
)

type BuildAPKOTriggerPackage struct {
	Name       string `json:"name"`
	Version    string `json:"version"`
	APKRelease int    `json:"apkRelease"`
}

type BuildAPKOPayload struct {
	ImageID        string                   `json:"imageId"`
	APKOID         string                   `json:"apkoId"`
	TriggerPackage *BuildAPKOTriggerPackage `json:"triggerPackage,omitempty"`
}

// handleBuildAPKO orchestrates the build process for a single APKO configuration
func handleBuildAPKO(ctx context.Context, payload string) error {
	var buildAPKOPayload BuildAPKOPayload
	if err := json.Unmarshal([]byte(payload), &buildAPKOPayload); err != nil {
		return fmt.Errorf("failed to unmarshal build apko payload: %w", err)
	}

	if buildAPKOPayload.TriggerPackage != nil {
		if err := checkPackagePublication(ctx, *buildAPKOPayload.TriggerPackage); err != nil {
			return err
		}
	}

	logger.Info("building single APKO",
		zap.String("imageId", buildAPKOPayload.ImageID),
		zap.String("apkoId", buildAPKOPayload.APKOID))

	img, err := image.GetImage(ctx, buildAPKOPayload.ImageID)
	if err != nil {
		return fmt.Errorf("failed to get image: %w", err)
	}

	// Find the specific APKO to build
	var targetAPKO *imagetypes.ImageAPKO
	for _, apko := range img.APKOs {
		if apko.ID == buildAPKOPayload.APKOID {
			targetAPKO = apko
			break
		}
	}

	if targetAPKO == nil {
		return fmt.Errorf("APKO with ID %s not found in image %s", buildAPKOPayload.APKOID, buildAPKOPayload.ImageID)
	}

	// Refresh linked recipes and restore their package pins before building.
	apkoVersionID, err := checkAndRefreshLinkedApko(ctx, targetAPKO)
	if err != nil {
		return fmt.Errorf("refresh linked APKO %s: %w", targetAPKO.ID, err)
	}

	// Create image build record for the specific APKO version
	imageBuild, err := image.CreateImageBuild(ctx, apkoVersionID)
	if err != nil {
		return fmt.Errorf("failed to create image build record for APKO %s: %w", targetAPKO.ID, err)
	}

	logger.Debug("created image build record for single APKO",
		zap.String("buildID", imageBuild.ID),
		zap.String("imageApkoVersionID", targetAPKO.LatestVersion.ID),
		zap.String("imageName", img.Name),
		zap.String("apkoID", targetAPKO.ID))

	// Update status to queued
	if err := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusQueued); err != nil {
		logger.Warn("failed to update image build status to queued", zap.Error(err))
	}

	// Assign VM for image building
	vmID, workDir, err := assignVMForImageBuild(ctx, imageBuild.ID)
	if err != nil {
		logger.Warn("IMAGE BUILD FAILED: VM assignment failure - could not assign VM for image build",
			zap.String("imageApkoVersionID", targetAPKO.LatestVersion.ID),
			zap.String("imageName", img.Name),
			zap.String("buildID", imageBuild.ID),
			zap.String("apkoID", targetAPKO.ID),
			zap.Error(err))

		// Mark build as failed
		if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("VM assignment failure: %w", err)); statusErr != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
		}

		return fmt.Errorf("failed to assign VM for build: %w", err)
	}

	// Update build record with VM ID
	if err := image.SetImageBuildBuilderID(ctx, imageBuild.ID, vmID); err != nil {
		logger.Warn("failed to set image build builder ID", zap.Error(err))
	}

	// Queue the image building with VM assigned
	buildImageWithVMAssignedPayload := BuildImageWithVMAssignedPayload{
		VMID:    vmID,
		BuildID: imageBuild.ID,
		WorkDir: workDir,
	}

	marshalledPayload, err := json.Marshal(buildImageWithVMAssignedPayload)
	if err != nil {
		// Mark build as failed
		if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("JSON marshalling failure: %w", err)); statusErr != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
		}
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	if err := persistence.EnqueueWork(ctx, "build_image_with_vm_assigned", string(marshalledPayload)); err != nil {
		// Mark build as failed
		if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("work queue enqueue failure: %w", err)); statusErr != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
		}
		return fmt.Errorf("failed to enqueue work: %w", err)
	}

	return nil
}

// checkPackagePublication checks the exact triggering package revision in both
// public indexes before the image build record or VM assignment is created.
func checkPackagePublication(ctx context.Context, trigger BuildAPKOTriggerPackage) error {
	available, err := apk.RepositoryContainsPackage(
		ctx,
		param.GetParam(ctx).ApkRepository,
		trigger.Name,
		trigger.Version,
		trigger.APKRelease,
	)
	if err != nil {
		err = fmt.Errorf("check triggering package in APK repository: %w", err)
		if errors.Is(err, apk.ErrInvalidRepositoryRequest) {
			return NewNonRetryableError(err)
		}
		return NewRetryAfterError(err, repositoryPublicationRetryInterval, repositoryPublicationTimeout)
	}
	if !available {
		return NewRetryAfterError(fmt.Errorf(
			"%w: %s=%s-r%d",
			ErrRepositoryPackageUnavailable,
			trigger.Name,
			trigger.Version,
			trigger.APKRelease,
		), repositoryPublicationRetryInterval, repositoryPublicationTimeout)
	}
	return nil
}

// checkAndRefreshLinkedApko refreshes moved tags and repairs missing package pins.
// Non-linked recipes retain their existing version.
func checkAndRefreshLinkedApko(ctx context.Context, apko *imagetypes.ImageAPKO) (string, error) {
	if apko.GitTag == "" || apko.GitRemote == "" {
		return apko.LatestVersion.ID, nil
	}

	var githubClient *github.Client
	if override := getGithubClientOverride(ctx); override != nil {
		githubClient = override
	} else if githubToken := param.GetParam(ctx).UpdaterGithubAPIToken; githubToken != "" {
		ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: githubToken})
		tc := oauth2.NewClient(ctx, ts)
		githubClient = github.NewClient(tc)
	} else {
		githubClient = github.NewClient(nil)
	}

	// Resolve the current git tag to a commit SHA
	currentSHA, err := gitspec.ResolveTagToCommit(ctx, githubClient, apko.GitRemote, apko.GitTag)
	if err != nil {
		return apko.LatestVersion.ID, fmt.Errorf("resolve tag to commit: %w", err)
	}

	return refreshLinkedApko(ctx, githubClient, apko, currentSHA)
}

// refreshLinkedApko validates the stored recipe even when the Git SHA is unchanged.
// A repaired recipe gets a new revision so old builds cannot satisfy a new request.
func refreshLinkedApko(ctx context.Context, githubClient *github.Client, apko *imagetypes.ImageAPKO, currentSHA string) (string, error) {
	apkoFilePath := apko.ApkoFilePath
	if apkoFilePath == "" {
		apkoFilePath = apko.LatestVersion.ApkoFilePath
	}
	apkoYAML := apko.LatestVersion.APKOYAML
	if currentSHA != apko.LatestVersion.GitCommitSHA {
		specContent, err := gitspec.PullSpecFromGit(ctx, githubClient, apko.GitRemote, apkoFilePath, apko.GitTag)
		if err != nil {
			return "", fmt.Errorf("pull apko spec from git: %w", err)
		}
		apkoYAML = specContent.Content
		currentSHA = specContent.CommitSHA
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	pinnedYAML, packageID, pinnedVersion, err := pinCorePackageForImage(ctx, conn, apko.GitRemote, apkoYAML, apko.GitTag)
	if err != nil {
		return "", fmt.Errorf("pin linked APKO %s: %w", apko.ID, err)
	}
	if currentSHA == apko.LatestVersion.GitCommitSHA && pinnedYAML == apko.LatestVersion.APKOYAML {
		return apko.LatestVersion.ID, nil
	}

	newVersionID, err := securerandom.Hex(32)
	if err != nil {
		return "", fmt.Errorf("generate version id: %w", err)
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin APKO refresh: %w", err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
		INSERT INTO image_apko_version (id, image_apko_id, apko_yaml, created_at, updated_at, git_remote, apko_file_path, git_commit_sha)
		VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, $6)
	`, newVersionID, apko.ID, pinnedYAML, apko.GitRemote, apkoFilePath, currentSHA)
	if err != nil {
		return "", fmt.Errorf("insert new image_apko_version: %w", err)
	}
	if packageID != "" {
		_, err = tx.Exec(ctx, `
			INSERT INTO image_package (image_id, apko_id, package_id, pinned_version)
			SELECT image_id, id, $2, $3 FROM image_apko WHERE id = $1
			ON CONFLICT (apko_id, package_id) DO UPDATE SET pinned_version = EXCLUDED.pinned_version
		`, apko.ID, packageID, pinnedVersion)
		if err != nil {
			return "", fmt.Errorf("update linked image package: %w", err)
		}
	}
	testID, err := securerandom.Hex(32)
	if err != nil {
		return "", fmt.Errorf("generate image test id: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO image_test (id, apko_id, apko_version_id, yaml_content, description)
		SELECT $1, apko_id, $2, yaml_content, description FROM image_test WHERE apko_version_id = $3
	`, testID, newVersionID, apko.LatestVersion.ID)
	if err != nil {
		return "", fmt.Errorf("copy image test: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit APKO refresh: %w", err)
	}
	logger.Info("refreshed linked APKO with package pins",
		zap.String("apkoId", apko.ID),
		zap.String("newVersionId", newVersionID),
		zap.String("commit_sha", currentSHA))
	return newVersionID, nil
}
