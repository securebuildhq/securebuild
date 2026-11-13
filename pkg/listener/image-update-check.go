package listener

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	apkopackage "chainguard.dev/apko/pkg/apk/apk"
	apkotypes "chainguard.dev/apko/pkg/build/types"
	"github.com/Masterminds/semver"
	"github.com/google/go-github/v61/github"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/securebuildhq/securebuild/pkg/buildpriority"
	"github.com/securebuildhq/securebuild/pkg/gitspec"
	"github.com/securebuildhq/securebuild/pkg/image"
	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/package_family"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"gopkg.in/yaml.v3"
)

type ImageUpdateCheckPayload struct {
	ImageID   string   `json:"imageId"`
	Tag       string   `json:"tag"`
	ImageTags []string `json:"imageTags,omitempty"`
}

func deduplicateImageTags(tags []string) []string {
	seen := make(map[string]struct{}, len(tags))
	result := make([]string, 0, len(tags))
	for _, tag := range tags {
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		result = append(result, tag)
	}
	return result
}

func hasNewImageTags(existingTags, requestedTags []string) bool {
	existing := make(map[string]struct{}, len(existingTags))
	for _, tag := range existingTags {
		existing[tag] = struct{}{}
	}
	for _, tag := range requestedTags {
		if _, ok := existing[tag]; !ok {
			return true
		}
	}
	return false
}

func isReusableImageBuildStatus(status string) bool {
	switch imagetypes.ImageBuildStatus(status) {
	case imagetypes.ImageBuildStatusQueued,
		imagetypes.ImageBuildStatusBuilding,
		imagetypes.ImageBuildStatusTesting,
		imagetypes.ImageBuildStatusPublishing,
		imagetypes.ImageBuildStatusSuccess:
		return true
	default:
		return false
	}
}

// assignImageAPKOTags makes targetApkoID the sole owner of tags within an image.
func assignImageAPKOTags(ctx context.Context, imageID, targetApkoID string, tags []string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tag assignment transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	err = image.RemoveAPKOTags(ctx, tx, imageID, targetApkoID, tags)
	if err != nil {
		return fmt.Errorf("remove tags from previous APKOs: %w", err)
	}

	commandTag, err := tx.Exec(ctx, `
		UPDATE image_apko SET tags = $1, name = $2, updated_at = NOW(), version_sort_key = $5, version_sort_tags = $1
		WHERE id = $3 AND image_id = $4
	`, tags, tags[0], targetApkoID, imageID, buildpriority.VersionKey(tags...))
	if err != nil {
		return fmt.Errorf("update target APKO tags: %w", err)
	}
	if commandTag.RowsAffected() != 1 {
		return fmt.Errorf("target APKO %s not found for image %s", targetApkoID, imageID)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tag assignment transaction: %w", err)
	}
	return nil
}

func handleImageUpdateCheck(ctx context.Context, payload string) error {
	logger.Debug("handleImageUpdateCheck called", zap.String("payload", payload))

	var p ImageUpdateCheckPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return fmt.Errorf("failed to unmarshal image update check payload: %w", err)
	}

	logger.Info("Handling image update check",
		zap.String("image_id", p.ImageID),
		zap.String("tag", p.Tag))

	img, err := image.GetImage(ctx, p.ImageID)
	if err != nil {
		return fmt.Errorf("failed to get image %s: %w", p.ImageID, err)
	}

	if img.GitRemote == "" {
		return NewNonRetryableError(fmt.Errorf("image '%s' is not linked to a git repository", img.Name))
	}

	if img.ApkoFilePath == "" {
		return NewNonRetryableError(fmt.Errorf("image '%s' has no apko_file_path set", img.Name))
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
		logger.Warn("No GitHub API token found, using unauthenticated client")
	}

	return performImageUpdateCheck(ctx, githubClient, img, p.Tag, p.ImageTags)
}

func performImageUpdateCheck(ctx context.Context, githubClient *github.Client, img *imagetypes.Image, tag string, additionalTags []string) error {
	gitRemote := img.GitRemote
	apkoFilePath := img.ApkoFilePath

	logger.Info("Performing image update check",
		zap.String("image_id", img.ID),
		zap.String("image_name", img.Name),
		zap.String("git_remote", gitRemote),
		zap.String("tag", tag))

	// The template-generated tag is always present. Additional tags may repeat it
	// (or each other), so normalize the complete desired tag set before assigning it.
	imageTags := deduplicateImageTags(append([]string{
		package_family.GenerateImageTag(img.TagTemplate, tag),
	}, additionalTags...))

	// Resolve the tag to a commit SHA
	currentSHA, err := gitspec.ResolveTagToCommit(ctx, githubClient, gitRemote, tag)
	if err != nil {
		return fmt.Errorf("failed to resolve tag '%s' to commit: %w", tag, err)
	}

	// Check if an image_apko with this tag already exists for this image
	var existingApkoID string
	var existingImageTags []string
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	err = conn.QueryRow(ctx,
		`SELECT id, tags FROM image_apko WHERE image_id = $1 AND git_tag = $2`,
		img.ID, tag).Scan(&existingApkoID, &existingImageTags)

	if err != nil && err != pgx.ErrNoRows {
		return fmt.Errorf("failed to check for existing APKO: %w", err)
	}

	if existingApkoID != "" {
		imageTagsAdded := hasNewImageTags(existingImageTags, imageTags)
		if err := assignImageAPKOTags(ctx, img.ID, existingApkoID, imageTags); err != nil {
			return fmt.Errorf("failed to assign image tags: %w", err)
		}

		// APKO exists — check if the SHA matches
		latestVersion, err := image.GetLatestImageAPKOVersion(ctx, existingApkoID)
		if err != nil {
			return fmt.Errorf("failed to get latest APKO version: %w", err)
		}

		versionID, err := refreshLinkedApko(ctx, githubClient, &imagetypes.ImageAPKO{
			ID: existingApkoID, GitRemote: gitRemote, GitTag: tag,
			ApkoFilePath: apkoFilePath, LatestVersion: latestVersion,
		}, currentSHA)
		if err != nil {
			return fmt.Errorf("refresh linked APKO: %w", err)
		}
		existingBuild, err := image.GetLatestImageBuildByImageApkoVersionID(ctx, versionID)
		if err == nil && existingBuild != nil && !imageTagsAdded && isReusableImageBuildStatus(existingBuild.Status) {
			resultJSON, _ := json.Marshal(map[string]string{"image_build_id": existingBuild.ID})
			SetResult(ctx, resultJSON)
			return nil
		}
		if err := queueImageBuildForAPKO(ctx, existingApkoID); err != nil {
			return fmt.Errorf("failed to queue image build: %w", err)
		}
		newBuild, err := image.GetLatestImageBuildByImageApkoVersionID(ctx, versionID)
		if err != nil {
			return fmt.Errorf("get queued image build: %w", err)
		}
		resultJSON, _ := json.Marshal(map[string]string{"image_build_id": newBuild.ID})
		SetResult(ctx, resultJSON)
		return nil
	}

	// No existing APKO — create new one
	apkoSpec, err := gitspec.PullSpecFromGit(ctx, githubClient, gitRemote, apkoFilePath, tag)
	if err != nil {
		return fmt.Errorf("pull APKO spec from git: %w", err)
	}

	// Find the core package and pin it
	pinnedYAML, packageID, pinnedVersion, err := pinCorePackageForImage(ctx, conn, gitRemote, apkoSpec.Content, tag)
	if err != nil {
		return fmt.Errorf("pin core package for image %s: %w", img.Name, err)
	}

	// Create image_apko + image_apko_version + image_package
	apkoID, err := createLinkedImageAPKO(ctx, img.ID, gitRemote, apkoFilePath, tag, apkoSpec.CommitSHA, imageTags, pinnedYAML, packageID, pinnedVersion)
	if err != nil {
		return fmt.Errorf("failed to create linked image APKO: %w", err)
	}

	// Queue the image build
	if err := queueImageBuildForAPKO(ctx, apkoID); err != nil {
		return fmt.Errorf("failed to queue image build: %w", err)
	}

	// Get the image_build_id we just created
	latestVersion, err := image.GetLatestImageAPKOVersion(ctx, apkoID)
	if err != nil {
		return fmt.Errorf("failed to get latest APKO version: %w", err)
	}

	imageBuildID := ""
	newBuild, err := image.GetLatestImageBuildByImageApkoVersionID(ctx, latestVersion.ID)
	if err == nil && newBuild != nil {
		imageBuildID = newBuild.ID
	}

	resultJSON, _ := json.Marshal(map[string]string{
		"image_build_id": imageBuildID,
	})
	SetResult(ctx, resultJSON)

	return nil
}

// pinCorePackageForImage finds the core package for an image by looking up package families
// with the same git_remote, then pins the package version in the APKO YAML.
// Both the package lookup and APK pin use the normalized version stored by Melange.
// Returns the pinned YAML, package ID, and Melange package version string.
func pinCorePackageForImage(ctx context.Context, conn *pgxpool.Conn, gitRemote, apkoYAML, tag string) (string, string, string, error) {
	// Find package families with the same git_remote
	rows, err := conn.Query(ctx, `
		SELECT id, name, package_name_template, image_tag_template
		FROM package_family
		WHERE git_remote = $1
	`, gitRemote)
	if err != nil {
		return "", "", "", fmt.Errorf("failed to query package families: %w", err)
	}
	defer rows.Close()

	type familyInfo struct {
		ID                  string
		Name                string
		PackageNameTemplate string
		ImageTagTemplate    sql.NullString
	}

	var families []familyInfo
	for rows.Next() {
		var fi familyInfo
		if err := rows.Scan(&fi.ID, &fi.Name, &fi.PackageNameTemplate, &fi.ImageTagTemplate); err != nil {
			return "", "", "", fmt.Errorf("read package family: %w", err)
		}
		families = append(families, fi)
	}

	if err := rows.Err(); err != nil {
		return "", "", "", fmt.Errorf("read package families: %w", err)
	}
	rows.Close()
	if len(families) == 0 {
		// Standalone image repositories have no package version to derive from their tag.
		return apkoYAML, "", "", nil
	}

	version, err := semver.NewVersion(tag)
	if err != nil {
		return apkoYAML, "", "", fmt.Errorf("parse git tag %q as semver: %w", tag, err)
	}
	melangeVersion, err := gitspec.VersionFromTag(tag)
	if err != nil {
		return apkoYAML, "", "", fmt.Errorf("derive package pin from git tag: %w", err)
	}

	// For each family, find the package version matching the tag
	// and collect possible package names for pinning
	possibleNames := make(map[string]struct{})
	var packageID string
	var pinnedVersion string

	for _, fi := range families {
		// Generate the exact package name from the template
		packageName := package_family.GeneratePackageName(fi.PackageNameTemplate, fi.Name, int(version.Major()), int(version.Minor()))

		// Find the package by exact name and version matching the tag
		var pkgID string
		var pkgName string
		var pkgVersionID string

		err = conn.QueryRow(ctx, `
			SELECT p.id, p.name, pv.id
			FROM package p
			INNER JOIN package_version pv ON p.id = pv.package_id
			WHERE p.name = $1
			  AND pv.version = $2
			  AND p.parent_id IS NULL
			ORDER BY pv.apk_release DESC
			LIMIT 1
		`, packageName, melangeVersion).Scan(&pkgID, &pkgName, &pkgVersionID)

		if err != nil {
			if err == pgx.ErrNoRows {
				continue
			}
			return "", "", "", fmt.Errorf("find package for tag %s: %w", tag, err)
		}

		possibleNames[fi.Name] = struct{}{}
		possibleNames[pkgName] = struct{}{}

		providesRows, err := conn.Query(ctx, `
			SELECT package_name, provides_name FROM package_version_provides WHERE package_version_id = $1
		`, pkgVersionID)
		if err != nil {
			return "", "", "", fmt.Errorf("query package provides: %w", err)
		}
		for providesRows.Next() {
			var pn, providesName string
			if err := providesRows.Scan(&pn, &providesName); err != nil {
				providesRows.Close()
				return "", "", "", fmt.Errorf("read package provides: %w", err)
			}
			possibleNames[pn] = struct{}{}
			possibleNames[providesName] = struct{}{}
		}
		if err := providesRows.Err(); err != nil {
			providesRows.Close()
			return "", "", "", fmt.Errorf("read package provides: %w", err)
		}
		providesRows.Close()

		packageID = pkgID
		pinnedVersion = melangeVersion
	}

	if packageID == "" {
		return apkoYAML, "", "", fmt.Errorf("no matching package found for tag %s in families with git_remote %s", tag, gitRemote)
	}

	var imageConfig apkotypes.ImageConfiguration
	if err := yaml.Unmarshal([]byte(apkoYAML), &imageConfig); err != nil {
		return "", "", "", fmt.Errorf("parse linked APKO: %w", err)
	}
	matched := false
	for _, pkg := range imageConfig.Contents.Packages {
		if _, ok := possibleNames[apkopackage.ResolvePackageNameVersionPin(pkg).Name]; ok {
			matched = true
			break
		}
	}
	if !matched {
		return "", "", "", fmt.Errorf("no core package found in linked APKO for tag %s", tag)
	}

	pinnedYAML, err := pinCorePackageInApkoYAML(apkoYAML, possibleNames, pinnedVersion, true)
	if err != nil {
		return apkoYAML, packageID, pinnedVersion, fmt.Errorf("failed to pin core package: %w", err)
	}

	return pinnedYAML, packageID, pinnedVersion, nil
}
