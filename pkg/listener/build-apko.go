package listener

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/go-github/v61/github"
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

type BuildAPKOPayload struct {
	ImageID string `json:"imageId"`
	APKOID  string `json:"apkoId"`
}

// handleBuildAPKO orchestrates the build process for a single APKO configuration
func handleBuildAPKO(ctx context.Context, payload string) error {
	var buildAPKOPayload BuildAPKOPayload
	if err := json.Unmarshal([]byte(payload), &buildAPKOPayload); err != nil {
		return fmt.Errorf("failed to unmarshal build apko payload: %w", err)
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

	// For linked APKOs, check if the git tag has been reassigned to a new commit.
	// If so, create a new image_apko_version with the updated spec before building.
	apkoVersionID, err := checkAndRefreshLinkedApko(ctx, targetAPKO)
	if err != nil {
		logger.Warn("failed to check/refresh linked APKO, proceeding with existing version",
			zap.String("apkoId", targetAPKO.ID),
			zap.Error(err))
		apkoVersionID = targetAPKO.LatestVersion.ID
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

// checkAndRefreshLinkedApko checks if a linked APKO's git tag has been reassigned to a
// new commit SHA. If so, it pulls the updated APKO spec from git and creates a new
// image_apko_version row. Returns the image_apko_version ID to use for the build.
// For non-linked APKOs, returns the existing latest version ID unchanged.
func checkAndRefreshLinkedApko(ctx context.Context, apko *imagetypes.ImageAPKO) (string, error) {
	if apko.GitTag == "" || apko.GitRemote == "" {
		return apko.LatestVersion.ID, nil
	}

	var githubClient *github.Client
	if githubToken := param.GetParam(ctx).UpdaterGithubAPIToken; githubToken != "" {
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

	// Compare to the recorded SHA on the latest version
	if currentSHA == apko.LatestVersion.GitCommitSHA {
		logger.Debug("linked APKO git tag unchanged, no refresh needed",
			zap.String("apkoId", apko.ID),
			zap.String("git_tag", apko.GitTag),
			zap.String("commit_sha", currentSHA))
		return apko.LatestVersion.ID, nil
	}

	logger.Info("linked APKO git tag reassigned, creating new version",
		zap.String("apkoId", apko.ID),
		zap.String("git_tag", apko.GitTag),
		zap.String("old_sha", apko.LatestVersion.GitCommitSHA),
		zap.String("new_sha", currentSHA))

	// Pull the updated APKO spec from git
	apkoFilePath := apko.ApkoFilePath
	if apkoFilePath == "" {
		apkoFilePath = apko.LatestVersion.ApkoFilePath
	}

	specContent, err := gitspec.PullSpecFromGit(ctx, githubClient, apko.GitRemote, apkoFilePath, apko.GitTag)
	if err != nil {
		return apko.LatestVersion.ID, fmt.Errorf("pull apko spec from git: %w", err)
	}

	// Create a new image_apko_version row
	newVersionID, err := securerandom.Hex(32)
	if err != nil {
		return apko.LatestVersion.ID, fmt.Errorf("generate version id: %w", err)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	_, err = conn.Exec(ctx, `
		INSERT INTO image_apko_version (id, image_apko_id, apko_yaml, created_at, updated_at, git_remote, apko_file_path, git_commit_sha)
		VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, $6)
	`, newVersionID, apko.ID, specContent.Content, apko.GitRemote, apkoFilePath, currentSHA)
	if err != nil {
		return apko.LatestVersion.ID, fmt.Errorf("insert new image_apko_version: %w", err)
	}

	logger.Info("created new image_apko_version for linked APKO",
		zap.String("apkoId", apko.ID),
		zap.String("newVersionId", newVersionID),
		zap.String("commit_sha", currentSHA))

	return newVersionID, nil
}
