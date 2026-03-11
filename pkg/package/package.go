package sbpackage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	apkopackage "chainguard.dev/apko/pkg/apk/apk"
	"chainguard.dev/melange/pkg/build"
	"chainguard.dev/melange/pkg/config"
	"github.com/Masterminds/semver"
	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/builder"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/pipeline"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

func ListPackageVersions(ctx context.Context, packageID string) ([]*types.PackageVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT id FROM package_version WHERE package_id = $1`
	rows, err := conn.Query(ctx, query, packageID)
	if err != nil {
		return nil, fmt.Errorf("list package versions: %w", err)
	}
	defer rows.Close()

	packageVersionIDs := []string{}
	for rows.Next() {
		var packageVersionID string
		err := rows.Scan(&packageVersionID)
		if err != nil {
			return nil, fmt.Errorf("scan package version id: %w", err)
		}
		packageVersionIDs = append(packageVersionIDs, packageVersionID)
	}
	rows.Close()

	packageVersions := []*types.PackageVersion{}
	for _, packageVersionID := range packageVersionIDs {
		packageVersion, err := getPackageVersion(ctx, packageVersionID)
		if err != nil {
			return nil, fmt.Errorf("get package version: %w", err)
		}
		packageVersions = append(packageVersions, packageVersion)
	}

	return packageVersions, nil
}

func ListAllPackageVersions(ctx context.Context) ([]*types.PackageVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT id FROM package_version`
	rows, err := conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list all package versions: %w", err)
	}
	defer rows.Close()

	packageVersionIDs := []string{}
	for rows.Next() {
		var packageVersionID string
		err := rows.Scan(&packageVersionID)
		if err != nil {
			return nil, fmt.Errorf("scan package version id: %w", err)
		}
		packageVersionIDs = append(packageVersionIDs, packageVersionID)
	}
	rows.Close()

	packageVersions := []*types.PackageVersion{}
	for _, packageVersionID := range packageVersionIDs {
		// TODO: this should not call getPackageVersion, that query should be run once at the top level not once for each version
		packageVersion, err := getPackageVersion(ctx, packageVersionID)
		if err != nil {
			return nil, fmt.Errorf("get package version: %w", err)
		}
		packageVersions = append(packageVersions, packageVersion)
	}

	return packageVersions, nil
}

func ListPackageVersionsFailed(ctx context.Context) ([]*types.PackageVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	packageIDs := []string{}
	rows, err := conn.Query(ctx, `SELECT id FROM package WHERE parent_id IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("list package versions needing build: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var packageID string
		err := rows.Scan(&packageID)
		if err != nil {
			return nil, fmt.Errorf("scan package id: %w", err)
		}

		packageIDs = append(packageIDs, packageID)
	}
	rows.Close()

	latestPackageVersionIDs := []string{}
	for _, packageID := range packageIDs {
		query := `select id from package_version where package_id = $1 order by created_at desc limit 1`
		var packageVersionID string
		err := conn.QueryRow(ctx, query, packageID).Scan(&packageVersionID)
		if err != nil {
			return nil, fmt.Errorf("scan package version id: %w", err)
		}
		latestPackageVersionIDs = append(latestPackageVersionIDs, packageVersionID)
	}

	packageVersionIDsWithUnsuccessfulExecutions := []string{}
	for _, packageVersionID := range latestPackageVersionIDs {
		query := `select status from execution where package_version_id = $1 order by created_at desc limit 1`
		var status string
		err := conn.QueryRow(ctx, query, packageVersionID).Scan(&status)
		if err != nil {
			return nil, fmt.Errorf("scan execution id: %w", err)
		}

		if status == "failed" {
			packageVersionIDsWithUnsuccessfulExecutions = append(packageVersionIDsWithUnsuccessfulExecutions, packageVersionID)
		}
	}

	packageVersionsNeedingBuild := []*types.PackageVersion{}
	for _, packageVersionID := range packageVersionIDsWithUnsuccessfulExecutions {
		packageVersion, err := getPackageVersion(ctx, packageVersionID)
		if err != nil {
			return nil, fmt.Errorf("get package version: %w", err)
		}
		packageVersionsNeedingBuild = append(packageVersionsNeedingBuild, packageVersion)
	}

	return packageVersionsNeedingBuild, nil
}

func ListPackageVersionsNeedingBuild(ctx context.Context) ([]*types.PackageVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	packageIDs := []string{}
	rows, err := conn.Query(ctx, `SELECT id FROM package WHERE parent_id IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("list package versions needing build: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var packageID string
		err := rows.Scan(&packageID)
		if err != nil {
			return nil, fmt.Errorf("scan package id: %w", err)
		}

		packageIDs = append(packageIDs, packageID)
	}
	rows.Close()

	latestPackageVersionIDs := []string{}
	for _, packageID := range packageIDs {
		query := `select id from package_version where package_id = $1 order by created_at desc limit 1`
		var packageVersionID string
		err := conn.QueryRow(ctx, query, packageID).Scan(&packageVersionID)
		if err != nil {
			return nil, fmt.Errorf("scan package version id: %w", err)
		}
		latestPackageVersionIDs = append(latestPackageVersionIDs, packageVersionID)
	}

	packageVersionIDsWithoutExecutions := []string{}
	for _, packageVersionID := range latestPackageVersionIDs {
		query := `select count(1) from execution where package_version_id = $1`
		var count int
		err := conn.QueryRow(ctx, query, packageVersionID).Scan(&count)
		if err != nil {
			return nil, fmt.Errorf("scan execution id: %w", err)
		}

		if count == 0 {
			packageVersionIDsWithoutExecutions = append(packageVersionIDsWithoutExecutions, packageVersionID)
		}
	}

	packageVersionsNeedingBuild := []*types.PackageVersion{}
	for _, packageVersionID := range packageVersionIDsWithoutExecutions {
		packageVersion, err := getPackageVersion(ctx, packageVersionID)
		if err != nil {
			return nil, fmt.Errorf("get package version: %w", err)
		}
		packageVersionsNeedingBuild = append(packageVersionsNeedingBuild, packageVersion)
	}

	return packageVersionsNeedingBuild, nil
}

func SetOCILocation(ctx context.Context, pkgID string, version string, arch string, ociRegistryImage string) error {
	logger.Debug("setting oci location",
		zap.String("package_id", pkgID),
		zap.String("version", version),
		zap.String("arch", arch),
		zap.String("oci_registry_image", ociRegistryImage),
	)

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	_, err := conn.Exec(ctx, `
		UPDATE package_version SET oci_registry_location = $1 WHERE package_id = $2 AND version = $3
	`, ociRegistryImage, pkgID, version)
	if err != nil {
		return fmt.Errorf("set oci location: %w", err)
	}

	return nil
}

func ListPackageVersionAdditionalFiles(ctx context.Context, pkgVersionID string) ([]types.AdditionalFile, error) {
	logger.Debug("listing package version additional files",
		zap.String("package_version_id", pkgVersionID),
	)

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT id, path, content FROM package_version_additional_file WHERE package_version_id = $1`
	rows, err := conn.Query(ctx, query, pkgVersionID)
	if err != nil {
		return nil, fmt.Errorf("get package version additional files: %w", err)
	}
	defer rows.Close()

	additionalFiles := []types.AdditionalFile{}
	for rows.Next() {
		var additionalFile types.AdditionalFile
		err := rows.Scan(&additionalFile.ID, &additionalFile.Path, &additionalFile.Content)
		if err != nil {
			return nil, fmt.Errorf("scan package version additional file: %w", err)
		}
		additionalFiles = append(additionalFiles, additionalFile)
	}

	return additionalFiles, nil
}

func FindPackageVersion(ctx context.Context, name string, version string, release int) (*types.PackageVersion, error) {
	logger.Debug("finding package version",
		zap.String("name", name),
		zap.String("version", version),
		zap.Int("release", release),
	)

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT id FROM package_version WHERE package_id = (SELECT id FROM package WHERE name = $1) AND version = $2 AND apk_release = $3`
	var id string
	err := conn.QueryRow(ctx, query, name, version, release).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("find package version: %w", err)
	}

	pv, err := getPackageVersion(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get package version: %w", err)
	}

	return pv, nil
}

func CompileMelangeYAML(ctx context.Context, melangeYAML []byte) (*config.Configuration, error) {
	// we need to create a tmp directory that has our embedded build filesystem
	// b/c some of the pipelines reference external files
	tmpDir, err := os.MkdirTemp("", "melange-compile")
	if err != nil {
		return nil, fmt.Errorf("create temp directory: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	err = builder.CopyEmbeddedFS(tmpDir)
	if err != nil {
		return nil, fmt.Errorf("copy embedded filesystem: %w", err)
	}

	// create a melange.yaml file in the tmp directory
	melangeYAMLFile, err := os.Create(filepath.Join(tmpDir, "melange.yaml"))
	if err != nil {
		return nil, fmt.Errorf("create melange yaml file: %w", err)
	}
	defer melangeYAMLFile.Close()

	_, err = melangeYAMLFile.Write(melangeYAML)
	if err != nil {
		return nil, fmt.Errorf("write melange yaml: %w", err)
	}

	pipelineDir, err := pipeline.GetPipelineDir(ctx, pipeline.TypePackage)
	if err != nil {
		return nil, fmt.Errorf("get pipeline directory: %w", err)
	}
	if _, err := os.Stat(pipelineDir); err != nil {
		return nil, fmt.Errorf("pipeline directory does not exist or cannot be accessed: %w", err)
	}

	// Build options for melange compilation
	// WithPipelineDir extends (not replaces) the built-in pipeline directory
	// Custom pipelines are searched first, then built-ins
	buildOpts := []build.Option{
		build.WithSourceDir(tmpDir),
		build.WithDebug(true),
		build.WithPipelineDir(pipelineDir),
		build.WithConfigFileRepositoryURL("https://unknown/unknown/unknown"),
		build.WithConfigFileRepositoryCommit("unknown"),
		build.WithConfig(melangeYAMLFile.Name()),
	}

	b, err := build.New(ctx, buildOpts...)
	if err != nil {
		return nil, fmt.Errorf("create build: %w", err)
	}
	defer b.Close(ctx)

	if err := b.Compile(ctx); err != nil {
		return nil, fmt.Errorf("compile: %w", err)
	}

	return b.Configuration, nil
}

var (
	ErrPackageNotFound        = errors.New("package not found")
	ErrPackageVersionNotFound = errors.New("package version not found")
)

func GetInternalPackageByName(ctx context.Context, name string) (*types.Package, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Check if package exists and whether it's still being created
	// If there's a matching record in package_create, the package hasn't been fully created yet
	query := `
		SELECT p.id, pc.id as create_id
		FROM package p
		LEFT JOIN package_create pc ON pc.package_id = p.id
		WHERE p.name = $1
	`
	var id string
	var createID sql.NullString
	err := conn.QueryRow(ctx, query, name).Scan(&id, &createID)
	if err != nil {
		return nil, ErrPackageNotFound
	}

	// If package is still in package_create table, it's not fully created yet
	if createID.Valid {
		return nil, ErrPackageNotFound
	}

	pkg, err := GetPackage(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get package: %w", err)
	}
	return pkg, nil
}

var ErrNoBuiltPackageVersionsFound = errors.New("no built package versions found")

func GetLatestBuiltPackageVersion(ctx context.Context, packageID string) (*types.PackageVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT package_version_id from execution where package_id = $1 and status = 'success'`
	rows, err := conn.Query(ctx, query, packageID)
	if err != nil {
		return nil, fmt.Errorf("get latest built package version: %w", err)
	}
	defer rows.Close()

	packageVersionIDs := []string{}
	for rows.Next() {
		var id string
		err := rows.Scan(&id)
		if err != nil {
			return nil, fmt.Errorf("scan package version id: %w", err)
		}
		packageVersionIDs = append(packageVersionIDs, id)
	}

	if len(packageVersionIDs) == 0 {
		return nil, ErrNoBuiltPackageVersionsFound
	}

	var latestPackageVersion *types.PackageVersion
	var latestV *semver.Version
	for _, packageVersionID := range packageVersionIDs {
		packageVersion, err := getPackageVersion(ctx, packageVersionID)
		if err != nil {
			return nil, fmt.Errorf("get package version: %w", err)
		}

		v, err := semver.NewVersion(packageVersion.Version)
		if err != nil {
			logger.Debug("failed to parse version as semver",
				zap.String("package_version_id", packageVersion.ID),
				zap.String("version", packageVersion.Version),
				zap.Error(err))
			continue
		}

		if latestPackageVersion == nil {
			latestPackageVersion = packageVersion
			latestV = v
			continue
		}

		if v.GreaterThan(latestV) {
			latestPackageVersion = packageVersion
			latestV = v
			continue
		}

		if v.Equal(latestV) {
			// if the semver is the same, we need to compare the release
			if packageVersion.APKRelease > latestPackageVersion.APKRelease {
				latestPackageVersion = packageVersion
				latestV = v
			}
			continue
		}
	}

	return latestPackageVersion, nil
}

// GetLatestPackageVersion returns the package version with the highest version number,
// or for the same version, the highest release number. This is more reliable than
// using created_at timestamps which can be affected by timezone differences between
// different services writing to the database.
func GetLatestPackageVersion(ctx context.Context, packageID string) (*types.PackageVersion, error) {
	var err error

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Get highest release for each version and find latest version using semver
	query := `
		WITH max_releases AS (
			SELECT version, MAX(apk_release) as max_release
			FROM package_version
			WHERE package_id = $1
			GROUP BY version
		)
		SELECT pv.id, pv.version
		FROM package_version pv
		JOIN max_releases mr ON pv.version = mr.version AND pv.apk_release = mr.max_release
		WHERE pv.package_id = $1
	`

	rows, err := conn.Query(ctx, query, packageID)
	if err != nil {
		return nil, fmt.Errorf("get latest package version: %w", err)
	}
	defer rows.Close()

	var (
		latestID      string
		latestVer     *semver.Version
		fallbackID    string
		allVersionIDs []string
	)

	for rows.Next() {
		var id, version string
		if err := rows.Scan(&id, &version); err != nil {
			return nil, fmt.Errorf("scan version row: %w", err)
		}

		// Keep track of all versions as fallback
		allVersionIDs = append(allVersionIDs, id)
		if fallbackID == "" {
			fallbackID = id // First version as fallback
		}

		v, err := semver.NewVersion(version)
		if err != nil {
			logger.Warn("failed to parse version as semver, will use as fallback",
				zap.String("package_version_id", id),
				zap.String("version", version),
				zap.Error(err))
			continue
		}

		if latestVer == nil {
			latestID = id
			latestVer = v
			continue
		}

		if v.GreaterThan(latestVer) {
			latestID = id
			latestVer = v
		}
	}

	// If we found a valid semver version, use it
	if latestID != "" {
		return getPackageVersion(ctx, latestID)
	}

	// Fall back to most recent version by created_at if no valid semver versions exist
	if fallbackID != "" {
		logger.Warn("no valid semver versions found, falling back to most recent version",
			zap.String("package_id", packageID),
			zap.String("fallback_version_id", fallbackID))

		// Query for the most recent version by created_at as final fallback
		fallbackQuery := `
			SELECT id
			FROM package_version
			WHERE package_id = $1
			ORDER BY created_at DESC, apk_release DESC
			LIMIT 1
		`
		var mostRecentID string
		if err := conn.QueryRow(ctx, fallbackQuery, packageID).Scan(&mostRecentID); err == nil {
			return getPackageVersion(ctx, mostRecentID)
		}
	}

	return nil, fmt.Errorf("no versions found for package %s", packageID)
}

func changeVersionInMelangeYAML(ctx context.Context, melangeYAML string, version string, commit string) (string, error) {
	logger.Debug("changing version in melange yaml",
		zap.String("version", version),
		zap.String("commit", commit),
	)

	lines := strings.Split(melangeYAML, "\n")

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		leadingWhitespace := line[:len(line)-len(trimmed)]
		if strings.HasPrefix(trimmed, "version:") {
			lines[i] = fmt.Sprintf("%sversion: %q", leadingWhitespace, version)
		}

		if strings.HasPrefix(trimmed, "expected-commit:") {
			lines[i] = fmt.Sprintf("%sexpected-commit: %s", leadingWhitespace, commit)
		}

		if strings.HasPrefix(trimmed, "epoch:") {
			lines[i] = fmt.Sprintf("%sepoch: %d", leadingWhitespace, 0)
		}
	}

	return strings.Join(lines, "\n"), nil
}

func bumpReleaseInMelangeYAML(ctx context.Context, melangeYAML string, release int) (string, error) {
	// super hacky, we just find the line that has " [whitespace]epoch:" and replace it
	// with the same whitespace type and length

	lines := strings.Split(melangeYAML, "\n")
	epochFound := false

	for i, line := range lines {
		// Check if this line contains epoch:
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "epoch:") {
			// Extract the leading whitespace
			leadingWhitespace := line[:len(line)-len(trimmed)]

			// Replace the line with the same whitespace + new epoch value
			lines[i] = fmt.Sprintf("%sepoch: %d", leadingWhitespace, release)
			epochFound = true
			break
		}
	}

	if !epochFound {
		return "", fmt.Errorf("epoch field not found in melange YAML")
	}

	return strings.Join(lines, "\n"), nil
}

func CreateNewReleaseForLatestPackageVersion(ctx context.Context, packageID string, version string, commit string) (*types.PackageVersion, error) {
	logger.Debug("creating new release for latest package version",
		zap.String("package_id", packageID),
		zap.String("version", version),
		zap.String("commit", commit),
	)

	// Get all existing versions to help debug conflicts
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	latestVersion, err := GetLatestPackageVersion(ctx, packageID)
	if err != nil {
		return nil, fmt.Errorf("get latest package version: %w", err)
	}

	release := latestVersion.APKRelease + 1
	if version != "" {
		release = 0
	}

	var updatedMelangeYAML string

	if version == "" {
		updatedMelangeYAML, err = bumpReleaseInMelangeYAML(ctx, latestVersion.MelangeYaml, release)
		if err != nil {
			return nil, fmt.Errorf("bump release in melange yaml: %w", err)
		}
	} else {
		updatedMelangeYAML, err = changeVersionInMelangeYAML(ctx, latestVersion.MelangeYaml, version, commit)
		if err != nil {
			return nil, fmt.Errorf("change version in melange yaml: %w", err)
		}
	}

	now := time.Now()

	previousVersionAdditionalFiles, err := ListPackageVersionAdditionalFiles(ctx, latestVersion.ID)
	if err != nil {
		return nil, fmt.Errorf("list package version additional files: %w", err)
	}

	subpackages, err := ListSubpackages(ctx, packageID)
	if err != nil {
		return nil, fmt.Errorf("list subpackages: %w", err)
	}

	newVersionID, err := securerandom.Hex(32)
	if err != nil {
		return nil, fmt.Errorf("generate random id for new version: %w", err)
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	newVersion := latestVersion.Version
	if version != "" {
		newVersion = version
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO package_version (id, package_id, version, melange_yaml, created_at, updated_at, apk_release, license, use_root, bootstrap_enabled, bootstrap_apk_repository, bootstrap_keyring_append)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, newVersionID, packageID, newVersion, updatedMelangeYAML, now, now, release, latestVersion.License, latestVersion.UseRoot, latestVersion.BootstrapEnabled, latestVersion.BootstrapApkRepository, latestVersion.BootstrapKeyringAppend)
	if err != nil {
		return nil, fmt.Errorf("insert new package version: %w", err)
	}

	// copy all additional files from the latest version to the new version
	for _, additionalFile := range previousVersionAdditionalFiles {
		newID, err := securerandom.Hex(32)
		if err != nil {
			return nil, fmt.Errorf("generate random id for additional file: %w", err)
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO package_version_additional_file (id, package_version_id, path, content, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, newID, newVersionID, additionalFile.Path, additionalFile.Content, now, now)
		if err != nil {
			return nil, fmt.Errorf("insert additional file: %w", err)
		}
	}

	for _, subpackage := range subpackages {
		// the version and release are the same as the main package
		// the melange is same as the main package
		// the license is the same as the main package
		newID, err := securerandom.Hex(32)
		if err != nil {
			return nil, fmt.Errorf("generate random id for subpackage version: %w", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO package_version (id, package_id, version, melange_yaml, created_at, updated_at, apk_release, license, use_root, bootstrap_enabled, bootstrap_apk_repository, bootstrap_keyring_append)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		`, newID, subpackage.ID, latestVersion.Version, nil, now, now, release, latestVersion.License, latestVersion.UseRoot, latestVersion.BootstrapEnabled, latestVersion.BootstrapApkRepository, latestVersion.BootstrapKeyringAppend)
		if err != nil {
			return nil, fmt.Errorf("insert subpackage version %s %s-r%d: %w", subpackage.Name, latestVersion.Version, release, err)
		}
	}

	// Extract and write provides for the new version
	newPackageVersion := &types.PackageVersion{
		ID:          newVersionID,
		PackageID:   packageID,
		Version:     newVersion,
		MelangeYaml: string(updatedMelangeYAML),
		APKRelease:  release,
	}
	if err := WritePackageVersionProvides(ctx, tx, newPackageVersion); err != nil {
		return nil, fmt.Errorf("write package version provides: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	latestVersion, err = GetLatestPackageVersion(ctx, packageID)
	if err != nil {
		return nil, fmt.Errorf("get latest package version: %w", err)
	}

	// Trigger GitHub sync after package version creation
	if err := persistence.EnqueueWork(ctx, "github_sync", []byte("{}")); err != nil {
		logger.Warn("failed to enqueue github_sync after package version creation", zap.Error(err))
	}

	return latestVersion, nil
}

func CreateAdditionalFile(ctx context.Context, tx pgx.Tx, packageVersionID string, path string, content []byte) error {
	newID, err := securerandom.Hex(32)
	if err != nil {
		return fmt.Errorf("generate random id for additional file: %w", err)
	}

	query := `INSERT INTO package_version_additional_file (id, package_version_id, path, content, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`
	_, err = tx.Exec(ctx, query, newID, packageVersionID, path, content, time.Now(), time.Now())
	if err != nil {
		return fmt.Errorf("create additional file: %w", err)
	}

	return nil
}

func ListSubpackages(ctx context.Context, packageID string) ([]types.Package, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT id FROM package WHERE parent_id = $1`
	var subpackages []types.Package
	rows, err := conn.Query(ctx, query, packageID)
	if err != nil {
		return nil, fmt.Errorf("list subpackages: %w", err)
	}
	defer rows.Close()

	ids := []string{}
	for rows.Next() {
		var id string
		err := rows.Scan(&id)
		if err != nil {
			return nil, fmt.Errorf("scan subpackage: %w", err)
		}
		ids = append(ids, id)
	}

	rows.Close()

	for _, id := range ids {
		subpackage, err := GetPackage(ctx, id)
		if err != nil {
			return nil, fmt.Errorf("get subpackage: %w", err)
		}
		subpackages = append(subpackages, *subpackage)
	}

	return subpackages, nil
}

func GetPackageVersion(ctx context.Context, packageVersionID string) (*types.PackageVersion, error) {
	return getPackageVersion(ctx, packageVersionID)
}

func getPackageVersion(ctx context.Context, packageVersionID string) (*types.PackageVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT id, package_id, version, melange_yaml, created_at, apk_release, use_root, bootstrap_enabled, bootstrap_apk_repository, bootstrap_keyring_append, custom_disk_size FROM package_version WHERE id = $1`
	var p types.PackageVersion
	var melangeYaml sql.NullString
	var bootstrapApkRepository sql.NullString
	var bootstrapKeyringAppend sql.NullString
	var customDiskSize sql.NullInt32
	err := conn.QueryRow(ctx, query, packageVersionID).Scan(&p.ID, &p.PackageID, &p.Version, &melangeYaml, &p.CreatedAt, &p.APKRelease, &p.UseRoot, &p.BootstrapEnabled, &bootstrapApkRepository, &bootstrapKeyringAppend, &customDiskSize)
	if err != nil {
		return nil, fmt.Errorf("get package version: %w", err)
	}

	if melangeYaml.Valid {
		p.MelangeYaml = melangeYaml.String
	}

	if bootstrapApkRepository.Valid {
		p.BootstrapApkRepository = &bootstrapApkRepository.String
	}

	if bootstrapKeyringAppend.Valid {
		p.BootstrapKeyringAppend = &bootstrapKeyringAppend.String
	}

	if customDiskSize.Valid {
		diskSize := int(customDiskSize.Int32)
		p.CustomDiskSize = &diskSize
	}

	return &p, nil
}

func SetCustomDiskSize(ctx context.Context, packageVersionID string, diskSize *int) error {
	// Validate and normalize disk size
	// If diskSize is nil, 0, or negative, we store NULL (use default)
	var normalizedSize *int
	if diskSize != nil && *diskSize > 0 {
		if *diskSize > 250 {
			return fmt.Errorf("custom disk size must not exceed 250 GB")
		}
		normalizedSize = diskSize
	}
	// Otherwise normalizedSize stays nil, storing NULL in the database

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	_, err := conn.Exec(ctx, `UPDATE package_version SET custom_disk_size = $1 WHERE id = $2`, normalizedSize, packageVersionID)
	if err != nil {
		return fmt.Errorf("set custom disk size: %w", err)
	}

	return nil
}

func getPackageVersionWithTx(ctx context.Context, tx pgx.Tx, packageVersionID string) (*types.PackageVersion, error) {
	query := `SELECT id, package_id, version, melange_yaml, created_at, apk_release, use_root, bootstrap_enabled, bootstrap_apk_repository, bootstrap_keyring_append, custom_disk_size FROM package_version WHERE id = $1`
	var p types.PackageVersion
	var melangeYaml sql.NullString
	var bootstrapApkRepository sql.NullString
	var bootstrapKeyringAppend sql.NullString
	var customDiskSize sql.NullInt32
	err := tx.QueryRow(ctx, query, packageVersionID).Scan(&p.ID, &p.PackageID, &p.Version, &melangeYaml, &p.CreatedAt, &p.APKRelease, &p.UseRoot, &p.BootstrapEnabled, &bootstrapApkRepository, &bootstrapKeyringAppend, &customDiskSize)
	if err != nil {
		return nil, fmt.Errorf("get package version: %w", err)
	}

	if melangeYaml.Valid {
		p.MelangeYaml = melangeYaml.String
	}

	if bootstrapApkRepository.Valid {
		p.BootstrapApkRepository = &bootstrapApkRepository.String
	}

	if bootstrapKeyringAppend.Valid {
		p.BootstrapKeyringAppend = &bootstrapKeyringAppend.String
	}

	if customDiskSize.Valid {
		diskSize := int(customDiskSize.Int32)
		p.CustomDiskSize = &diskSize
	}

	return &p, nil
}

func GetPackageWithTx(ctx context.Context, tx pgx.Tx, id string) (*types.Package, error) {
	logger.Debug("getting package", zap.String("id", id))

	query := `SELECT p.id, p.name, p.created_at, p.updated_at, p.parent_id
		FROM package p
		WHERE p.id = $1`
	var p types.Package
	var parentID sql.NullString
	err := tx.QueryRow(ctx, query, id).Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &parentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			logger.Warn("package not found", zap.String("id", id))
			return nil, ErrPackageNotFound
		}
		return nil, fmt.Errorf("get package: %w", err)
	}

	if parentID.Valid {
		p.ParentID = &parentID.String
	}

	subpackages, err := listSubpackagesWithTx(ctx, tx, id)
	if err != nil {
		return nil, fmt.Errorf("get subpackages: %w", err)
	}
	p.Subpackages = subpackages

	return &p, nil
}

func GetPackage(ctx context.Context, id string) (*types.Package, error) {
	logger.Debug("getting package", zap.String("id", id))
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT p.id, p.name, p.created_at, p.updated_at, p.parent_id, p.is_delete_protection_enabled
		FROM package p
		WHERE p.id = $1`
	var p types.Package
	var parentID sql.NullString
	err := conn.QueryRow(ctx, query, id).Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &parentID, &p.IsDeleteProtectionEnabled)
	if err != nil {
		if err == pgx.ErrNoRows {
			logger.Warn("package not found", zap.String("id", id))
			return nil, ErrPackageNotFound
		}
		return nil, fmt.Errorf("get package: %w", err)
	}

	if parentID.Valid {
		p.ParentID = &parentID.String
	}

	subpackages, err := listSubpackages(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get subpackages: %w", err)
	}
	p.Subpackages = subpackages

	return &p, nil
}

func listSubpackagesWithTx(ctx context.Context, tx pgx.Tx, id string) ([]types.Package, error) {
	query := `SELECT p.id, p.name, p.created_at, p.updated_at, p.is_delete_protection_enabled
		FROM package p
		WHERE p.parent_id = $1`
	var subpackages []types.Package
	rows, err := tx.Query(ctx, query, id)
	if err != nil {
		return nil, fmt.Errorf("get subpackages: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var p types.Package
		err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &p.IsDeleteProtectionEnabled)
		if err != nil {
			return nil, fmt.Errorf("scan subpackage: %w", err)
		}
		subpackages = append(subpackages, p)
	}

	return subpackages, nil
}

func listSubpackages(ctx context.Context, id string) ([]types.Package, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT p.id, p.name, p.created_at, p.updated_at, p.is_delete_protection_enabled
		FROM package p
		WHERE p.parent_id = $1`
	var subpackages []types.Package
	rows, err := conn.Query(ctx, query, id)
	if err != nil {
		return nil, fmt.Errorf("get subpackages: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var p types.Package
		err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &p.IsDeleteProtectionEnabled)
		if err != nil {
			return nil, fmt.Errorf("scan subpackage: %w", err)
		}
		subpackages = append(subpackages, p)
	}

	return subpackages, nil
}

func GetPackageIDByName(ctx context.Context, name string) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT id FROM package WHERE name = $1`
	var id string
	err := conn.QueryRow(ctx, query, name).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", ErrPackageNotFound
		}
		return "", fmt.Errorf("get package id by name: %w", err)
	}
	return id, nil
}

func getPackageIDByName(ctx context.Context, q pgx.Tx, name string) (string, error) {
	query := `SELECT id FROM package WHERE name = $1`
	var id string
	err := q.QueryRow(ctx, query, name).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", ErrPackageNotFound
		}
		return "", fmt.Errorf("get package id by name: %w", err)
	}
	return id, nil
}

func getPackageVersionID(ctx context.Context, q pgx.Tx, packageID string, version string) (string, error) {
	query := `SELECT id FROM package_version WHERE package_id = $1 AND version = $2`
	var id string
	err := q.QueryRow(ctx, query, packageID, version).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", ErrPackageVersionNotFound
		}
		return "", fmt.Errorf("get package version id: %w", err)
	}
	return id, nil
}

func ensurePackageRecord(ctx context.Context, tx pgx.Tx, packageName string, parentID *string, now time.Time) (string, error) {
	// First, try to get the existing package
	pkgID, err := getPackageIDByName(ctx, tx, packageName)
	if err == nil {
		// If found, update the package if it should become a subpackage
		if parentID != nil {
			_, err = tx.Exec(ctx, `
				UPDATE package SET parent_id = $1, updated_at = $2
				WHERE id = $3 AND (parent_id IS NULL OR parent_id != $1)
			`, *parentID, now, pkgID)
			if err != nil {
				return "", fmt.Errorf("update package %s to be subpackage: %w", packageName, err)
			}
		}

		return pkgID, nil
	}

	if err != ErrPackageNotFound {
		return "", fmt.Errorf("get package id by name for %s: %w", packageName, err)
	}

	// Package doesn't exist, try to insert it
	newID, err := securerandom.Hex(32)
	if err != nil {
		return "", fmt.Errorf("generate random id for package %s: %w", packageName, err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO package (id, name, created_at, updated_at, parent_id)
		VALUES ($1, $2, $3, $4, $5)
	`, newID, packageName, now, now, parentID)
	if err != nil {
		// Check if this is a unique constraint violation (another transaction inserted the same package)
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
			retryPkgID, retryErr := getPackageIDByName(ctx, tx, packageName)
			if retryErr != nil {
				return "", fmt.Errorf("retry get package id by name for %s: %w", packageName, retryErr)
			}

			return retryPkgID, nil
		}
		return "", fmt.Errorf("insert package %s: %w", packageName, err)
	}

	return newID, nil
}

// PackageAndVersionID contains package name, ID, and version ID information
type PackageAndVersionID struct {
	Name      string // Original or parent package name
	PackageID string // Package ID (or parent package ID if subpackage)
	VersionID string // Package version ID (may be empty if version not found)
}

// GetPackageAndVersionIDs checks if a package is a subpackage and redirects to its parent
// returns the package name, package ID, and package version ID
func GetPackageAndVersionIDs(ctx context.Context, tx pgx.Tx, packageName string, version string, release string) (*PackageAndVersionID, error) {
	// parse the package name to remove the version if present
	packageName = ParsePackageName(packageName)

	pkgID, err := getPackageIDByName(ctx, tx, packageName)
	if err != nil {
		if errors.Is(err, ErrPackageNotFound) {
			// Package not found - return empty info to allow the build to continue
			return &PackageAndVersionID{Name: packageName}, nil
		}
		return nil, fmt.Errorf("get package ID by name: %w", err)
	}

	pkg, err := GetPackageWithTx(ctx, tx, pkgID)
	if err != nil {
		return nil, fmt.Errorf("get package: %w", err)
	}

	// If this is a subpackage, redirect to parent
	if pkg.ParentID != nil {
		parentPkg, err := GetPackageWithTx(ctx, tx, *pkg.ParentID)
		if err != nil {
			if errors.Is(err, ErrPackageNotFound) {
				// Parent package not found - this is unexpected but happens in prod
				// Return the subpackage info since we can't find its parent
				logger.Warn("parent package not found",
					zap.String("package_id", pkgID),
					zap.String("package_name", packageName),
					zap.String("parent_id", *pkg.ParentID))
				return &PackageAndVersionID{Name: packageName, PackageID: pkg.ID}, nil
			}
			return nil, fmt.Errorf("get parent package: %w", err)
		}

		logger.Debug("redirecting subpackage dependency to parent",
			zap.String("subpackage_id", pkgID),
			zap.String("subpackage_name", packageName),
			zap.String("parent_id", *pkg.ParentID),
			zap.String("parent_name", parentPkg.Name))

		pkgID = parentPkg.ID
		packageName = parentPkg.Name
	}

	// Get package version ID
	// Try to parse release number, but don't fail if we can't
	var versionID string
	release = strings.TrimPrefix(release, "r")
	releaseNum, err := strconv.Atoi(release)
	if err != nil {
		// Log the error but continue without version ID
		logger.Info("failed to parse release number",
			zap.String("package", packageName),
			zap.String("version", version),
			zap.String("release", release),
			zap.Error(err))
		// Return package info without version ID
		return &PackageAndVersionID{
			Name:      packageName,
			PackageID: pkgID,
		}, nil
	}

	err = tx.QueryRow(ctx, `
		SELECT id FROM package_version 
		WHERE package_id = $1 AND version = $2 AND apk_release = $3
	`, pkgID, version, releaseNum).Scan(&versionID)
	if err != nil {
		if err == pgx.ErrNoRows {
			// Version not found, but we still return the package info
			return &PackageAndVersionID{Name: packageName, PackageID: pkgID}, nil
		}
		return nil, fmt.Errorf("get package version ID: %w", err)
	}

	return &PackageAndVersionID{
		Name:      packageName,
		PackageID: pkgID,
		VersionID: versionID,
	}, nil
}

// ParsePackageName extracts the package name from a dependency string.
// For example: "glibc=2.41-r6" -> "glibc", "bash" -> "bash"
// Uses apko's ResolvePackageNameVersionPin to properly parse package names and version pins.
func ParsePackageName(depString string) string {
	parsed := apkopackage.ResolvePackageNameVersionPin(depString)
	return parsed.Name
}
