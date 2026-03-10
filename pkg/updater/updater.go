package updater

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"chainguard.dev/melange/pkg/config"
	semver "github.com/Masterminds/semver/v3"
	"github.com/google/go-github/v61/github"
	"github.com/securebuildhq/securebuild/pkg/execution"
	executiontypes "github.com/securebuildhq/securebuild/pkg/execution/types"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/package_family"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/releasemonitor"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

func Start(ctx context.Context) error {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			err := UpdatePackages(ctx)
			if err != nil {
				logger.Errorf("failed to update packages: %v", err)
			}
		case <-ctx.Done():
			return nil
		}
	}
}

func UpdatePackages(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now().UTC()
	rows, err := conn.Query(ctx, `
		SELECT id FROM package WHERE check_for_updates_at < $1 order by random() LIMIT 25
	`, now)
	if err != nil {
		return fmt.Errorf("failed to query packages: %w", err)
	}
	defer rows.Close()

	idsNeedingCheck := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("failed to scan package: %w", err)
		}
		idsNeedingCheck = append(idsNeedingCheck, id)
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to iterate over packages: %w", err)
	}

	for _, id := range idsNeedingCheck {
		if err := UpdatePackage(ctx, id); err != nil {
			if err == ErrBuildInProgress {
				// set the next build time to be 5 minutes from now
				// we do this so that other packages can get updated if a large package
				// is blocking the queue
				nextUpdateCheck := time.Now().UTC().Add(5 * time.Minute)
				if _, err := conn.Exec(ctx, `
					UPDATE package SET check_for_updates_at = $1 WHERE id = $2
				`, nextUpdateCheck, id); err != nil {
					return fmt.Errorf("failed to update package check_for_updates_at: %w", err)
				}
				continue
			} else if err == ErrUpdatesNotEnabled {
				// set the next build time to be 6 hours from now
				nextUpdateCheck := time.Now().UTC().Add(6 * time.Hour)
				if _, err := conn.Exec(ctx, `
					UPDATE package SET check_for_updates_at = $1 WHERE id = $2
				`, nextUpdateCheck, id); err != nil {
					return fmt.Errorf("failed to update package check_for_updates_at: %w", err)
				}
				continue
			} else {
				logger.Warn("failed to update package", zap.String("package_id", id), zap.Error(err))

				nextUpdateCheck := time.Now().UTC().Add(6 * time.Hour)
				if _, err := conn.Exec(ctx, `
					UPDATE package SET check_for_updates_at = $1 WHERE id = $2
				`, nextUpdateCheck, id); err != nil {
					return fmt.Errorf("failed to update package check_for_updates_at: %w", err)
				}
				continue
			}
		}

		nextUpdateCheck := time.Now().UTC().Add(1 * time.Hour)
		logger.Debug("updating package check_for_updates_at", zap.String("package_id", id), zap.Time("next_update_check", nextUpdateCheck))

		if _, err := conn.Exec(ctx, `
			UPDATE package SET check_for_updates_at = $1 WHERE id = $2
		`, nextUpdateCheck, id); err != nil {
			return fmt.Errorf("failed to update package check_for_updates_at: %w", err)
		}
	}
	return nil
}

var (
	ErrBuildInProgress   = errors.New("build in progress")
	ErrUpdatesNotEnabled = errors.New("updates not enabled")
)

func UpdatePackage(ctx context.Context, id string) error {
	logger.Debug("checking for updates for package", zap.String("package_id", id))
	// get the latest version of the package
	pkgVersion, err := sbpackage.GetLatestPackageVersion(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get latest package version: %w", err)
	}

	// if the current status is building or there's an execution queued, we need to ignore for now
	executionStatus, err := execution.GetExcecutionStatusForPackageVersionID(ctx, pkgVersion.ID)
	if err != nil {
		return fmt.Errorf("failed to get execution status for package version: %w", err)
	}
	if executionStatus == executiontypes.ExecutionStatusPending ||
		executionStatus == executiontypes.ExecutionStatusQueued ||
		executionStatus == executiontypes.ExecutionStatusBuilding ||
		executionStatus == executiontypes.ExecutionStatusPublishing {
		return ErrBuildInProgress
	}

	compiled, err := sbpackage.CompileMelangeYAML(ctx, []byte(pkgVersion.MelangeYaml))
	if err != nil {
		return fmt.Errorf("failed to compile melange yaml: %w", err)
	}

	if !compiled.Update.Enabled {
		return ErrUpdatesNotEnabled
	}

	// Check if this package belongs to a package family
	packageFamily, err := lookupPackageFamilyByPackageID(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to lookup package family: %w", err)
	}

	// If package belongs to a family, skip update - the family will handle it
	if packageFamily != nil {
		logger.Info("Package belongs to family, skipping legacy updater (family will handle updates)",
			zap.String("package_id", id),
			zap.String("package_name", compiled.Package.Name),
			zap.String("family_id", packageFamily.ID),
			zap.String("family_name", packageFamily.Name))
		return nil
	}

	// Package doesn't belong to a family - create synthetic family and process patch updates only
	logger.Debug("Package does not belong to family, creating synthetic family for patch updates",
		zap.String("package_id", id),
		zap.String("package_name", compiled.Package.Name))

	syntheticFamily, err := createSyntheticPackageFamily(ctx, id, compiled)
	if err != nil {
		return fmt.Errorf("failed to create synthetic package family: %w", err)
	}

	// Process patch updates only using the unified logic
	if err := processPatchUpdatesOnly(ctx, syntheticFamily, id, compiled); err != nil {
		return fmt.Errorf("failed to process patch updates: %w", err)
	}

	return nil
}

func handleGitHubMonitor(ctx context.Context, compiled *config.Configuration) (string, string, error) {
	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: param.GetParam(ctx).UpdaterGithubAPIToken})
	tc := oauth2.NewClient(ctx, ts)
	client := github.NewClient(tc)

	var result *GitHubVersionResult
	var err error

	if compiled.Update.GitHubMonitor.UseTags {
		result, err = FetchLatestSemverTag(ctx, client, GitHubMonitorConfig{
			Identifier:        compiled.Update.GitHubMonitor.Identifier,
			StripPrefix:       compiled.Update.GitHubMonitor.StripPrefix,
			StripSuffix:       compiled.Update.GitHubMonitor.StripSuffix,
			TagFilter:         compiled.Update.GitHubMonitor.TagFilter,
			TagFilterPrefix:   compiled.Update.GitHubMonitor.TagFilterPrefix,
			TagFilterContains: compiled.Update.GitHubMonitor.TagFilterContains,
		})
		if err != nil {
			return "", "", fmt.Errorf("failed to fetch latest semver tag: %w", err)
		}
	} else {
		result, err = FetchLatestRelease(ctx, client, GitHubMonitorConfig{
			Identifier:        compiled.Update.GitHubMonitor.Identifier,
			StripPrefix:       compiled.Update.GitHubMonitor.StripPrefix,
			StripSuffix:       compiled.Update.GitHubMonitor.StripSuffix,
			TagFilter:         compiled.Update.GitHubMonitor.TagFilter,
			TagFilterPrefix:   compiled.Update.GitHubMonitor.TagFilterPrefix,
			TagFilterContains: compiled.Update.GitHubMonitor.TagFilterContains,
		})
		if err != nil {
			return "", "", fmt.Errorf("failed to fetch latest release: %w", err)
		}
	}

	if result == nil {
		return "", "", nil
	}

	latestVersion := result.Version
	latestVersionCommit := result.Commit

	// Apply filters
	if compiled.Update.GitHubMonitor.TagFilterPrefix != "" {
		if !strings.HasPrefix(latestVersion, compiled.Update.GitHubMonitor.TagFilterPrefix) {
			return "", "", nil
		}
	}

	if compiled.Update.GitHubMonitor.TagFilterContains != "" {
		if !strings.Contains(latestVersion, compiled.Update.GitHubMonitor.TagFilterContains) {
			return "", "", nil
		}
	}

	// Apply version transformations
	if latestVersion != "" {
		latestVersion = strings.TrimPrefix(latestVersion, compiled.Update.GitHubMonitor.StripPrefix)
		latestVersion = strings.TrimSuffix(latestVersion, compiled.Update.GitHubMonitor.StripSuffix)
	}

	return latestVersion, latestVersionCommit, nil
}

func handleReleaseMonitor(ctx context.Context, compiled *config.Configuration) (string, string, error) {
	if compiled.Update.ReleaseMonitor == nil {
		return "", "", fmt.Errorf("release monitor configuration is nil")
	}

	// Fetch versions from release-monitoring.org API
	response, err := releasemonitor.FetchVersions(ctx, compiled.Update.ReleaseMonitor.Identifier)
	if err != nil {
		return "", "", err
	}

	latestVersion, err := findLatestMatchingVersion(compiled, response)
	if err != nil {
		return "", "", fmt.Errorf("failed to find latest matching version: %w", err)
	}

	// Apply version transformations
	if latestVersion != "" {
		latestVersion = releasemonitor.ApplyTransformations(latestVersion, compiled.Update.ReleaseMonitor)
	}

	// Release monitor doesn't provide commit information
	return latestVersion, "", nil
}

type versionPair struct {
	semver   *semver.Version
	original string
}

// findLatestMatchingVersion finds the latest version that matches the package constraints.
// If there are no constraints (explicit filters or version in package name), it returns the latest_version from the response.
// Otherwise, it searches through stable_versions to find the latest version matching the constraints.
func findLatestMatchingVersion(compiled *config.Configuration, response *releasemonitor.Response) (string, error) {
	// First check if we have any constraints that would require searching through stable versions
	hasVersionConstraint := false
	var constraintMajor, constraintMinor *uint64

	// Look for patterns like "-X.Y" at the end of package name
	if idx := strings.LastIndex(compiled.Package.Name, "-"); idx != -1 {
		versionPart := compiled.Package.Name[idx+1:]
		if sv, err := semver.NewVersion(versionPart); err == nil {
			// Only use version from package name if it matches the start of the current version
			// This ensures we don't use version-like strings that aren't actually version constraints
			// e.g., "codes-21" with version "1.5.3" - the "21" isn't a version constraint
			if strings.HasPrefix(compiled.Package.Version, versionPart) {
				major := sv.Major()
				minor := sv.Minor()
				constraintMajor = &major
				constraintMinor = &minor
				hasVersionConstraint = true
				logger.Debug("found version constraint in package name",
					zap.String("package", compiled.Package.Name),
					zap.String("version", compiled.Package.Version),
					zap.Uint64("major", major),
					zap.Uint64("minor", minor))
			} else {
				logger.Debug("ignoring version in package name - doesn't match package version",
					zap.String("package", compiled.Package.Name),
					zap.String("name_version", versionPart),
					zap.String("package_version", compiled.Package.Version))
			}
		}
	}

	// Check for explicit filters
	hasExplicitFilters := compiled.Update.ReleaseMonitor.VersionFilterPrefix != "" ||
		compiled.Update.ReleaseMonitor.VersionFilterContains != ""

	// If no constraints, use latest_version from response
	if !hasVersionConstraint && !hasExplicitFilters {
		// Still validate it's a proper version
		if _, err := semver.NewVersion(response.LatestVersion); err != nil {
			return "", fmt.Errorf("invalid latest version from API: %s: %w", response.LatestVersion, err)
		}
		return response.LatestVersion, nil
	}

	// We have constraints, search through stable versions
	var matchingVersions []versionPair
	for _, stableVersion := range response.StableVersions {
		checkPackageName := true

		// Apply explicit filters if they exist
		if compiled.Update.ReleaseMonitor.VersionFilterPrefix != "" {
			if !strings.HasPrefix(stableVersion, compiled.Update.ReleaseMonitor.VersionFilterPrefix) {
				checkPackageName = false
			}
		}

		if compiled.Update.ReleaseMonitor.VersionFilterContains != "" {
			if !strings.Contains(stableVersion, compiled.Update.ReleaseMonitor.VersionFilterContains) {
				checkPackageName = false
			}
		}

		if checkPackageName {
			sv, err := semver.NewVersion(stableVersion)
			if err != nil {
				// Skip versions we can't parse
				logger.Debug("skipping unparseable version", zap.String("version", stableVersion), zap.Error(err))
				continue
			}

			// If we have version constraints from package name, verify major/minor match
			if constraintMajor != nil && constraintMinor != nil {
				if sv.Major() != *constraintMajor || sv.Minor() != *constraintMinor {
					logger.Debug("skipping version due to package name constraint",
						zap.String("version", stableVersion),
						zap.Uint64("expected_major", *constraintMajor),
						zap.Uint64("expected_minor", *constraintMinor),
						zap.Uint64("version_major", sv.Major()),
						zap.Uint64("version_minor", sv.Minor()))
					continue
				}
			}

			matchingVersions = append(matchingVersions, versionPair{semver: sv, original: stableVersion})
		}
	}

	// Sort versions in descending order (newest first)
	sort.Slice(matchingVersions, func(i, j int) bool {
		return matchingVersions[i].semver.GreaterThan(matchingVersions[j].semver)
	})

	// If we found matching versions, get the latest one
	if len(matchingVersions) > 0 {
		return matchingVersions[0].original, nil
	}

	// No matching versions found
	return "", nil
}

// generateID generates a random ID for database records
func generateID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return fmt.Sprintf("%x", b)
}

// lookupPackageFamilyByPackageID reverse-lookups a package family from a package ID
// Returns nil if no family found (not an error - package just doesn't belong to a family)
func lookupPackageFamilyByPackageID(ctx context.Context, packageID string) (*package_family.PackageFamily, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Get package name and latest version
	var packageName, version string
	err := conn.QueryRow(ctx, `
		SELECT p.name, pv.version
		FROM package p
		INNER JOIN package_version pv ON p.id = pv.package_id
		WHERE p.id = $1
		ORDER BY pv.created_at DESC
		LIMIT 1
	`, packageID).Scan(&packageName, &version)
	if err != nil {
		return nil, fmt.Errorf("failed to get package name and version: %w", err)
	}

	// Parse version to extract major.minor
	ver, err := semver.NewVersion(version)
	if err != nil {
		return nil, fmt.Errorf("failed to parse version %q: %w", version, err)
	}
	major := int(ver.Major())
	minor := int(ver.Minor())

	// Query candidate families where package name matches pattern
	query := `
		SELECT id, name, monitoring_enabled, check_frequency_minutes,
		       version_pattern, major_version_filter, package_name_template,
		       dry_run_mode, min_version, notify_on_detection,
		       notify_on_build_failure, check_for_updates_at, last_check_at,
		       last_error, consecutive_errors, created_at, updated_at,
		       image_tag_template
		FROM package_family
		WHERE $1 LIKE name || '-%'
	`
	rows, err := conn.Query(ctx, query, packageName)
	if err != nil {
		return nil, fmt.Errorf("failed to query package families: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var pf package_family.PackageFamily
		if err := rows.Scan(
			&pf.ID, &pf.Name, &pf.MonitoringEnabled,
			&pf.CheckFrequencyMinutes, &pf.VersionPattern,
			&pf.MajorVersionFilter, &pf.PackageNameTemplate,
			&pf.DryRunMode, &pf.MinVersion, &pf.NotifyOnDetection,
			&pf.NotifyOnBuildFailure, &pf.CheckForUpdatesAt, &pf.LastCheckAt,
			&pf.LastError, &pf.ConsecutiveErrors, &pf.CreatedAt, &pf.UpdatedAt,
			&pf.ImageTagTemplate,
		); err != nil {
			return nil, fmt.Errorf("failed to scan family row: %w", err)
		}

		// Generate package name from template and check if it matches
		generatedName := package_family.GeneratePackageName(pf.PackageNameTemplate, pf.Name, major, minor)
		if generatedName == packageName {
			logger.Debug("Found package family for package",
				zap.String("package_id", packageID),
				zap.String("package_name", packageName),
				zap.String("family_id", pf.ID),
				zap.String("family_name", pf.Name))
			return &pf, nil
		}
	}

	// No family found - this is normal for standalone packages
	logger.Debug("No package family found for package",
		zap.String("package_id", packageID),
		zap.String("package_name", packageName))
	return nil, nil
}

// createSyntheticPackageFamily creates a runtime-only package family for packages without a real family
// This allows standalone packages to use the unified update logic for patch updates
func createSyntheticPackageFamily(ctx context.Context, packageID string, compiled *config.Configuration) (*package_family.PackageFamily, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Get package name
	var packageName string
	err := conn.QueryRow(ctx, `SELECT name FROM package WHERE id = $1`, packageID).Scan(&packageName)
	if err != nil {
		return nil, fmt.Errorf("failed to get package name: %w", err)
	}

	// Create synthetic family with ID based on package ID
	syntheticFamily := &package_family.PackageFamily{
		ID:                    "synthetic-" + packageID,
		Name:                  packageName,
		MonitoringEnabled:     true,
		DryRunMode:            false,
		PackageNameTemplate:   packageName, // No versioning in template
		VersionPattern:        sql.NullString{String: ".*", Valid: true},
		ImageTagTemplate:      sql.NullString{String: "{{.Version}}", Valid: true},
		CheckFrequencyMinutes: 60,
		NotifyOnDetection:     false,
		NotifyOnBuildFailure:  false,
	}

	logger.Debug("Created synthetic package family",
		zap.String("package_id", packageID),
		zap.String("package_name", packageName),
		zap.String("synthetic_family_id", syntheticFamily.ID))

	return syntheticFamily, nil
}

// classifyVersionChange determines the type of version change (major, minor, or patch)
func classifyVersionChange(oldVer, newVer *semver.Version) string {
	if newVer.Major() > oldVer.Major() {
		return "major"
	}
	if newVer.Minor() > oldVer.Minor() {
		return "minor"
	}
	if newVer.Patch() > oldVer.Patch() {
		return "patch"
	}
	return "none"
}

// processPatchUpdatesOnly handles patch-only updates for packages without real families
// It uses the unified logic but only allows patch updates (no new packages for major/minor)
func processPatchUpdatesOnly(ctx context.Context, pf *package_family.PackageFamily, packageID string, compiled *config.Configuration) error {
	currentVer, err := semver.NewVersion(compiled.Package.Version)
	if err != nil {
		return fmt.Errorf("invalid current package version %q: %w", compiled.Package.Version, err)
	}

	// Fetch latest version from upstream (GitHub or release-monitor)
	var latestVersion, latestVersionCommit string

	if compiled.Update.GitHubMonitor != nil {
		latestVersion, latestVersionCommit, err = handleGitHubMonitor(ctx, compiled)
		if err != nil {
			return err
		}
	} else if compiled.Update.ReleaseMonitor != nil {
		latestVersion, latestVersionCommit, err = handleReleaseMonitor(ctx, compiled)
		if err != nil {
			return err
		}
	} else {
		return fmt.Errorf("no update monitor configured")
	}

	// If no version found, nothing to do
	if latestVersion == "" {
		return nil
	}

	latestVer, err := semver.NewVersion(latestVersion)
	if err != nil {
		return fmt.Errorf("invalid latest upstream version %q: %w", latestVersion, err)
	}

	// Check if there's a newer version
	if !latestVer.GreaterThan(currentVer) {
		return nil
	}

	// Classify the version change
	changeType := classifyVersionChange(currentVer, latestVer)

	logger.Info("Detected version change",
		zap.String("package_id", packageID),
		zap.String("current_version", currentVer.Original()),
		zap.String("latest_version", latestVer.Original()),
		zap.String("change_type", changeType))

	// Only allow patch updates for synthetic families
	if changeType != "patch" {
		logger.Warn("Skipping non-patch update for package without family (major/minor updates require real family)",
			zap.String("package_id", packageID),
			zap.String("package_name", compiled.Package.Name),
			zap.String("change_type", changeType),
			zap.String("current_version", currentVer.Original()),
			zap.String("latest_version", latestVer.Original()))
		return nil
	}

	// Process the patch update using existing logic
	logger.Info("Processing patch update for package without family",
		zap.String("package_id", packageID),
		zap.String("package_name", compiled.Package.Name),
		zap.String("current_version", currentVer.Original()),
		zap.String("latest_version", latestVer.Original()))

	// Create new package version
	newPkgVersion, err := sbpackage.CreateNewReleaseForLatestPackageVersion(ctx, packageID, latestVersion, latestVersionCommit)
	if err != nil {
		return fmt.Errorf("failed to create new package version: %w", err)
	}

	// Queue build
	buildPackagePayload := listener.BuildPackageChainPayload{
		PackageID:        packageID,
		PackageVersionID: newPkgVersion.ID,
	}

	b, err := json.Marshal(buildPackagePayload)
	if err != nil {
		return fmt.Errorf("failed to marshal build package payload: %w", err)
	}

	if err := persistence.EnqueueWork(ctx, "build_package_chain", b); err != nil {
		return fmt.Errorf("failed to enqueue build package message: %w", err)
	}

	return nil
}
