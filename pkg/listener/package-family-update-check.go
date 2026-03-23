package listener

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	apkopackage "chainguard.dev/apko/pkg/apk/apk"
	apkotypes "chainguard.dev/apko/pkg/build/types"
	"chainguard.dev/melange/pkg/config"
	"github.com/Masterminds/semver"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-github/v61/github"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/securebuildhq/securebuild/pkg/image"
	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/package_family"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/releasemonitor"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"gopkg.in/yaml.v3"
)

type PackageFamilyUpdateCheckPayload struct {
	PackageFamilyID string `json:"packageFamilyId"`
}

type GitHubVersionResult struct {
	Version string
	Commit  string
}

type VersionChangeType int

const (
	VersionChangeMinor VersionChangeType = iota // Includes both major and minor changes
	VersionChangePatch
)

// classifyVersionChange determines if a version change is major/minor or patch
func classifyVersionChange(oldVer, newVer *semver.Version) VersionChangeType {
	if oldVer.Major() != newVer.Major() || oldVer.Minor() != newVer.Minor() {
		return VersionChangeMinor
	}
	return VersionChangePatch
}

type UpdateResult struct {
	PackageID           string
	PackageVersionID    string
	ImageAPKOs          []*ImageAPKOInfo
	CreateNewPackage    bool    // True for minor versions (use package_create), false for patch versions
	MelangeYAML         string  // For minor versions: melange YAML to create
	AdditionalFilesData *string // For minor versions: encoded additional files data
	SkipBuild           bool    // True for APKO-only generation (no package rebuild needed)
	UseRoot             bool    // Template use_root setting to copy
	CustomDiskSize      *int    // Template custom_disk_size setting to copy
}

type ImageAPKOInfo struct {
	ImageID string
	ApkoID  string
}

type PackageVersionInfo struct {
	PackageName string
	Version     string
}

type VersionUpdate struct {
	Version          *semver.Version
	UpdateForPackage string // Package name this is updating (e.g., "replicated-sdk-1.8")
	UpdateForVersion string // Version this is updating (e.g., "1.8.0")
	OnlyNeedsAPKOs   bool   // True if the package version exists but just needs image APKOs generated
}

func handlePackageFamilyUpdateCheck(ctx context.Context, payload string) error {
	logger.Debug("handlePackageFamilyUpdateCheck called", zap.String("payload", payload))

	var p PackageFamilyUpdateCheckPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return fmt.Errorf("failed to unmarshal package family update check payload: %w", err)
	}

	logger.Info("Handling package family update check", zap.String("package_family_id", p.PackageFamilyID))

	// Track error and update database at the end
	checkErr := performPackageFamilyUpdateCheck(ctx, &p)

	// Update last_check_at and last_error in database
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	if checkErr != nil {
		// Update with error
		if _, err := conn.Exec(ctx, `
			UPDATE package_family
			SET last_check_at = NOW(),
			    last_error = $1
			WHERE id = $2
		`, checkErr.Error(), p.PackageFamilyID); err != nil {
			logger.Warn("Failed to update package family error status",
				zap.String("package_family_id", p.PackageFamilyID),
				zap.Error(err))
		}
		return checkErr
	}

	// Clear error on success
	if _, err := conn.Exec(ctx, `
		UPDATE package_family
		SET last_check_at = NOW(),
		    last_error = NULL
		WHERE id = $1
	`, p.PackageFamilyID); err != nil {
		logger.Warn("Failed to update package family success status",
			zap.String("package_family_id", p.PackageFamilyID),
			zap.Error(err))
	}

	return nil
}

func performPackageFamilyUpdateCheck(ctx context.Context, p *PackageFamilyUpdateCheckPayload) error {
	logger.Info("Performing package family update check", zap.String("package_family_id", p.PackageFamilyID))

	packageFamily, err := package_family.GetPackageFamily(ctx, p.PackageFamilyID)
	if err != nil {
		return fmt.Errorf("failed to get package family %s: %w", p.PackageFamilyID, err)
	}

	// Skip if monitoring is disabled
	if !packageFamily.MonitoringEnabled {
		logger.Info("Package family monitoring disabled, skipping check", zap.String("package_family_id", p.PackageFamilyID))
		return nil
	}

	// Log automation mode
	if packageFamily.DryRunMode {
		logger.Info("Package family in dry run mode", zap.String("package_family_id", p.PackageFamilyID))
	}

	// Get the current highest version for this family to extract upstream config
	currentVersion := getCurrentVersionFromDatabase(ctx, packageFamily)
	if currentVersion == nil {
		return fmt.Errorf("no existing packages found for family %s", packageFamily.Name)
	}

	// Determine the package name from current version
	templatePackageName := package_family.GeneratePackageName(packageFamily.PackageNameTemplate, packageFamily.Name, int(currentVersion.Major()), int(currentVersion.Minor()))

	// Get the latest revision of that package version
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var templateMelangeYAML string
	var templateVersion string
	err = conn.QueryRow(ctx, `
		SELECT pv.melange_yaml, pv.version
		FROM package p
		INNER JOIN package_version pv ON p.id = pv.package_id
		WHERE p.name = $1 AND pv.version = $2
		ORDER BY pv.apk_release DESC
		LIMIT 1`,
		templatePackageName, currentVersion.Original()).Scan(&templateMelangeYAML, &templateVersion)
	if err != nil {
		return fmt.Errorf("failed to find template package version for %s version %s: %w", templatePackageName, currentVersion.Original(), err)
	}

	logger.Info("Found template package for upstream config",
		zap.String("template_package_name", templatePackageName),
		zap.String("template_version", templateVersion))

	// Compile the melange YAML to get upstream configuration
	compiled, err := sbpackage.CompileMelangeYAML(ctx, []byte(templateMelangeYAML))
	if err != nil {
		return fmt.Errorf("failed to compile melange yaml: %w", err)
	}

	// Extract upstream configuration from compiled melange YAML
	var versionUpdates []*VersionUpdate

	if compiled.Update.GitHubMonitor != nil {
		// Create GitHub client with authentication
		var githubClient *github.Client
		if githubToken := param.GetParam(ctx).UpdaterGithubAPIToken; githubToken != "" {
			ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: githubToken})
			tc := oauth2.NewClient(ctx, ts)
			githubClient = github.NewClient(tc)
			logger.Info("Using authenticated GitHub client")
		} else {
			githubClient = github.NewClient(nil)
			logger.Warn("No GitHub API token found, using unauthenticated client")
		}

		logger.Info("Checking for package family updates via GitHub",
			zap.String("id", packageFamily.ID),
			zap.String("name", packageFamily.Name),
			zap.String("upstream_identifier", compiled.Update.GitHubMonitor.Identifier),
			zap.Bool("use_tags", compiled.Update.GitHubMonitor.UseTags),
		)

		// Get and filter versions using regex pattern
		versionUpdates, err = fetchAndFilterVersionsFromGithub(ctx, githubClient, packageFamily, compiled)
		if err != nil {
			logger.Error(fmt.Errorf("failed to fetch versions for package family %s: %w", p.PackageFamilyID, err))
			return fmt.Errorf("failed to fetch versions: %w", err)
		}
	} else if compiled.Update.ReleaseMonitor != nil {
		logger.Info("Checking for package family updates via release-monitor",
			zap.String("id", packageFamily.ID),
			zap.String("name", packageFamily.Name),
			zap.Int("project_id", compiled.Update.ReleaseMonitor.Identifier),
		)

		// Get and filter versions from release-monitor
		versionUpdates, err = fetchAndFilterVersionsFromReleaseMonitor(ctx, compiled, packageFamily)
		if err != nil {
			logger.Error(fmt.Errorf("failed to fetch versions for package family %s: %w", p.PackageFamilyID, err))
			return fmt.Errorf("failed to fetch versions: %w", err)
		}
	} else {
		return fmt.Errorf("no upstream monitor configuration found in latest version")
	}

	if len(versionUpdates) == 0 {
		logger.Info("No new versions found", zap.String("package_family_id", p.PackageFamilyID))
		return nil
	}

	// Log new versions available
	logger.Info("New versions detected",
		zap.String("package_family_id", p.PackageFamilyID),
		zap.String("family_name", packageFamily.Name),
		zap.Int("new_version_count", len(versionUpdates)),
		zap.Bool("dry_run_mode", packageFamily.DryRunMode),
	)

	// List all new versions found (oldest to newest)
	for i, versionUpdate := range versionUpdates {
		logger.Debug("New version available",
			zap.Int("rank", i+1),
			zap.String("version", versionUpdate.Version.Original()),
			zap.Int64("major", int64(versionUpdate.Version.Major())),
			zap.Int64("minor", int64(versionUpdate.Version.Minor())),
			zap.Int64("patch", int64(versionUpdate.Version.Patch())),
		)
	}

	// Process each detected version (collect results, don't queue builds)
	var updateResults []*UpdateResult
	for _, versionUpdate := range versionUpdates {
		result, err := processPackageFamilyVersion(ctx, packageFamily, versionUpdate)
		if err != nil {
			logger.Error(fmt.Errorf("failed to process version %s for family %s: %w",
				versionUpdate.Version.Original(), p.PackageFamilyID, err))
			// Continue processing other versions even if one fails
			continue
		}
		if result != nil {
			updateResults = append(updateResults, result)
		}
	}

	if len(updateResults) == 0 {
		return nil
	}

	// CRITICAL: Reassign tags globally BEFORE queueing any builds
	// This ensures tags are stable before image builds start
	if err := reassignTagsGlobally(ctx, packageFamily, updateResults); err != nil {
		logger.Error(fmt.Errorf("failed to reassign tags globally: %w", err))
		// Continue - builds can still proceed
	}

	// Now queue all builds with stable tag assignments
	for _, result := range updateResults {
		// For APKO-only generation, skip package build but still queue image builds
		if result.SkipBuild {
			logger.Info("Skipping package build - APKO-only generation, queueing image builds",
				zap.String("package_id", result.PackageID),
				zap.String("package_version_id", result.PackageVersionID),
				zap.Int("apko_count", len(result.ImageAPKOs)))

			// Queue image builds for the newly created APKOs
			for _, apkoInfo := range result.ImageAPKOs {
				if err := queueImageBuildForAPKO(ctx, apkoInfo.ApkoID); err != nil {
					logger.Error(fmt.Errorf("failed to queue image build for APKO %s: %w", apkoInfo.ApkoID, err))
					// Continue queuing other image builds
				}
			}
			continue
		}
		if err := queuePackageBuild(ctx, packageFamily, result); err != nil {
			logger.Error(fmt.Errorf("failed to queue build for package %s version %s: %w",
				result.PackageID, result.PackageVersionID, err))
			// Continue queuing other builds
		}
	}

	return nil
}

// processPackageFamilyVersion processes a single detected version for a package family
// Routes to either processMinorVersionUpdate or processPatchVersionUpdate based on version change type
func processPackageFamilyVersion(ctx context.Context, pf *package_family.PackageFamily, versionUpdate *VersionUpdate) (*UpdateResult, error) {
	version := versionUpdate.Version

	// Determine change type based on the "update for" information
	var changeType VersionChangeType

	if versionUpdate.UpdateForVersion == "" {
		// No base version means this is a new minor version
		changeType = VersionChangeMinor
	} else {
		// Parse the base version and classify the change
		baseVersion, err := semver.NewVersion(versionUpdate.UpdateForVersion)
		if err != nil {
			return nil, fmt.Errorf("failed to parse update for version %s: %w", versionUpdate.UpdateForVersion, err)
		}
		changeType = classifyVersionChange(baseVersion, version)
	}

	logger.Info("Classified version change",
		zap.String("package_family", pf.Name),
		zap.String("base_version", versionUpdate.UpdateForVersion),
		zap.String("new_version", version.Original()),
		zap.String("update_for_package", versionUpdate.UpdateForPackage),
		zap.String("change_type", map[VersionChangeType]string{
			VersionChangeMinor: "minor",
			VersionChangePatch: "patch",
		}[changeType]),
		zap.Bool("only_needs_apkos", versionUpdate.OnlyNeedsAPKOs))

	// Handle existing versions that only need APKO generation (no package rebuild)
	if versionUpdate.OnlyNeedsAPKOs {
		logger.Info("Processing existing version that only needs image APKOs",
			zap.String("package_family", pf.Name),
			zap.String("version", version.Original()))

		// Respects dry run mode
		if pf.DryRunMode {
			logger.Warn("DRY RUN: Would generate image APKOs for existing version",
				zap.String("version", version.Original()))
			return nil, nil
		}

		result, err := generateAPKOsForExistingVersion(ctx, pf, version)
		if err != nil {
			return nil, fmt.Errorf("failed to generate APKOs for existing version: %w", err)
		}

		return result, nil
	}

	// Route based on change type
	if changeType == VersionChangeMinor {
		// Minor updates respect dry run mode
		if pf.DryRunMode {
			logger.Warn("DRY RUN: Would process minor version update",
				zap.String("version", version.Original()))
			return nil, nil
		}

		result, err := processMinorVersionUpdate(ctx, pf, version)
		if err != nil {
			return nil, fmt.Errorf("failed to process minor version update: %w", err)
		}

		return result, nil
	}

	// Patch updates bypass dry run but check Update.Enabled flag
	// First get the melange YAML to check the flag
	templatePackageName := package_family.GeneratePackageName(pf.PackageNameTemplate, pf.Name, int(version.Major()), int(version.Minor()))
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var melangeYAML string
	err := conn.QueryRow(ctx, `
		SELECT pv.melange_yaml
		FROM package p
		INNER JOIN package_version pv ON p.id = pv.package_id
		WHERE p.name = $1
		ORDER BY pv.apk_release DESC
		LIMIT 1`,
		templatePackageName).Scan(&melangeYAML)
	if err != nil {
		if err == pgx.ErrNoRows {
			logger.Debug("No melange YAML found for package",
				zap.String("package_name", templatePackageName))
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get melange YAML for Update.Enabled check: %w", err)
	}

	compiled, err := sbpackage.CompileMelangeYAML(ctx, []byte(melangeYAML))
	if err != nil {
		return nil, fmt.Errorf("failed to compile melange YAML: %w", err)
	}

	if !compiled.Update.Enabled {
		logger.Info("Patch updates disabled by Update.Enabled flag",
			zap.String("version", version.Original()))
		return nil, nil
	}

	logger.Debug("Processing patch update (bypasses dry run mode)",
		zap.String("version", version.Original()),
		zap.Bool("update_enabled", compiled.Update.Enabled))

	result, err := processPatchVersionUpdate(ctx, pf, version)
	if err != nil {
		return nil, fmt.Errorf("failed to process patch version update: %w", err)
	}

	return result, nil
}

// processMinorVersionUpdate handles major/minor version updates (creates new packages)
func processMinorVersionUpdate(ctx context.Context, pf *package_family.PackageFamily, version *semver.Version) (*UpdateResult, error) {
	// Generate package name from template
	packageName := package_family.GeneratePackageName(pf.PackageNameTemplate, pf.Name, int(version.Major()), int(version.Minor()))
	logger.Info("Processing minor version update",
		zap.String("package_family", pf.Name),
		zap.String("version", version.Original()),
		zap.String("package_name", packageName),
		zap.Int64("major", int64(version.Major())),
		zap.Int64("minor", int64(version.Minor())),
		zap.Int64("patch", int64(version.Patch())))

	// Check if package already exists
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var existingPackageID string
	err := conn.QueryRow(ctx, `SELECT id FROM package WHERE name = $1`, packageName).Scan(&existingPackageID)
	if err != nil && err != pgx.ErrNoRows {
		return nil, fmt.Errorf("failed to check if package exists: %w", err)
	}

	// Sometimes multiple patch versions will be detected for the same new minor version.
	// If that happens, the first minor version will be created, and the rest will be skipped.
	// The remaining new versions will be added on the next check.
	// This is expected behavior and never unrecoverable.
	// Note: Existing packages that need image APKOs are handled via the OnlyNeedsAPKOs path.
	if existingPackageID != "" {
		return nil, nil
	}

	// Get the current highest version for this family to use as template
	currentVersion := getCurrentVersionFromDatabase(ctx, pf)
	if currentVersion == nil {
		return nil, fmt.Errorf("no existing packages found for family %s to use as template", pf.Name)
	}

	// Determine the package name from current version
	templatePackageName := package_family.GeneratePackageName(pf.PackageNameTemplate, pf.Name, int(currentVersion.Major()), int(currentVersion.Minor()))

	// Get the latest revision of that package version
	var templateMelangeYAML string
	var templateVersion string
	var templatePackageID string
	var templatePackageVersionID string
	var templateUseRoot bool
	var templateCustomDiskSize sql.NullInt32
	err = conn.QueryRow(ctx, `
		SELECT pv.melange_yaml, pv.version, p.id, pv.id, pv.use_root, pv.custom_disk_size
		FROM package p
		INNER JOIN package_version pv ON p.id = pv.package_id
		WHERE p.name = $1 AND pv.version = $2
		ORDER BY pv.apk_release DESC
		LIMIT 1`,
		templatePackageName, currentVersion.Original()).Scan(&templateMelangeYAML, &templateVersion, &templatePackageID, &templatePackageVersionID, &templateUseRoot, &templateCustomDiskSize)
	if err != nil {
		return nil, fmt.Errorf("failed to find template package version for %s version %s: %w", templatePackageName, currentVersion.Original(), err)
	}

	logger.Info("Found template package",
		zap.String("template_package_id", templatePackageID),
		zap.String("template_package_version_id", templatePackageVersionID),
		zap.String("template_package_name", templatePackageName),
		zap.String("template_version", templateVersion))

	// Parse template version to get major.minor
	templateSemver, err := semver.NewVersion(templateVersion)
	if err != nil {
		return nil, fmt.Errorf("failed to parse template version as semver: %w", err)
	}
	oldMajorMinor := fmt.Sprintf("%d.%d", templateSemver.Major(), templateSemver.Minor())
	newMajorMinor := fmt.Sprintf("%d.%d", version.Major(), version.Minor())

	newVersion := version.Original()

	epoch := 0

	// Create GitHub client with authentication for digest updates
	var githubClient *github.Client
	if githubToken := param.GetParam(ctx).UpdaterGithubAPIToken; githubToken != "" {
		ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: githubToken})
		tc := oauth2.NewClient(ctx, ts)
		githubClient = github.NewClient(tc)
	} else {
		githubClient = github.NewClient(nil)
	}

	// Transform the melange YAML for the new minor version
	transformedYAML, err := transformMelangeYAMLForNewMinorVersion(
		ctx,
		templateMelangeYAML,
		templatePackageName, // old package name (e.g., "git-2.50")
		packageName,         // new package name (e.g., "git-2.51")
		templateVersion,     // old version (e.g., "2.50.0")
		newVersion,          // new version (e.g., "2.51.0")
		oldMajorMinor,       // old major.minor (e.g., "2.50")
		newMajorMinor,       // new major.minor (e.g., "2.51")
		epoch,               // epoch/release
		githubClient,        // GitHub client for fetching commit SHAs
	)
	if err != nil {
		return nil, fmt.Errorf("failed to transform melange YAML: %w", err)
	}

	// Generate a new package ID
	newPackageID := generateID()

	// Insert into package table if it doesn't exist
	_, err = conn.Exec(ctx,
		`INSERT INTO package (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
		newPackageID, packageName)
	if err != nil {
		return nil, fmt.Errorf("failed to insert package: %w", err)
	}
	logger.Info("Created new package record",
		zap.String("package_id", newPackageID),
		zap.String("package_name", packageName))

	// Fetch additional files from template package version
	rows, err := conn.Query(ctx, `
		SELECT path, content
		FROM package_version_additional_file
		WHERE package_version_id = $1`,
		templatePackageVersionID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch template additional files: %w", err)
	}
	defer rows.Close()

	var additionalFiles []AdditionalFile

	for rows.Next() {
		var file AdditionalFile
		if err := rows.Scan(&file.Path, &file.Content); err != nil {
			return nil, fmt.Errorf("failed to scan additional file: %w", err)
		}

		// Transform file content to replace version references
		transformedContent := transformAdditionalFileContent(
			file.Content,
			templateVersion,
			newVersion,
			oldMajorMinor,
			newMajorMinor,
		)
		file.Content = transformedContent
		additionalFiles = append(additionalFiles, file)
	}

	// Create tar.gz from additional files and base64 encode
	var additionalFilesDataEncoded *string
	if len(additionalFiles) > 0 {
		tarGzData, err := createTarGzFromFiles(additionalFiles)
		if err != nil {
			return nil, fmt.Errorf("failed to create tar.gz from additional files: %w", err)
		}
		encodedData := base64.StdEncoding.EncodeToString(tarGzData)
		additionalFilesDataEncoded = &encodedData
		logger.Info("Copying additional files from template",
			zap.Int("file_count", len(additionalFiles)),
			zap.String("template_package_version_id", templatePackageVersionID))
	}

	// Link the package to the family if it's a new package
	_, err = conn.Exec(ctx,
		`INSERT INTO package_family_package (package_family_id, package_id, version_major, version_minor, is_template, created_at)
		VALUES ($1, $2, $3, $4, false, NOW())`,
		pf.ID, newPackageID, version.Major(), version.Minor())
	if err != nil {
		// Log error but don't fail - package creation is already queued
		logger.Error(fmt.Errorf("failed to link package %s to family %s: %w", newPackageID, pf.ID, err))
	}

	logger.Info("Prepared package for creation after tag reassignment",
		zap.String("package_name", packageName),
		zap.String("version", version.Original()),
		zap.Int("epoch", epoch),
		zap.String("package_id", newPackageID))

	// Generate new image APKOs for this minor version change
	// The actual package_version will be created by the worker processing package_create
	imageAPKOs, err := generateImageAPKOsForMinorVersion(ctx, pf, templatePackageID, templatePackageVersionID, newPackageID, templatePackageName, packageName, templateVersion, newVersion, oldMajorMinor, newMajorMinor)
	if err != nil {
		// Log error but don't fail the entire process
		logger.Error(fmt.Errorf("failed to generate image APKOs for new minor version: %w", err))
		imageAPKOs = nil
	}

	// Convert custom_disk_size from sql.NullInt32 to *int
	var customDiskSize *int
	if templateCustomDiskSize.Valid {
		diskSize := int(templateCustomDiskSize.Int32)
		customDiskSize = &diskSize
	}

	// Return UpdateResult with package info and data needed to create package_create record
	// The package_create record and event will be created/triggered in queuePackageBuild after tag reassignment
	return &UpdateResult{
		PackageID:           newPackageID,
		PackageVersionID:    "", // version will be created by the worker processing package_create
		ImageAPKOs:          imageAPKOs,
		CreateNewPackage:    true,
		MelangeYAML:         transformedYAML,
		AdditionalFilesData: additionalFilesDataEncoded,
		UseRoot:             templateUseRoot,
		CustomDiskSize:      customDiskSize,
	}, nil
}

// processPatchVersionUpdate handles patch version updates (updates existing packages)
func processPatchVersionUpdate(ctx context.Context, pf *package_family.PackageFamily, version *semver.Version) (*UpdateResult, error) {
	// Generate package name from template (same as current package)
	packageName := package_family.GeneratePackageName(pf.PackageNameTemplate, pf.Name, int(version.Major()), int(version.Minor()))
	logger.Info("Processing patch version update",
		zap.String("package_family", pf.Name),
		zap.String("version", version.Original()),
		zap.String("package_name", packageName),
		zap.Int64("major", int64(version.Major())),
		zap.Int64("minor", int64(version.Minor())),
		zap.Int64("patch", int64(version.Patch())))

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Get the existing package (same major.minor)
	var existingPackageID string
	err := conn.QueryRow(ctx, `SELECT id FROM package WHERE name = $1`, packageName).Scan(&existingPackageID)
	if err != nil {
		return nil, fmt.Errorf("failed to find existing package %s: %w", packageName, err)
	}

	// Get the latest package_version for this package (using semver comparison, not epoch)
	latestPackageVersion, err := sbpackage.GetLatestPackageVersion(ctx, existingPackageID)
	if err != nil {
		return nil, fmt.Errorf("failed to get latest package version: %w", err)
	}
	templatePackageVersionID := latestPackageVersion.ID
	templateMelangeYAML := latestPackageVersion.MelangeYaml
	templateVersion := latestPackageVersion.Version
	templateUseRoot := latestPackageVersion.UseRoot
	templateCustomDiskSize := latestPackageVersion.CustomDiskSize

	// Calculate new epoch (increment from max for this version)
	var maxEpoch sql.NullInt32
	err = conn.QueryRow(ctx,
		`SELECT MAX(apk_release) FROM package_version WHERE package_id = $1 AND version = $2`,
		existingPackageID, version.Original()).Scan(&maxEpoch)
	if err != nil {
		return nil, fmt.Errorf("failed to get max epoch: %w", err)
	}
	newEpoch := 0
	if maxEpoch.Valid {
		newEpoch = int(maxEpoch.Int32) + 1
	}

	logger.Info("Patch version update decision",
		zap.String("package_name", packageName),
		zap.String("package_id", existingPackageID),
		zap.Int("new_epoch", newEpoch))

	// Create GitHub client with authentication for digest updates
	var githubClient *github.Client
	if githubToken := param.GetParam(ctx).UpdaterGithubAPIToken; githubToken != "" {
		ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: githubToken})
		tc := oauth2.NewClient(ctx, ts)
		githubClient = github.NewClient(tc)
	} else {
		githubClient = github.NewClient(nil)
	}

	// Transform the melange YAML for the patch version (partial transformation)
	transformedYAML, err := transformMelangeYAMLForPatchVersion(
		ctx,
		templateMelangeYAML,
		templateVersion,
		version.Original(),
		newEpoch,
		githubClient,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to transform melange YAML: %w", err)
	}

	// Handle additional files (copy + transform)
	additionalFilesData, err := copyAndTransformAdditionalFiles(
		ctx,
		templatePackageVersionID,
		templateVersion,
		version.Original(),
		"", // no major.minor change for patch updates
		"", // no major.minor change for patch updates
	)
	if err != nil {
		return nil, fmt.Errorf("failed to copy additional files: %w", err)
	}

	// Create new package_version record directly (not via package_create)
	newPackageVersionID := generateID()

	// Start a transaction to create package_version and write provides atomically
	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		INSERT INTO package_version (id, package_id, version, apk_release, melange_yaml, created_at, updated_at, use_root, custom_disk_size)
		VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6, $7)
	`, newPackageVersionID, existingPackageID, version.Original(), newEpoch, transformedYAML, templateUseRoot, templateCustomDiskSize)
	if err != nil {
		return nil, fmt.Errorf("failed to create package_version: %w", err)
	}

	// Insert additional files if present
	if additionalFilesData.Valid {
		if err := insertAdditionalFiles(ctx, tx, newPackageVersionID, additionalFilesData.String); err != nil {
			return nil, fmt.Errorf("failed to insert additional files: %w", err)
		}
	}

	// Write provides entries immediately so they're available for the next iteration
	packageVersion := &types.PackageVersion{
		ID:          newPackageVersionID,
		PackageID:   existingPackageID,
		Version:     version.Original(),
		APKRelease:  newEpoch,
		MelangeYaml: transformedYAML,
	}
	if err := sbpackage.WritePackageVersionProvides(ctx, tx, packageVersion); err != nil {
		return nil, fmt.Errorf("failed to write package version provides: %w", err)
	}

	// Commit the transaction
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	logger.Warn("⚡ Auto-created patch version",
		zap.String("package_name", packageName),
		zap.String("version", version.Original()),
		zap.Int("epoch", newEpoch),
		zap.String("package_id", existingPackageID),
		zap.String("package_version_id", newPackageVersionID))

	// Generate image APKOs for this patch version (collect info, don't queue builds)
	imageAPKOs, err := generateImageAPKOsForPatchVersion(ctx, pf, existingPackageID, templatePackageVersionID, newPackageVersionID, packageName, templateVersion, version.Original())
	if err != nil {
		return nil, fmt.Errorf("failed to generate image APKOs: %w", err)
	}

	// Return UpdateResult with package info
	return &UpdateResult{
		PackageID:        existingPackageID,
		PackageVersionID: newPackageVersionID,
		ImageAPKOs:       imageAPKOs,
		CreateNewPackage: false, // Patch version - package_version already created
	}, nil
}

// transformMelangeYAMLForPatchVersion transforms melange YAML for patch version updates
// Unlike transformMelangeYAMLForNewMinorVersion, this does NOT change:
//   - package name
//   - tag-filter patterns
//
// It DOES update:
//   - version field
//   - epoch field
//   - expected-commit, expected-sha256, expected-sha512 digests
func transformMelangeYAMLForPatchVersion(
	ctx context.Context,
	melangeYAML string,
	oldVersion string,
	newVersion string,
	epoch int,
	githubClient *github.Client,
) (string, error) {
	result := melangeYAML

	// 1. Replace version (quoted and unquoted)
	result = regexp.MustCompile(`version:\s*["']?`+regexp.QuoteMeta(oldVersion)+`["']?`).
		ReplaceAllString(result, fmt.Sprintf(`version: "%s"`, newVersion))

	// 2. Update epoch
	result = regexp.MustCompile(`(?m)^\s*epoch:\s*\d+`).ReplaceAllStringFunc(result, func(match string) string {
		leadingSpace := regexp.MustCompile(`^(\s*)`).FindString(match)
		return fmt.Sprintf("%sepoch: %d", leadingSpace, epoch)
	})

	// 3. Remove/update expected-commit digests (git-checkout) and update fetch digests (SHA256/SHA512)
	p := param.GetParam(ctx)
	digestUpdates, err := extractDigestsForRemoval(ctx, result, githubClient, p.RemoveCommitSHAPins)
	if err != nil {
		logger.Warn("Failed to update digests", zap.Error(err))
	} else {
		for oldDigest, newDigest := range digestUpdates {
			if oldDigest == "" {
				continue
			}
			if newDigest == "" {
				// Remove entire expected-commit line (for git-checkout), including lines with trailing comments
				result = regexp.MustCompile(`(?m)^\s*expected-commit:\s*`+regexp.QuoteMeta(oldDigest)+`\s*(?:#.*)?$\n?`).ReplaceAllString(result, "")
			} else {
				// Replace with new digest (for fetch SHA256/SHA512)
				result = strings.ReplaceAll(result, oldDigest, newDigest)
			}
		}
	}

	return result, nil
}

// copyAndTransformAdditionalFiles fetches additional files from a package version
// and transforms them for a new version. Returns base64-encoded tar.gz data.
// oldMajorMinor and newMajorMinor are optional (empty for patch updates)
func copyAndTransformAdditionalFiles(
	ctx context.Context,
	sourcePackageVersionID string,
	oldVersion string,
	newVersion string,
	oldMajorMinor string,
	newMajorMinor string,
) (sql.NullString, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Fetch files
	rows, err := conn.Query(ctx, `
		SELECT path, content
		FROM package_version_additional_file
		WHERE package_version_id = $1`,
		sourcePackageVersionID)
	if err != nil {
		return sql.NullString{}, fmt.Errorf("failed to fetch additional files: %w", err)
	}
	defer rows.Close()

	var additionalFiles []AdditionalFile
	for rows.Next() {
		var file AdditionalFile
		if err := rows.Scan(&file.Path, &file.Content); err != nil {
			return sql.NullString{}, fmt.Errorf("failed to scan file: %w", err)
		}

		// Transform content
		file.Content = transformAdditionalFileContent(
			file.Content,
			oldVersion,
			newVersion,
			oldMajorMinor,
			newMajorMinor,
		)
		additionalFiles = append(additionalFiles, file)
	}

	if len(additionalFiles) == 0 {
		return sql.NullString{}, nil
	}

	// Create tar.gz
	tarGzData, err := createTarGzFromFiles(additionalFiles)
	if err != nil {
		return sql.NullString{}, fmt.Errorf("failed to create tar.gz: %w", err)
	}

	encodedData := base64.StdEncoding.EncodeToString(tarGzData)
	return sql.NullString{String: encodedData, Valid: true}, nil
}

// insertAdditionalFiles inserts additional files into the package_version_additional_file table
// from base64-encoded tar.gz data
func insertAdditionalFiles(ctx context.Context, tx pgx.Tx, packageVersionID string, encodedData string) error {
	// Decode base64
	tarGzData, err := base64.StdEncoding.DecodeString(encodedData)
	if err != nil {
		return fmt.Errorf("failed to decode base64: %w", err)
	}

	// Decompress gzip
	gzReader, err := gzip.NewReader(bytes.NewReader(tarGzData))
	if err != nil {
		return fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gzReader.Close()

	// Read tar archive
	tarReader := tar.NewReader(gzReader)

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar header: %w", err)
		}

		// Read file content
		contentBytes, err := io.ReadAll(tarReader)
		if err != nil {
			return fmt.Errorf("failed to read file content: %w", err)
		}

		// Insert into database using CreateAdditionalFile
		if err := sbpackage.CreateAdditionalFile(ctx, tx, packageVersionID, header.Name, contentBytes); err != nil {
			return fmt.Errorf("failed to insert file %s: %w", header.Name, err)
		}
	}

	logger.Info("Inserted additional files",
		zap.String("package_version_id", packageVersionID))

	return nil
}

// generateImageAPKOsForPatchVersion creates new image APKOs when a patch version is created
// Similar to generateImageAPKOsForMinorVersion but for same major.minor
func generateImageAPKOsForPatchVersion(
	ctx context.Context,
	pf *package_family.PackageFamily,
	packageID string,
	oldPackageVersionID string,
	newPackageVersionID string,
	packageName string,
	oldVersion string,
	newVersion string,
) ([]*ImageAPKOInfo, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Find all images that use this package
	query := `
		SELECT DISTINCT ip.image_id
		FROM image_package ip
		WHERE ip.package_id = $1
	`
	rows, err := conn.Query(ctx, query, packageID)
	if err != nil {
		return nil, fmt.Errorf("failed to query images using package: %w", err)
	}
	defer rows.Close()

	var imageIDs []string
	for rows.Next() {
		var imageID string
		if err := rows.Scan(&imageID); err != nil {
			return nil, fmt.Errorf("failed to scan image row: %w", err)
		}
		imageIDs = append(imageIDs, imageID)
	}

	if len(imageIDs) == 0 {
		logger.Info("No images found using package",
			zap.String("package_id", packageID))
		return nil, nil
	}

	logger.Info("Found images to update for new patch version",
		zap.Int("count", len(imageIDs)),
		zap.String("package_name", packageName),
		zap.String("new_version", newVersion))

	// Get the melange YAML for this package
	var templateMelangeYAML string
	err = conn.QueryRow(ctx, `
		SELECT pv.melange_yaml
		FROM package_version pv
		WHERE pv.id = $1`,
		oldPackageVersionID).Scan(&templateMelangeYAML)
	if err != nil {
		return nil, fmt.Errorf("failed to get melange YAML: %w", err)
	}

	// Collect image APKO info
	var imageAPKOs []*ImageAPKOInfo

	// Process each image
	// NOTE: For patch updates, we use the same logic as minor updates but without changing package names
	v, _ := semver.NewVersion(newVersion)
	majorMinor := fmt.Sprintf("%d.%d", v.Major(), v.Minor())

	for _, imageID := range imageIDs {
		// Find all template APKOs for this image
		templateApkoIDs, err := findTemplateAPKOs(ctx, conn, imageID, packageID, oldVersion, newVersion, majorMinor)
		if err != nil {
			logger.Error(fmt.Errorf("failed to find template APKOs for image %s: %w", imageID, err))
			continue
		}

		logger.Debug("Found template APKOs for image (patch update)",
			zap.String("image_id", imageID),
			zap.Int("count", len(templateApkoIDs)))

		// Process each template APKO
		for _, templateApkoID := range templateApkoIDs {
			// Load the APKO YAML, tags, and version ID
			var apkoYAML string
			var apkoTags []string
			var oldApkoVersionID string
			err = conn.QueryRow(ctx, `
				SELECT iav.id, iav.apko_yaml, ia.tags
				FROM image_apko_version iav
				INNER JOIN image_apko ia ON ia.id = iav.image_apko_id
				WHERE iav.image_apko_id = $1
				ORDER BY iav.created_at DESC
				LIMIT 1
			`, templateApkoID).Scan(&oldApkoVersionID, &apkoYAML, &apkoTags)
			if err != nil {
				logger.Error(fmt.Errorf("failed to load APKO data for image %s, APKO %s: %w", imageID, templateApkoID, err))
				continue
			}

			// Check if this package is a core package
			isCorePackage, err := image.IsPackageCoreForAPKO(ctx, apkoYAML, apkoTags, pf.Name, packageName, oldVersion, oldPackageVersionID)
			if err != nil {
				logger.Error(fmt.Errorf("failed to check if package is core for image %s, APKO %s: %w", imageID, templateApkoID, err))
				continue
			}

			if !isCorePackage {
				logger.Debug("Skipping APKO generation - package is not a core package",
					zap.String("image_id", imageID),
					zap.String("apko_id", templateApkoID),
					zap.String("package_name", packageName),
					zap.String("old_version", oldVersion))
				continue
			}

			logger.Info("Generating APKO for patch update - package is a core package",
				zap.String("image_id", imageID),
				zap.String("apko_id", templateApkoID),
				zap.String("package_name", packageName),
				zap.String("old_version", oldVersion))

			// For patch updates, package name stays the same (no major.minor change)
			newApkoID, err := generateSingleImageAPKO(ctx, pf, imageID, templateApkoID, oldApkoVersionID, apkoYAML, apkoTags, packageID, packageID, packageName, packageName, oldVersion, newVersion, majorMinor, majorMinor, templateMelangeYAML)
			if err != nil {
				logger.Error(fmt.Errorf("failed to generate APKO for image %s, template APKO %s: %w", imageID, templateApkoID, err))
				continue
			}

			// Collect image APKO info
			imageAPKOs = append(imageAPKOs, &ImageAPKOInfo{
				ImageID: imageID,
				ApkoID:  newApkoID,
			})
		}
	}

	return imageAPKOs, nil
}

// generateID generates a random ID for database records
func generateID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return fmt.Sprintf("%x", b)
}

// transformMelangeYAMLForNewMinorVersion transforms a melange YAML template for a new minor version
// It performs regex replacements to update package name, version, description, and tag-filter
// The function preserves YAML structure including comments, indentation, and key ordering
// It also updates expected-commit and expected-sha256/sha512 digests for git-checkout and fetch steps
func transformMelangeYAMLForNewMinorVersion(
	ctx context.Context,
	melangeYAML string,
	oldPackageName string,
	newPackageName string,
	oldVersion string,
	newVersion string,
	oldMajorMinor string,
	newMajorMinor string,
	epoch int,
	githubClient *github.Client,
) (string, error) {
	result := melangeYAML

	// 1. Replace package name (exact match to avoid partial replacements)
	// Example: "name: git-2.50" -> "name: git-2.51"
	result = regexp.MustCompile(`\b`+regexp.QuoteMeta(oldPackageName)+`\b`).ReplaceAllString(result, newPackageName)

	// 2. Replace version strings (quoted and unquoted)
	// Example: version: "2.50.0" -> version: "2.51.1"
	result = regexp.MustCompile(`version:\s*["']?`+regexp.QuoteMeta(oldVersion)+`["']?`).ReplaceAllString(result, fmt.Sprintf(`version: "%s"`, newVersion))

	// 3. Reset epoch to the specified value (usually 0 for new packages, or incremented for existing)
	// Example: epoch: 1 -> epoch: 0
	result = regexp.MustCompile(`(?m)^\s*epoch:\s*\d+`).ReplaceAllStringFunc(result, func(match string) string {
		// Preserve leading whitespace
		leadingSpace := regexp.MustCompile(`^(\s*)`).FindString(match)
		return fmt.Sprintf("%sepoch: %d", leadingSpace, epoch)
	})

	// 4. Replace major.minor in tag-filter patterns
	// Example: "tag-filter: v2.50." -> "tag-filter: v2.51."
	result = regexp.MustCompile(`tag-filter:\s*v?`+regexp.QuoteMeta(oldMajorMinor)+`\.`).ReplaceAllString(result, fmt.Sprintf("tag-filter: v%s.", newMajorMinor))

	// 5. Remove/update expected-commit digests (git-checkout) and update fetch digests (SHA256/SHA512)
	// Extract digests from melange YAML (resolves all variables first)
	p := param.GetParam(ctx)
	digestUpdates, err := extractDigestsForRemoval(ctx, result, githubClient, p.RemoveCommitSHAPins)
	if err != nil {
		logger.Warn("Failed to extract and update digests, continuing without digest updates",
			zap.Error(err))
	} else {
		// Apply digest updates using string replacement to preserve YAML structure
		for oldDigest, newDigest := range digestUpdates {
			if oldDigest == "" {
				continue
			}
			if newDigest == "" {
				// Remove entire expected-commit line (for git-checkout), including lines with trailing comments
				result = regexp.MustCompile(`(?m)^\s*expected-commit:\s*`+regexp.QuoteMeta(oldDigest)+`\s*(?:#.*)?$\n?`).ReplaceAllString(result, "")
			} else {
				// Replace with new digest (for fetch SHA256/SHA512)
				result = strings.ReplaceAll(result, oldDigest, newDigest)
			}
		}
	}

	return result, nil
}

// transformAdditionalFileContent transforms additional file content to replace version references
func transformAdditionalFileContent(
	content string,
	oldVersion string,
	newVersion string,
	oldMajorMinor string,
	newMajorMinor string,
) string {
	result := content

	// Replace version strings
	result = strings.ReplaceAll(result, oldVersion, newVersion)

	// Replace major.minor version references
	result = strings.ReplaceAll(result, oldMajorMinor, newMajorMinor)

	return result
}

// AdditionalFile represents a file to be included with a package
type AdditionalFile struct {
	Path    string
	Content string
}

// createTarGzFromFiles creates a tar.gz archive from a list of files
func createTarGzFromFiles(files []AdditionalFile) ([]byte, error) {
	var buf bytes.Buffer
	gzWriter := gzip.NewWriter(&buf)
	tarWriter := tar.NewWriter(gzWriter)

	for _, file := range files {
		// Write tar header
		header := &tar.Header{
			Name: file.Path,
			Mode: 0o644,
			Size: int64(len(file.Content)),
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			return nil, fmt.Errorf("write tar header for %s: %w", file.Path, err)
		}

		// Write file content
		if _, err := tarWriter.Write([]byte(file.Content)); err != nil {
			return nil, fmt.Errorf("write tar content for %s: %w", file.Path, err)
		}
	}

	if err := tarWriter.Close(); err != nil {
		return nil, fmt.Errorf("close tar writer: %w", err)
	}
	if err := gzWriter.Close(); err != nil {
		return nil, fmt.Errorf("close gzip writer: %w", err)
	}

	return buf.Bytes(), nil
}

func fetchAndFilterVersionsFromGithub(ctx context.Context, client *github.Client, pf *package_family.PackageFamily, compiled *config.Configuration) ([]*VersionUpdate, error) {
	if compiled.Update.GitHubMonitor == nil {
		return nil, fmt.Errorf("github monitor configuration is nil")
	}

	identifier := strings.Split(compiled.Update.GitHubMonitor.Identifier, "/")
	if len(identifier) != 2 {
		return nil, fmt.Errorf("invalid github identifier: %q", compiled.Update.GitHubMonitor.Identifier)
	}
	owner := identifier[0]
	repo := identifier[1]

	logger.Info("Using version pattern", zap.String("pattern", pf.VersionPattern.String))

	var rawVersions []string

	// Fetch from GitHub based on UseTags setting
	if compiled.Update.GitHubMonitor.UseTags {
		// Fetch tags
		var allTags []*github.RepositoryTag
		opt := &github.ListOptions{PerPage: 100}
		for {
			tags, resp, err := client.Repositories.ListTags(ctx, owner, repo, opt)
			if err != nil {
				return nil, fmt.Errorf("failed to list tags: %w", err)
			}
			allTags = append(allTags, tags...)
			if resp.NextPage == 0 {
				break
			}
			opt.Page = resp.NextPage
		}

		for _, tag := range allTags {
			rawVersions = append(rawVersions, tag.GetName())
		}
		logger.Info("Fetched tags from GitHub", zap.Strings("tags", rawVersions), zap.Int("count", len(rawVersions)))
	} else {
		// Fetch releases
		var allReleases []*github.RepositoryRelease
		opt := &github.ListOptions{PerPage: 100}
		for {
			releases, resp, err := client.Repositories.ListReleases(ctx, owner, repo, opt)
			if err != nil {
				return nil, fmt.Errorf("failed to list releases: %w", err)
			}
			allReleases = append(allReleases, releases...)
			if resp.NextPage == 0 {
				break
			}
			opt.Page = resp.NextPage
		}

		for _, release := range allReleases {
			rawVersions = append(rawVersions, release.GetTagName())
		}
	}

	// Filter and parse versions using regex pattern
	logger.Info("Starting regex filtering", zap.Int("total_versions", len(rawVersions)))
	results, err := filterAndSortVersions(ctx, rawVersions, pf, compiled)
	if err != nil {
		return nil, fmt.Errorf("failed to filter versions: %w", err)
	}

	return results, nil
}

// getExistingVersionsForFamily returns all package names and versions that exist in package_version table for this family
func getExistingVersionsForFamily(ctx context.Context, pf *package_family.PackageFamily) ([]PackageVersionInfo, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Query all package_version records for packages in this family
	// Use regex to match {family}-{digits}.{digits} format to avoid matching unrelated packages
	// e.g., "go" matches "go-1.26" but NOT "go-boring-1.26"
	query := `
		SELECT DISTINCT p.name, pv.version
		FROM package p
		INNER JOIN package_version pv ON p.id = pv.package_id
		WHERE p.name ~ $1 AND p.parent_id IS NULL
	`

	familyPattern := "^" + regexp.QuoteMeta(pf.Name) + "-[0-9]+\\.[0-9]+$"
	rows, err := conn.Query(ctx, query, familyPattern)
	if err != nil {
		return nil, fmt.Errorf("failed to query existing versions: %w", err)
	}
	defer rows.Close()

	var versions []PackageVersionInfo
	for rows.Next() {
		var info PackageVersionInfo
		if err := rows.Scan(&info.PackageName, &info.Version); err != nil {
			logger.Warn("Failed to scan version row", zap.Error(err))
			continue
		}
		versions = append(versions, info)
	}

	return versions, nil
}

// getCurrentVersionFromDatabase dynamically determines the current version of a package family
// by querying existing packages in the database and finding the highest version among them.
// Returns the semver.Version object of the highest version package, or nil if none found.
func getCurrentVersionFromDatabase(ctx context.Context, pf *package_family.PackageFamily) *semver.Version {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Query packages matching the family name pattern with parent_id IS NULL
	// Use regex to match {family}-{major}.{minor} format to avoid matching unrelated packages
	// e.g., "busybox" matches "busybox-25.10" but NOT "busybox-gpu-operator-25.10"
	query := `
		SELECT DISTINCT p.id, p.name, pv.version
		FROM package p
		INNER JOIN package_version pv ON p.id = pv.package_id
		WHERE p.name ~ $1 AND p.parent_id IS NULL
	`

	// Pattern matches: {family_name}-{digits}.{digits} (e.g., busybox-25.10)
	familyPattern := "^" + regexp.QuoteMeta(pf.Name) + "-[0-9]+\\.[0-9]+$"
	rows, err := conn.Query(ctx, query, familyPattern)
	if err != nil {
		logger.Error(fmt.Errorf("failed to query family packages: %w", err))
		return nil
	}
	defer rows.Close()

	// Collect all packages
	var packages []package_family.Package
	for rows.Next() {
		var pkg package_family.Package
		if err := rows.Scan(&pkg.ID, &pkg.Name, &pkg.Version); err != nil {
			logger.Warn("Failed to scan package row", zap.Error(err))
			continue
		}
		packages = append(packages, pkg)
	}

	if len(packages) == 0 {
		logger.Info("No existing packages found for family", zap.String("family", pf.Name))
		return nil
	}

	logger.Info("Found candidate packages",
		zap.String("family", pf.Name),
		zap.Int("count", len(packages)))

	// Find the package with the highest version using semver
	var highestVersion *semver.Version

	for _, pkg := range packages {
		// Parse version using semver
		v, err := semver.NewVersion(pkg.Version)
		if err != nil {
			logger.Debug("Failed to parse version as semver",
				zap.String("package", pkg.Name),
				zap.String("version", pkg.Version),
				zap.Error(err))
			continue
		}

		// Update highest if this is the first valid version or if it's higher
		if highestVersion == nil || v.GreaterThan(highestVersion) {
			highestVersion = v
		}
	}

	if highestVersion == nil {
		logger.Info("No valid semver packages found for family", zap.String("family", pf.Name))
		return nil
	}

	logger.Info("Determined current version from database",
		zap.String("family", pf.Name),
		zap.Int64("major", int64(highestVersion.Major())),
		zap.Int64("minor", int64(highestVersion.Minor())),
		zap.String("version", highestVersion.Original()))

	return highestVersion
}

// needsImageAPKOGeneration checks if a package version should have image APKOs generated
// Returns true if the package exists but has no image APKOs AND there are images in the family
func needsImageAPKOGeneration(ctx context.Context, pf *package_family.PackageFamily, packageName string, version string) (bool, error) {
	logger.Debug("needsImageAPKOGeneration called",
		zap.String("package_name", packageName),
		zap.String("version", version),
		zap.String("family_id", pf.ID),
		zap.String("family_name", pf.Name))

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Check if this package exists
	var packageID string
	err := conn.QueryRow(ctx, `SELECT id FROM package WHERE name = $1`, packageName).Scan(&packageID)
	if err != nil {
		if err == pgx.ErrNoRows {
			logger.Info("Package does not exist, will be created normally",
				zap.String("package_name", packageName))
			return false, nil // Package doesn't exist, will be created normally
		}
		return false, fmt.Errorf("failed to check if package exists: %w", err)
	}

	// Check if this package already has image APKOs
	var existingImageCount int
	err = conn.QueryRow(ctx, `
		SELECT COUNT(DISTINCT ip.image_id)
		FROM image_package ip
		WHERE ip.package_id = $1
	`, packageID).Scan(&existingImageCount)
	if err != nil {
		return false, fmt.Errorf("failed to count existing image APKOs: %w", err)
	}

	logger.Info("Checking if package needs image APKO generation",
		zap.String("package_name", packageName),
		zap.String("package_id", packageID),
		zap.String("version", version),
		zap.Int("existing_image_count", existingImageCount))

	// If package already has image APKOs, no need to regenerate
	if existingImageCount > 0 {
		logger.Info("Package already has image APKOs, skipping generation",
			zap.String("package_name", packageName),
			zap.String("version", version),
			zap.Int("image_count", existingImageCount))
		return false, nil
	}

	// Package exists but has no image APKOs - check if there are ANY images using ANY package in this family
	// Get all packages in this family
	rows, err := conn.Query(ctx, `
		SELECT p.id
		FROM package p
		INNER JOIN package_family_package pfp ON p.id = pfp.package_id
		WHERE pfp.package_family_id = $1
	`, pf.ID)
	if err != nil {
		return false, fmt.Errorf("failed to query family packages: %w", err)
	}
	defer rows.Close()

	var familyPackageIDs []string
	for rows.Next() {
		var pkgID string
		if err := rows.Scan(&pkgID); err != nil {
			return false, fmt.Errorf("failed to scan package ID: %w", err)
		}
		familyPackageIDs = append(familyPackageIDs, pkgID)
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("error iterating family packages: %w", err)
	}

	logger.Info("Found packages in family",
		zap.String("family_id", pf.ID),
		zap.Int("package_count", len(familyPackageIDs)))

	// Check if any package in the family has images
	if len(familyPackageIDs) == 0 {
		logger.Warn("No packages found in family, cannot generate image APKOs",
			zap.String("family_id", pf.ID),
			zap.String("family_name", pf.Name))
		return false, nil
	}

	// Count images across all packages in the family with a single query
	var totalImageCount int
	err = conn.QueryRow(ctx, `
		SELECT COUNT(DISTINCT ip.image_id)
		FROM image_package ip
		WHERE ip.package_id = ANY($1)
	`, familyPackageIDs).Scan(&totalImageCount)
	if err != nil {
		return false, fmt.Errorf("failed to count family images: %w", err)
	}

	needsGeneration := totalImageCount > 0

	logger.Info("Image APKO generation check result",
		zap.String("package_name", packageName),
		zap.String("package_id", packageID),
		zap.String("version", version),
		zap.Int("family_total_images", totalImageCount),
		zap.Bool("needs_generation", needsGeneration))

	return needsGeneration, nil
}

// generateAPKOsForExistingVersion generates image APKOs for a package version that already exists
// but doesn't have any image APKOs. Uses the shared generateImageAPKOsForMinorVersion logic.
func generateAPKOsForExistingVersion(ctx context.Context, pf *package_family.PackageFamily, version *semver.Version) (*UpdateResult, error) {
	packageName := package_family.GeneratePackageName(pf.PackageNameTemplate, pf.Name, int(version.Major()), int(version.Minor()))
	majorMinor := fmt.Sprintf("%d.%d", version.Major(), version.Minor())

	logger.Info("Generating APKOs for existing version",
		zap.String("package_family", pf.Name),
		zap.String("version", version.Original()),
		zap.String("package_name", packageName))

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Find the existing package (target - the one we're generating APKOs for)
	var packageID string
	err := conn.QueryRow(ctx, `SELECT id FROM package WHERE name = $1`, packageName).Scan(&packageID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("package %s does not exist", packageName)
		}
		return nil, fmt.Errorf("failed to find package: %w", err)
	}

	// Find the package version
	var packageVersionID string
	err = conn.QueryRow(ctx, `
		SELECT pv.id
		FROM package_version pv
		WHERE pv.package_id = $1 AND pv.version = $2
		ORDER BY pv.apk_release DESC
		LIMIT 1`,
		packageID, version.Original()).Scan(&packageVersionID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("package version %s/%s does not exist", packageName, version.Original())
		}
		return nil, fmt.Errorf("failed to find package version: %w", err)
	}

	// Find a template package from the family that HAS image APKOs
	// This is needed because the target package has no APKOs yet (that's why we're generating them)
	// Order by created_at DESC to get the most recently created version (avoids string-based version sorting issues)
	var templatePackageID string
	var templatePackageVersionID string
	var templatePackageName string
	var templateVersion string
	err = conn.QueryRow(ctx, `
		SELECT p.id, pv.id, p.name, pv.version
		FROM package p
		INNER JOIN package_version pv ON p.id = pv.package_id
		INNER JOIN package_family_package pfp ON p.id = pfp.package_id
		WHERE pfp.package_family_id = $1
		  AND p.id != $2
		  AND EXISTS (SELECT 1 FROM image_package ip WHERE ip.package_id = p.id)
		ORDER BY pv.created_at DESC
		LIMIT 1`,
		pf.ID, packageID).Scan(&templatePackageID, &templatePackageVersionID, &templatePackageName, &templateVersion)
	if err != nil {
		if err == pgx.ErrNoRows {
			logger.Info("Skipping APKO generation - no template package with APKOs found in family",
				zap.String("package_name", packageName),
				zap.String("family_id", pf.ID))
			return nil, nil
		}
		return nil, fmt.Errorf("failed to find template package: %w", err)
	}

	// Parse template version to get major.minor
	templateSemver, err := semver.NewVersion(templateVersion)
	if err != nil {
		return nil, fmt.Errorf("failed to parse template version as semver: %w", err)
	}
	templateMajorMinor := fmt.Sprintf("%d.%d", templateSemver.Major(), templateSemver.Minor())

	logger.Info("Found template package with APKOs",
		zap.String("template_package_id", templatePackageID),
		zap.String("template_package_version_id", templatePackageVersionID),
		zap.String("template_package_name", templatePackageName),
		zap.String("template_version", templateVersion),
		zap.String("target_package_name", packageName),
		zap.String("target_version", version.Original()))

	// Use the shared APKO generation logic
	imageAPKOs, err := generateImageAPKOsForMinorVersion(
		ctx, pf,
		templatePackageID, templatePackageVersionID, // template package (has APKOs)
		packageID,                        // new package (target)
		templatePackageName, packageName, // template/new package names
		templateVersion, version.Original(), // template/new versions
		templateMajorMinor, majorMinor, // template/new major.minor
	)
	if err != nil {
		logger.Error(fmt.Errorf("failed to generate image APKOs for existing version: %w", err))
		imageAPKOs = nil
	}

	logger.Info("Generated APKOs for existing version",
		zap.String("package_name", packageName),
		zap.String("version", version.Original()),
		zap.Int("apko_count", len(imageAPKOs)))

	return &UpdateResult{
		PackageID:        packageID,
		PackageVersionID: packageVersionID,
		ImageAPKOs:       imageAPKOs,
		CreateNewPackage: false,
		SkipBuild:        true, // APKO-only path - no package rebuild needed
	}, nil
}

// findFamilyImages finds all images that have APKOs referencing any package in the family
func findFamilyImages(ctx context.Context, conn *pgxpool.Conn, pf *package_family.PackageFamily) ([]string, error) {
	rows, err := conn.Query(ctx, `
		SELECT DISTINCT ip.image_id
		FROM image_package ip
		INNER JOIN package_family_package pfp ON ip.package_id = pfp.package_id
		WHERE pfp.package_family_id = $1
	`, pf.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to query family images: %w", err)
	}
	defer rows.Close()

	var imageIDs []string
	for rows.Next() {
		var imageID string
		if err := rows.Scan(&imageID); err != nil {
			return nil, fmt.Errorf("failed to scan image ID: %w", err)
		}
		imageIDs = append(imageIDs, imageID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating family images: %w", err)
	}

	if len(imageIDs) > 0 {
		logger.Debug("Found images for family",
			zap.String("family_id", pf.ID),
			zap.Int("count", len(imageIDs)))
	}

	return imageIDs, nil
}

// filterAndSortVersions takes raw version strings and filters/sorts them according to package family rules
func filterAndSortVersions(ctx context.Context, rawVersions []string, pf *package_family.PackageFamily, compiled *config.Configuration) ([]*VersionUpdate, error) {
	// Get version pattern regex
	if !pf.VersionPattern.Valid || pf.VersionPattern.String == "" {
		return nil, fmt.Errorf("version pattern is required")
	}

	versionRegex, err := regexp.Compile(pf.VersionPattern.String)
	if err != nil {
		return nil, fmt.Errorf("invalid version pattern regex: %w", err)
	}

	// Get all existing package_version records for this family
	existingVersions, err := getExistingVersionsForFamily(ctx, pf)
	if err != nil {
		return nil, fmt.Errorf("failed to get existing versions: %w", err)
	}

	if len(existingVersions) == 0 {
		return nil, fmt.Errorf("no existing versions found for family %s", pf.Name)
	}

	// Parse and sort existing versions by semver (smallest to biggest)
	type ExistingVersionInfo struct {
		SemVer      *semver.Version
		PackageInfo PackageVersionInfo
	}
	var sortedExistingVersions []ExistingVersionInfo
	for _, existingInfo := range existingVersions {
		v, err := semver.NewVersion(existingInfo.Version)
		if err != nil {
			logger.Debug("Failed to parse existing version as semver",
				zap.String("version", existingInfo.Version),
				zap.Error(err))
			continue
		}
		sortedExistingVersions = append(sortedExistingVersions, ExistingVersionInfo{
			SemVer:      v,
			PackageInfo: existingInfo,
		})
	}

	if len(sortedExistingVersions) == 0 {
		return nil, fmt.Errorf("all versions in the family %s are not valid semver versions", pf.Name)
	}

	// Sort by semantic version (ascending - smallest first)
	sort.Slice(sortedExistingVersions, func(i, j int) bool {
		return sortedExistingVersions[i].SemVer.LessThan(sortedExistingVersions[j].SemVer)
	})

	// Get prefix/suffix from config
	var stripPrefix, stripSuffix string
	if compiled.Update.GitHubMonitor != nil {
		stripPrefix = compiled.Update.GitHubMonitor.StripPrefix
		stripSuffix = compiled.Update.GitHubMonitor.StripSuffix
	} else if compiled.Update.ReleaseMonitor != nil {
		stripPrefix = compiled.Update.ReleaseMonitor.StripPrefix
		stripSuffix = compiled.Update.ReleaseMonitor.StripSuffix
	}

	var results []*VersionUpdate
newVersionsLoop:
	for _, version := range rawVersions {
		// Use regex to validate that version matches the pattern
		if !versionRegex.MatchString(version) {
			continue
		}

		// Strip prefix/suffix before parsing as semver
		strippedVersion := version
		strippedVersion = strings.TrimPrefix(strippedVersion, stripPrefix)
		strippedVersion = strings.TrimSuffix(strippedVersion, stripSuffix)

		// Parse with semver
		sv, err := semver.NewVersion(strippedVersion)
		if err != nil {
			logger.Debug("Failed to parse version as semver",
				zap.String("version", strippedVersion),
				zap.Error(err))
			continue
		}

		if sortedExistingVersions[0].SemVer.GreaterThan(sv) {
			logger.Debug("Version is older than the lowest existing version, skipping",
				zap.String("version", sv.Original()))
			continue
		}

		// Find the last existing version that's older than sv
		// This will be the "update for" base version
		var updateForInfo *ExistingVersionInfo
		var versionExists bool
		for i := range sortedExistingVersions {
			if sortedExistingVersions[i].SemVer.Equal(sv) {
				versionExists = true
				// Version exists - check if it needs image APKO generation
				packageName := package_family.GeneratePackageName(pf.PackageNameTemplate, pf.Name, int(sv.Major()), int(sv.Minor()))
				logger.Debug("Found existing version, checking if needs APKOs",
					zap.String("version", sv.Original()),
					zap.String("package_name", packageName))
				needsAPKOs, err := needsImageAPKOGeneration(ctx, pf, packageName, sv.Original())
				if err != nil {
					logger.Errorf("Failed to check if version needs image APKO generation",
						zap.String("version", sv.Original()),
						zap.Error(err))
					continue newVersionsLoop
				}
				if !needsAPKOs {
					logger.Debug("Version already exists and does not need image APKOs, skipping",
						zap.String("version", sv.Original()))
					continue newVersionsLoop
				}
				logger.Info("Version exists but needs image APKO generation, including in update list",
					zap.String("version", sv.Original()))
				// Don't continue - let it fall through to add this version to results
				break
			}

			if sortedExistingVersions[i].SemVer.LessThan(sv) {
				updateForInfo = &sortedExistingVersions[i]
			} else {
				break // sortedExistingVersions is sorted, so we can stop
			}
		}

		// If version exists and we got here, it needs image APKOs - find the update base
		if versionExists && updateForInfo == nil {
			// Find the version to use as update base
			for i := range sortedExistingVersions {
				if sortedExistingVersions[i].SemVer.LessThan(sv) {
					updateForInfo = &sortedExistingVersions[i]
				}
			}
		}

		update := &VersionUpdate{
			Version:        sv,
			OnlyNeedsAPKOs: versionExists, // Set true if version exists but needs image APKOs
		}

		if updateForInfo != nil {
			// This version has a base version to update from
			update.UpdateForPackage = updateForInfo.PackageInfo.PackageName
			update.UpdateForVersion = updateForInfo.PackageInfo.Version
		}
		// If updateForInfo is nil, this is a new version with no base (first version or newer than all)

		results = append(results, update)
	}

	logger.Info("Filtered versions - found new versions",
		zap.String("family", pf.Name),
		zap.Int("new_count", len(results)))

	// Sort by semantic version (ascending - oldest first)
	sort.Slice(results, func(i, j int) bool {
		return results[i].Version.LessThan(results[j].Version)
	})

	return results, nil
}

// fetchAndFilterVersionsFromReleaseMonitor fetches versions from release-monitoring.org and filters them
func fetchAndFilterVersionsFromReleaseMonitor(ctx context.Context, compiled *config.Configuration, pf *package_family.PackageFamily) ([]*VersionUpdate, error) {
	if compiled.Update.ReleaseMonitor == nil {
		return nil, fmt.Errorf("release monitor configuration is nil")
	}

	// Fetch versions from release-monitoring.org API
	response, err := releasemonitor.FetchVersions(ctx, compiled.Update.ReleaseMonitor.Identifier)
	if err != nil {
		return nil, err
	}

	// Filter and parse versions using shared logic (IDENTICAL to GitHub filtering)
	results, err := filterAndSortVersions(ctx, response.StableVersions, pf, compiled)
	if err != nil {
		return nil, fmt.Errorf("failed to filter versions: %w", err)
	}
	return results, nil
}

// fetchGitCommitSHA fetches the commit SHA for a given tag from a GitHub repository
func fetchGitCommitSHA(ctx context.Context, client *github.Client, repository, tag string) (string, error) {
	// Parse the URL properly to handle trailing slashes
	parsedURL, err := url.Parse(repository)
	if err != nil {
		return "", fmt.Errorf("invalid repository URL: %w", err)
	}

	// Extract owner and repo from path like "/git/git" or "/git/git/"
	// Clean the path to remove trailing slashes
	pathParts := strings.Split(strings.Trim(parsedURL.Path, "/"), "/")
	if len(pathParts) < 2 {
		return "", fmt.Errorf("invalid repository path, expected format: github.com/owner/repo, got: %s", repository)
	}

	// Take first two components from the path
	owner := pathParts[0]
	repo := pathParts[1]

	// Get the git reference for the tag
	ref, _, err := client.Git.GetRef(ctx, owner, repo, "refs/tags/"+tag)
	if err != nil {
		return "", fmt.Errorf("failed to get ref for tag %s: %w", tag, err)
	}

	obj := ref.GetObject()

	// Handle both lightweight and annotated tags
	if obj.GetType() == "commit" {
		return obj.GetSHA(), nil
	} else if obj.GetType() == "tag" {
		// For annotated tags, we need to dereference to get the commit
		tagObj, _, err := client.Git.GetTag(ctx, owner, repo, obj.GetSHA())
		if err != nil {
			return "", fmt.Errorf("failed to get tag object: %w", err)
		}
		return tagObj.GetObject().GetSHA(), nil
	}

	return "", fmt.Errorf("unexpected object type: %s", obj.GetType())
}

// downloadAndHashFile downloads a file from a URI and computes its hash
// hashType should be either "sha256" or "sha512"
func downloadAndHashFile(ctx context.Context, uri, hashType string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", uri, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to download file: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var hash string
	switch hashType {
	case "sha256":
		h := sha256.New()
		if _, err := io.Copy(h, resp.Body); err != nil {
			return "", fmt.Errorf("failed to read response body: %w", err)
		}
		hash = hex.EncodeToString(h.Sum(nil))
	case "sha512":
		h := sha512.New()
		if _, err := io.Copy(h, resp.Body); err != nil {
			return "", fmt.Errorf("failed to read response body: %w", err)
		}
		hash = hex.EncodeToString(h.Sum(nil))
	default:
		return "", fmt.Errorf("unsupported hash type: %s", hashType)
	}

	return hash, nil
}

// extractDigestsForRemoval extracts git-checkout and fetch blocks from the YAML,
// and returns a map of old digest -> new digest (or empty string for removal)
// For git-checkout: returns empty string if removeCommitPins=true, or new SHA if false
// For fetch: returns new SHA256/SHA512 digest for update
// It uses CompileMelangeYAML to resolve all variables before extracting digests
func extractDigestsForRemoval(ctx context.Context, melangeYAML string, githubClient *github.Client, removeCommitPins bool) (map[string]string, error) {
	// Compile the melange YAML to resolve all variables
	compiled, err := sbpackage.CompileMelangeYAML(ctx, []byte(melangeYAML))
	if err != nil {
		return nil, fmt.Errorf("failed to compile melange YAML: %w", err)
	}

	updates := make(map[string]string)

	// Iterate through compiled pipeline steps to get resolved URIs and tags
	for _, step := range compiled.Pipeline {
		switch step.Uses {
		case "git-checkout":
			if err := extractGitCheckoutDigest(ctx, step, githubClient, removeCommitPins, updates); err != nil {
				logger.Warn("Failed to extract git-checkout digest",
					zap.String("repository", step.With["repository"]),
					zap.Error(err))
			}

		case "fetch":
			if err := updateFetchDigest(ctx, step, updates); err != nil {
				logger.Warn("Failed to update fetch digest",
					zap.String("uri", step.With["uri"]),
					zap.Error(err))
			}
		}
	}

	return updates, nil
}

// extractGitCheckoutDigest extracts expected-commit from git-checkout steps
// If removeCommitPins is true, marks it for removal by returning empty string
// If removeCommitPins is false, fetches new SHA from GitHub and returns it for update
func extractGitCheckoutDigest(ctx context.Context, step config.Pipeline, githubClient *github.Client, removeCommitPins bool, updates map[string]string) error {
	// Extract values from the With map (already compiled/resolved)
	repository := step.With["repository"]
	tag := step.With["tag"]
	expectedCommit := step.With["expected-commit"]

	if expectedCommit == "" || repository == "" || tag == "" {
		return nil // Nothing to process
	}

	if removeCommitPins {
		// Mark for removal by mapping to empty string
		updates[expectedCommit] = ""
		logger.Info("Marking expected-commit for removal",
			zap.String("repository", repository),
			zap.String("tag", tag),
			zap.String("commit_to_remove", expectedCommit))
	} else {
		// Fetch and update the commit SHA
		if githubClient == nil {
			return nil // Skip if no GitHub client available
		}

		newCommit, err := fetchGitCommitSHA(ctx, githubClient, repository, tag)
		if err != nil {
			return fmt.Errorf("fetch commit SHA: %w", err)
		}

		updates[expectedCommit] = newCommit
		logger.Info("Git commit SHA update",
			zap.String("repository", repository),
			zap.String("tag", tag),
			zap.String("old_commit", expectedCommit),
			zap.String("new_commit", newCommit))
	}

	return nil
}

// updateFetchDigest updates the expected-sha256 or expected-sha512 for a fetch step
func updateFetchDigest(ctx context.Context, step config.Pipeline, updates map[string]string) error {
	// Extract values from the With map (already compiled/resolved)
	uri := step.With["uri"]
	expectedSHA256 := step.With["expected-sha256"]
	expectedSHA512 := step.With["expected-sha512"]

	if uri == "" {
		return nil // Nothing to fetch
	}

	// Update SHA256 if present
	if expectedSHA256 != "" {
		newSHA256, err := downloadAndHashFile(ctx, uri, "sha256")
		if err != nil {
			return fmt.Errorf("compute SHA256: %w", err)
		}

		updates[expectedSHA256] = newSHA256
		logger.Info("SHA256 update",
			zap.String("uri", uri),
			zap.String("old_sha256", expectedSHA256),
			zap.String("new_sha256", newSHA256))
	}

	// Update SHA512 if present
	if expectedSHA512 != "" {
		newSHA512, err := downloadAndHashFile(ctx, uri, "sha512")
		if err != nil {
			return fmt.Errorf("compute SHA512: %w", err)
		}

		updates[expectedSHA512] = newSHA512
		logger.Info("SHA512 update",
			zap.String("uri", uri),
			zap.String("old_sha512", expectedSHA512),
			zap.String("new_sha512", newSHA512))
	}

	return nil
}

// generateImageAPKOsForMinorVersion creates new image APKOs when a new minor version of a package is created
// It finds all images that use the old package and creates new APKOs with updated package references
func generateImageAPKOsForMinorVersion(
	ctx context.Context,
	pf *package_family.PackageFamily,
	oldPackageID string,
	oldPackageVersionID string,
	newPackageID string,
	oldPackageName string,
	newPackageName string,
	oldVersion string,
	newVersion string,
	oldMajorMinor string,
	newMajorMinor string,
) ([]*ImageAPKOInfo, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Find all images that use packages from this family
	// Uses findFamilyImages which handles cases where packages aren't linked via image_package
	imageIDs, err := findFamilyImages(ctx, conn, pf)
	if err != nil {
		return nil, fmt.Errorf("failed to find family images: %w", err)
	}

	if len(imageIDs) == 0 {
		logger.Info("No images found for family",
			zap.String("family_name", pf.Name),
			zap.String("old_package_id", oldPackageID))
		return nil, nil
	}

	logger.Info("Found images to update for new minor version",
		zap.Int("count", len(imageIDs)),
		zap.String("new_package_name", newPackageName),
		zap.String("new_version", newVersion))

	// Get the melange YAML for this package
	var templateMelangeYAML string
	err = conn.QueryRow(ctx, `
		SELECT pv.melange_yaml
		FROM package_version pv
		WHERE pv.id = $1`,
		oldPackageVersionID).Scan(&templateMelangeYAML)
	if err != nil {
		return nil, fmt.Errorf("failed to get melange YAML: %w", err)
	}

	// Collect image APKO info
	var imageAPKOs []*ImageAPKOInfo

	// Process each image
	for _, imageID := range imageIDs {
		// Find all template APKOs for this image
		templateApkoIDs, err := findTemplateAPKOs(ctx, conn, imageID, oldPackageID, oldVersion, newVersion, oldMajorMinor)
		if err != nil {
			logger.Error(fmt.Errorf("failed to find template APKOs for image %s: %w", imageID, err))
			// Continue processing other images even if one fails
			continue
		}

		logger.Debug("Found template APKOs for image",
			zap.String("image_id", imageID),
			zap.Int("count", len(templateApkoIDs)))

		// Process each template APKO
		for _, templateApkoID := range templateApkoIDs {
			// Load the APKO YAML, tags, and version ID for both the core package check and APKO generation
			var apkoYAML string
			var apkoTags []string
			var oldApkoVersionID string
			err = conn.QueryRow(ctx, `
				SELECT iav.id, iav.apko_yaml, ia.tags
				FROM image_apko_version iav
				INNER JOIN image_apko ia ON ia.id = iav.image_apko_id
				WHERE iav.image_apko_id = $1
				ORDER BY iav.created_at DESC
				LIMIT 1
			`, templateApkoID).Scan(&oldApkoVersionID, &apkoYAML, &apkoTags)
			if err != nil {
				logger.Error(fmt.Errorf("failed to load APKO data for image %s, APKO %s: %w", imageID, templateApkoID, err))
				// Continue processing other APKOs even if one fails
				continue
			}

			// Check if this package is a core package for this APKO
			// Core packages are those pinned to a full version that matches one of the image tags
			isCorePackage, err := image.IsPackageCoreForAPKO(ctx, apkoYAML, apkoTags, pf.Name, oldPackageName, oldVersion, oldPackageVersionID)
			if err != nil {
				logger.Error(fmt.Errorf("failed to check if package is core for image %s, APKO %s: %w", imageID, templateApkoID, err))
				// Continue processing other APKOs even if one fails
				continue
			}

			if !isCorePackage {
				logger.Debug("Skipping APKO generation - package is not a core package",
					zap.String("image_id", imageID),
					zap.String("apko_id", templateApkoID),
					zap.String("package_name", oldPackageName),
					zap.String("old_version", oldVersion),
					zap.Strings("apko_tags", apkoTags))
				continue
			}

			logger.Info("Generating APKO - package is a core package",
				zap.String("image_id", imageID),
				zap.String("apko_id", templateApkoID),
				zap.String("package_name", oldPackageName),
				zap.String("old_version", oldVersion))

			newApkoID, err := generateSingleImageAPKO(ctx, pf, imageID, templateApkoID, oldApkoVersionID, apkoYAML, apkoTags, oldPackageID, newPackageID, oldPackageName, newPackageName, oldVersion, newVersion, oldMajorMinor, newMajorMinor, templateMelangeYAML)
			if err != nil {
				logger.Error(fmt.Errorf("failed to generate APKO for image %s, template APKO %s: %w", imageID, templateApkoID, err))
				// Continue processing other APKOs even if one fails
				continue
			}

			// Collect image APKO info
			imageAPKOs = append(imageAPKOs, &ImageAPKOInfo{
				ImageID: imageID,
				ApkoID:  newApkoID,
			})
		}
	}

	return imageAPKOs, nil
}

// findTemplateAPKOs finds all APKOs to use as templates for generating new APKO versions
// Priority:
// 1. All APKOs with tags matching oldVersion's semver (major.minor.patch)
// 1a. All APKOs with tags matching oldMajorMinor's semver (major.minor)
// 2. Greatest version tag less than newVersion
// 3. Greatest version tag overall
// 4. APKO tagged "latest"
// 5. Newest APKO by created_at
func findTemplateAPKOs(ctx context.Context, conn *pgxpool.Conn, imageID string, oldPackageID string, oldVersion string, newVersion string, oldMajorMinor string) ([]string, error) {
	// Fetch all APKOs for this image that use the old package
	query := `
		SELECT ia.id, ia.tags, ia.created_at
		FROM image_apko ia
		JOIN image_package ip ON ia.id = ip.apko_id
		WHERE ia.image_id = $1 AND ip.package_id = $2
		ORDER BY ia.created_at DESC
	`
	rows, err := conn.Query(ctx, query, imageID, oldPackageID)
	if err != nil {
		return nil, fmt.Errorf("failed to query APKOs: %w", err)
	}
	defer rows.Close()

	type apkoCandidate struct {
		id        string
		tags      []string
		createdAt time.Time
	}
	var candidates []apkoCandidate

	for rows.Next() {
		var c apkoCandidate
		if err := rows.Scan(&c.id, &c.tags, &c.createdAt); err != nil {
			return nil, fmt.Errorf("failed to scan APKO row: %w", err)
		}
		candidates = append(candidates, c)
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("no APKOs found for image %s with package %s", imageID, oldPackageID)
	}

	// Parse oldVersion and oldMajorMinor for semver comparison
	oldVer, err := semver.NewVersion(oldVersion)
	if err != nil {
		logger.Warn("Failed to parse oldVersion as semver",
			zap.String("oldVersion", oldVersion),
			zap.Error(err))
		oldVer = nil
	}

	oldMMVer, err := semver.NewVersion(oldMajorMinor)
	if err != nil {
		logger.Warn("Failed to parse oldMajorMinor as semver",
			zap.String("oldMajorMinor", oldMajorMinor),
			zap.Error(err))
		oldMMVer = nil
	}

	// Parse newVersion for comparison (this is the version we're upgrading to)
	newVer, err := semver.NewVersion(newVersion)
	if err != nil {
		logger.Warn("Failed to parse newVersion as semver, will skip version-based selection",
			zap.String("newVersion", newVersion),
			zap.Error(err))
	}

	// Priority 1: All APKOs with tags matching oldVersion's semver (major.minor.patch)
	if oldVer != nil {
		var matchingAPKOs []string
		seenAPKOs := make(map[string]bool)

		for _, c := range candidates {
			for _, tag := range c.tags {
				tagVer, err := semver.NewVersion(tag)
				if err != nil {
					continue // Skip non-semver tags
				}

				// Compare major, minor, patch
				if tagVer.Major() == oldVer.Major() &&
					tagVer.Minor() == oldVer.Minor() &&
					tagVer.Patch() == oldVer.Patch() {
					if !seenAPKOs[c.id] {
						matchingAPKOs = append(matchingAPKOs, c.id)
						seenAPKOs[c.id] = true
						logger.Debug("Found template APKO with semver match for oldVersion",
							zap.String("image_id", imageID),
							zap.String("apko_id", c.id),
							zap.String("tag", tag),
							zap.String("old_version", oldVersion))
					}
					break // Move to next candidate
				}
			}
		}

		if len(matchingAPKOs) > 0 {
			return matchingAPKOs, nil
		}
	}

	// Priority 1a: All APKOs with tags matching oldMajorMinor's semver (major.minor)
	if oldMMVer != nil {
		var matchingAPKOs []string
		seenAPKOs := make(map[string]bool)

		for _, c := range candidates {
			for _, tag := range c.tags {
				tagVer, err := semver.NewVersion(tag)
				if err != nil {
					continue // Skip non-semver tags
				}

				// Compare major, minor only
				if tagVer.Major() == oldMMVer.Major() &&
					tagVer.Minor() == oldMMVer.Minor() {
					if !seenAPKOs[c.id] {
						matchingAPKOs = append(matchingAPKOs, c.id)
						seenAPKOs[c.id] = true
						logger.Debug("Found template APKO with semver match for oldMajorMinor",
							zap.String("image_id", imageID),
							zap.String("apko_id", c.id),
							zap.String("tag", tag),
							zap.String("old_major_minor", oldMajorMinor))
					}
					break // Move to next candidate
				}
			}
		}

		if len(matchingAPKOs) > 0 {
			return matchingAPKOs, nil
		}
	}

	// Priority 2 & 3: Greatest version less than newVersion, or greatest version overall
	if newVer != nil {
		var bestLessThan *apkoCandidate
		var bestLessThanVer *semver.Version
		var bestOverall *apkoCandidate
		var bestOverallVer *semver.Version

		for i := range candidates {
			c := &candidates[i]
			for _, tag := range c.tags {
				tagVer, err := semver.NewVersion(tag)
				if err != nil {
					continue // Skip non-semver tags
				}

				// Track greatest version less than newVersion
				if tagVer.LessThan(newVer) {
					if bestLessThanVer == nil || tagVer.GreaterThan(bestLessThanVer) {
						bestLessThan = c
						bestLessThanVer = tagVer
					}
				}

				// Track greatest version overall
				if bestOverallVer == nil || tagVer.GreaterThan(bestOverallVer) {
					bestOverall = c
					bestOverallVer = tagVer
				}
			}
		}

		// Priority 2: Return greatest version less than newVersion
		if bestLessThan != nil {
			logger.Debug("Found template APKO with greatest version less than new version",
				zap.String("image_id", imageID),
				zap.String("apko_id", bestLessThan.id),
				zap.String("version", bestLessThanVer.String()))
			return []string{bestLessThan.id}, nil
		}

		// Priority 3: Return greatest version overall
		if bestOverall != nil {
			logger.Debug("Found template APKO with greatest version overall",
				zap.String("image_id", imageID),
				zap.String("apko_id", bestOverall.id),
				zap.String("version", bestOverallVer.String()))
			return []string{bestOverall.id}, nil
		}
	}

	// Priority 4: APKO tagged "latest"
	for _, c := range candidates {
		for _, tag := range c.tags {
			if tag == "latest" {
				logger.Debug("Found template APKO with 'latest' tag",
					zap.String("image_id", imageID),
					zap.String("apko_id", c.id))
				return []string{c.id}, nil
			}
		}
	}

	// Priority 5: Newest by created_at (already sorted DESC)
	logger.Debug("Found template APKO by newest created_at",
		zap.String("image_id", imageID),
		zap.String("apko_id", candidates[0].id))
	return []string{candidates[0].id}, nil
}

// generateSingleImageAPKO creates a new APKO version for a single APKO with updated package references
func generateSingleImageAPKO(
	ctx context.Context,
	pf *package_family.PackageFamily,
	imageID string,
	oldApkoID string,
	oldApkoVersionID string,
	oldApkoYAML string,
	oldApkoTags []string,
	oldPackageID string,
	newPackageID string,
	oldPackageName string,
	newPackageName string,
	oldVersion string,
	newVersion string,
	oldMajorMinor string,
	newMajorMinor string,
	templateMelangeYAML string,
) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Get subpackage names from the melange YAML
	subpackageNames, err := getSubpackageNames(ctx, templateMelangeYAML)
	if err != nil {
		return "", fmt.Errorf("failed to get subpackage names: %w", err)
	}

	// Transform the APKO YAML for the new minor version
	newApkoYAML, err := transformApkoYAMLForNewMinorVersion(
		oldApkoYAML,
		oldVersion,
		newVersion,
		oldMajorMinor,
		newMajorMinor,
		oldPackageName,
		subpackageNames,
	)
	if err != nil {
		return "", fmt.Errorf("failed to transform APKO YAML: %w", err)
	}

	// Determine the tag template to use
	// Priority: 1) pf.ImageTagTemplate if set, 2) derive from old APKO tags
	tagTemplate := pf.ImageTagTemplate.String
	if tagTemplate == "" && len(oldApkoTags) > 0 {
		// Try to derive template from old APKO tags
		// Select the template with the most components (patch > minor > major)
		derivedTemplate, components := package_family.DeriveTagTemplateFromTags(oldApkoTags, oldVersion)
		if derivedTemplate != "" {
			tagTemplate = derivedTemplate
			logger.Info("Derived tag template from old APKO tags",
				zap.String("old_version", oldVersion),
				zap.String("derived_template", derivedTemplate),
				zap.Int("components", components),
				zap.String("image_id", imageID),
				zap.String("apko_id", oldApkoID))
		}
	}

	// Generate the tag using the template (or fall back to version if no template)
	tag := package_family.GenerateImageTag(tagTemplate, newVersion)
	tags := []string{tag}

	// Versions may not be unique for some images, but tags are. So use the tag as the APKO name.
	newApkoName := tag

	// Start a transaction - all APKO creation operations must succeed together
	// to avoid orphaned records (e.g., image_apko_version without image_package link)
	tx, err := conn.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Check if an APKO with this name already exists for this image
	var existingApkoID string
	err = tx.QueryRow(ctx, `SELECT id FROM image_apko WHERE image_id = $1 AND name = $2`, imageID, newApkoName).Scan(&existingApkoID)
	if err != nil && err != pgx.ErrNoRows {
		return "", fmt.Errorf("failed to check existing APKO: %w", err)
	}

	var newApkoID string
	if err == pgx.ErrNoRows {
		// Create new image_apko record
		newApkoID = generateID()
		_, err = tx.Exec(ctx, `
			INSERT INTO image_apko (id, image_id, name, tags, created_at, updated_at)
			VALUES ($1, $2, $3, $4, NOW(), NOW())
		`, newApkoID, imageID, newApkoName, tags)
		if err != nil {
			return "", fmt.Errorf("failed to create image_apko: %w", err)
		}
		logger.Info("Created new image_apko",
			zap.String("apko_id", newApkoID),
			zap.String("apko_name", newApkoName),
			zap.String("image_id", imageID),
			zap.Strings("tags", tags))
	} else {
		// Use existing APKO ID
		newApkoID = existingApkoID
		logger.Info("Using existing image_apko",
			zap.String("apko_id", newApkoID),
			zap.String("apko_name", newApkoName),
			zap.String("image_id", imageID),
			zap.Strings("tags", tags))
	}

	// Create new image_apko_version record
	newApkoVersionID := generateID()
	_, err = tx.Exec(ctx, `
		INSERT INTO image_apko_version (id, image_apko_id, apko_yaml, created_at, updated_at)
		VALUES ($1, $2, $3, NOW(), NOW())
	`, newApkoVersionID, newApkoID, newApkoYAML)
	if err != nil {
		return "", fmt.Errorf("failed to create image_apko_version: %w", err)
	}

	logger.Info("Auto-created image APKO version",
		zap.String("apko_id", newApkoID),
		zap.String("apko_version_id", newApkoVersionID),
		zap.String("apko_name", newApkoName),
		zap.String("new_version", newVersion),
		zap.String("image_id", imageID))

	// Copy test YAML from old APKO version to new APKO version, updating referenceImage tag
	if err := copyTestYAMLWithUpdatedReferenceImage(ctx, tx, oldApkoID, oldApkoVersionID, newApkoID, newApkoVersionID, tag); err != nil {
		return "", fmt.Errorf("failed to copy test YAML to new APKO version: %w", err)
	}

	// NOTE: Tag reassignment removed from here - will be done globally after all APKOs created
	// This prevents race conditions when multiple versions are processed simultaneously

	// Add the new package to image_package table
	// This is critical so that when the new package finishes building,
	// queueBuildApkoEventsForPackage() will find this APKO and trigger an image build
	// Note: We can't use ListPackagesForAPKO because it resolves from APK repo and the package doesn't exist yet
	logger.Debug("Adding package to image_package table",
		zap.String("imageID", imageID),
		zap.String("apkoID", newApkoID),
		zap.String("packageID", newPackageID),
		zap.String("pinnedVersion", newVersion))

	_, err = tx.Exec(ctx, `
		INSERT INTO image_package (image_id, apko_id, package_id, pinned_version)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (apko_id, package_id) DO UPDATE
		SET pinned_version = EXCLUDED.pinned_version
	`, imageID, newApkoID, newPackageID, newVersion)
	if err != nil {
		return "", fmt.Errorf("failed to insert new package into image_package table: %w", err)
	}

	logger.Debug("added new package to image_package table",
		zap.String("newApkoID", newApkoID),
		zap.String("newPackageID", newPackageID))

	// Commit the transaction - all records created atomically
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("failed to commit transaction: %w", err)
	}

	return newApkoID, nil
}

// copyTestYAMLWithUpdatedReferenceImage copies test YAML from old to new APKO version,
// updating the referenceImage tag (e.g., "bitnami/kubectl:1.33.4" -> "bitnami/kubectl:1.34.0")
func copyTestYAMLWithUpdatedReferenceImage(
	ctx context.Context,
	tx pgx.Tx,
	oldApkoID string,
	oldApkoVersionID string,
	newApkoID string,
	newApkoVersionID string,
	newTag string,
) error {
	var testYAML string
	var description sql.NullString
	err := tx.QueryRow(ctx, `
		SELECT yaml_content, description
		FROM image_test
		WHERE apko_id = $1 AND apko_version_id = $2
	`, oldApkoID, oldApkoVersionID).Scan(&testYAML, &description)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil // No test YAML exists - this is normal
		}
		return fmt.Errorf("failed to fetch test YAML: %w", err)
	}

	// Transform the test YAML by updating the referenceImage tag
	transformedYAML, err := updateReferenceImageTag(testYAML, newTag)
	if err != nil {
		return fmt.Errorf("failed to transform test YAML: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO image_test (id, apko_id, apko_version_id, yaml_content, description, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
		ON CONFLICT (apko_id, apko_version_id)
		DO UPDATE SET yaml_content = EXCLUDED.yaml_content, description = EXCLUDED.description, updated_at = NOW()
	`, "it"+generateID(), newApkoID, newApkoVersionID, transformedYAML, description)
	if err != nil {
		return fmt.Errorf("failed to insert test YAML: %w", err)
	}

	logger.Info("Copied test YAML with updated referenceImage",
		zap.String("new_apko_version_id", newApkoVersionID),
		zap.String("new_tag", newTag))
	return nil
}

// updateReferenceImageTag updates the tag in the referenceImage field of a test YAML
// Uses structured parsing for robustness, then replaces only the referenceImage line
// to preserve comments and formatting.
//
// Image references using digests (@sha256:...) are left unchanged, as digest-pinned
// images should not have their tags updated.
func updateReferenceImageTag(testYAML string, newTag string) (string, error) {
	if testYAML == "" {
		return testYAML, nil
	}

	// Parse the test YAML to get the referenceImage value
	var testDef map[string]interface{}
	if err := yaml.Unmarshal([]byte(testYAML), &testDef); err != nil {
		return "", fmt.Errorf("failed to parse test YAML: %w", err)
	}

	// Check if referenceImage field exists
	refImage, exists := testDef["referenceImage"]
	if !exists {
		return testYAML, nil
	}

	refImageStr, ok := refImage.(string)
	if !ok || refImageStr == "" {
		return testYAML, nil
	}

	// Parse the image reference using the container registry package
	ref, err := name.ParseReference(refImageStr)
	if err != nil {
		return "", fmt.Errorf("failed to parse image reference %q: %w", refImageStr, err)
	}

	// Check if the image reference uses a digest (@sha256:...)
	if _, isDigest := ref.(name.Digest); isDigest {
		logger.Debug("Image reference uses digest, skipping tag update",
			zap.String("referenceImage", refImageStr))
		return testYAML, nil
	}

	// Build the new image reference with updated tag
	newRefImage := ref.Context().Name() + ":" + newTag

	// Replace the referenceImage field value by finding the line that starts with "referenceImage:"
	// This ensures we only replace the top-level field, not occurrences in comments
	lines := strings.Split(testYAML, "\n")
	found := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "referenceImage:") {
			// Replace only on this line
			lines[i] = strings.Replace(line, refImageStr, newRefImage, 1)
			found = true
			break
		}
	}

	if !found {
		return "", fmt.Errorf("failed to find referenceImage field in YAML")
	}

	return strings.Join(lines, "\n"), nil
}

// getSubpackageNames returns the names of all subpackages from the melange YAML
func getSubpackageNames(ctx context.Context, melangeYAML string) ([]string, error) {
	// Parse the melange YAML to get subpackages
	compiled, err := sbpackage.CompileMelangeYAML(ctx, []byte(melangeYAML))
	if err != nil {
		return nil, fmt.Errorf("failed to compile melange YAML: %w", err)
	}

	// Extract subpackage names from the provides section
	var subpackageNames []string
	for _, subpkg := range compiled.Subpackages {
		subpackageNames = append(subpackageNames, subpkg.Name)
		if subpkg.Dependencies.Provides != nil {
			for _, provide := range subpkg.Dependencies.Provides {
				// Parse the provide string using apko's package name parser
				parsed := apkopackage.ResolvePackageNameVersionPin(provide)
				if parsed.Name != "" {
					subpackageNames = append(subpackageNames, parsed.Name)
				}
			}
		}
	}

	return subpackageNames, nil
}

// stripVersionSuffix removes the version suffix from a package name
// Example: "bash-5.2" -> "bash", "bash-entrypoint-5.2" -> "bash-entrypoint"
func stripVersionSuffix(packageName string, majorMinor string) string {
	suffix := "-" + majorMinor
	if strings.HasSuffix(packageName, suffix) {
		return strings.TrimSuffix(packageName, suffix)
	}
	return packageName
}

// transformApkoYAMLForNewMinorVersion transforms an APKO YAML to use a new minor version
// It parses the YAML, finds packages matching the exact package names, and replaces them with pinned new versions
func transformApkoYAMLForNewMinorVersion(
	apkoYAML string,
	oldVersion string,
	newVersion string,
	oldMajorMinor string,
	newMajorMinor string,
	oldPackageName string,
	subpackageNames []string,
) (string, error) {
	// Parse the APKO YAML to find packages to replace
	var imageConfig apkotypes.ImageConfiguration
	if err := yaml.Unmarshal([]byte(apkoYAML), &imageConfig); err != nil {
		return "", fmt.Errorf("failed to parse APKO YAML: %w", err)
	}

	// Build a map of package replacements
	replacements := make(map[string]string)

	// Process each package in the contents.packages array
	for _, pkg := range imageConfig.Contents.Packages {
		// Parse the package name and version using apko's parser
		parsed := apkopackage.ResolvePackageNameVersionPin(pkg)
		if parsed.Name == "" {
			continue
		}

		// Strip version suffix from the package name
		baseName := stripVersionSuffix(parsed.Name, oldMajorMinor)

		// First check if this is the main package
		if baseName == stripVersionSuffix(oldPackageName, oldMajorMinor) {
			// Replace the old version in the full package name
			newName := strings.Replace(parsed.Name, oldMajorMinor, newMajorMinor, 1)
			newPkg := fmt.Sprintf("%s~%s", newName, newVersion)
			replacements[pkg] = newPkg
			continue
		}

		// Then check subpackages
		for _, subpkgName := range subpackageNames {
			if baseName == stripVersionSuffix(subpkgName, oldMajorMinor) {
				// Replace the old version in the subpackage name
				newName := strings.Replace(parsed.Name, oldMajorMinor, newMajorMinor, 1)
				newPkg := fmt.Sprintf("%s~%s", newName, newVersion)
				replacements[pkg] = newPkg
				break
			}
		}
	}

	// Apply replacements to the YAML string
	result := apkoYAML
	for oldPkg, newPkg := range replacements {
		result = strings.ReplaceAll(result, oldPkg, newPkg)
	}

	// Replace all occurrences of the old version string with the new version string
	// This handles version references in environment variables, annotations, and any other location
	result = strings.ReplaceAll(result, oldVersion, newVersion)

	return result, nil
}

// reassignTagsGlobally performs tag reassignment for all affected images
// MUST be called BEFORE queueing any builds to prevent race conditions
func reassignTagsGlobally(ctx context.Context, pf *package_family.PackageFamily, updateResults []*UpdateResult) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Collect unique image IDs that need tag reassignment
	affectedImages := make(map[string]bool)
	for _, result := range updateResults {
		for _, apkoInfo := range result.ImageAPKOs {
			affectedImages[apkoInfo.ImageID] = true
		}
	}

	logger.Info("Reassigning tags globally before queueing builds",
		zap.Int("affected_images", len(affectedImages)),
		zap.String("package_family", pf.Name))

	// Start transaction for tag reassignments
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Reassign tags for each affected image
	for imageID := range affectedImages {
		if err := image.ReassignTagsForImage(ctx, tx, imageID); err != nil {
			logger.Error(fmt.Errorf("failed to reassign tags for image %s: %w", imageID, err))
			// Continue with other images
		}
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// queuePackageBuild queues a package build
// For minor version updates: creates package_create record + triggers create_package event
// For patch version updates: triggers build_package_chain to rebuild the package and all dependents
func queuePackageBuild(ctx context.Context, packageFamily *package_family.PackageFamily, result *UpdateResult) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	if result.CreateNewPackage {
		// Minor version: Create package_create record AND trigger create_package event (after tag reassignment)
		var additionalFilesData sql.NullString
		if result.AdditionalFilesData != nil {
			additionalFilesData = sql.NullString{String: *result.AdditionalFilesData, Valid: true}
		}

		// Generate ID for package_create record
		packageCreateID := generateID()

		// Create the package_create record
		_, err := conn.Exec(ctx,
			`INSERT INTO package_create (id, package_id, melange_yaml, additional_files_data, created_at, use_root, custom_disk_size)
			VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
			packageCreateID, result.PackageID, result.MelangeYAML, additionalFilesData, result.UseRoot, result.CustomDiskSize)
		if err != nil {
			logger.Error(fmt.Errorf("failed to create package_create record for package %s (create_id=%s): %w", result.PackageID, packageCreateID, err))
			return fmt.Errorf("failed to create package_create record: %w", err)
		}

		logger.Debug("Successfully created package_create record",
			zap.String("package_create_id", packageCreateID),
			zap.String("package_id", result.PackageID))

		// Trigger create_package event
		payloadJSON := fmt.Sprintf(`{"id":"%s"}`, packageCreateID)
		if err := persistence.EnqueueWork(ctx, "create_package", []byte(payloadJSON)); err != nil {
			return fmt.Errorf("failed to enqueue package creation work: %w", err)
		}

		logger.Warn("⚡ Auto-created package (after tag reassignment)",
			zap.String("package_id", result.PackageID),
			zap.String("package_create_id", packageCreateID))

		return nil
	}

	// Patch version: package_version already created, queue build_package_chain to rebuild
	// the package and all packages that depend on it
	buildPackageChainPayload := BuildPackageChainPayload{
		PackageID:        result.PackageID,
		PackageVersionID: result.PackageVersionID,
	}

	b, err := json.Marshal(buildPackageChainPayload)
	if err != nil {
		return fmt.Errorf("failed to marshal build package chain payload: %w", err)
	}

	if err := persistence.EnqueueWork(ctx, "build_package_chain", b); err != nil {
		return fmt.Errorf("failed to enqueue build package chain message: %w", err)
	}

	logger.Info("Queued package build chain (includes dependents)",
		zap.String("package_id", result.PackageID),
		zap.String("package_version_id", result.PackageVersionID))

	return nil
}

// queueImageBuildForAPKO queues an image build for a specific APKO
// This is used for APKO-only generation where we don't need to rebuild the package
func queueImageBuildForAPKO(ctx context.Context, apkoID string) error {
	// Get the latest APKO version
	latestApkoVersion, err := image.GetLatestImageAPKOVersion(ctx, apkoID)
	if err != nil {
		return fmt.Errorf("failed to get latest APKO version for %s: %w", apkoID, err)
	}

	// Create image build record
	imageBuild, err := image.CreateImageBuild(ctx, latestApkoVersion.ID)
	if err != nil {
		return fmt.Errorf("failed to create image build for APKO %s: %w", apkoID, err)
	}

	// Update build status to queued
	if err := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusQueued); err != nil {
		logger.Warn("failed to update image build status to queued", zap.Error(err))
	}

	// Assign VM using the shared helper
	vmID, workDir, err := assignVMForImageBuild(ctx, imageBuild.ID)
	if err != nil {
		if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, err); statusErr != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
		}
		return fmt.Errorf("failed to assign VM for image build: %w", err)
	}

	// Update build record with VM ID (builder ID)
	if err := image.SetImageBuildBuilderID(ctx, imageBuild.ID, vmID); err != nil {
		logger.Warn("failed to set image build builder ID", zap.Error(err))
	}

	// Create payload for build_image_with_vm_assigned event
	payload := BuildImageWithVMAssignedPayload{
		VMID:    vmID,
		BuildID: imageBuild.ID,
		WorkDir: workDir,
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("JSON marshalling failure: %w", err)); statusErr != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
		}
		return fmt.Errorf("failed to marshal build_image_with_vm_assigned payload: %w", err)
	}

	// Enqueue the build
	if err := persistence.EnqueueWork(ctx, "build_image_with_vm_assigned", string(payloadJSON)); err != nil {
		if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("work queue enqueue failure: %w", err)); statusErr != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
		}
		return fmt.Errorf("failed to enqueue build_image_with_vm_assigned event: %w", err)
	}

	logger.Info("Queued image build for APKO",
		zap.String("apko_id", apkoID),
		zap.String("apko_version_id", latestApkoVersion.ID),
		zap.String("image_build_id", imageBuild.ID),
		zap.String("vm_id", vmID))

	return nil
}
