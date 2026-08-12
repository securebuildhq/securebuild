package sbpackage

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"chainguard.dev/melange/pkg/config"
	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

var (
	ErrPackageAlreadyExists       = errors.New("package already exists")
	ErrPackageMissingDependencies = errors.New("package missing dependencies")
	ErrPackageAtLatestVersion     = errors.New("package already at latest version")
)

// ImportPackage imports a package with a pre-generated package ID
func ImportPackage(ctx context.Context, melangeYAML []byte, encodedAdditionalFilesData *string, useRoot bool, customDiskSize *int, packageID string) (*types.Package, string, error) {
	compiled, err := CompileMelangeYAML(ctx, melangeYAML)
	if err != nil {
		return nil, "", fmt.Errorf("compile melange yaml: %w", err)
	}

	now := time.Now()

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// if the package already exists and it's an internal package, we don't need to do anything, just return it
	existingPackage, err := GetInternalPackageByName(ctx, compiled.Package.Name)
	if err != nil && err != ErrPackageNotFound {
		return nil, "", fmt.Errorf("get package by name: %w", err)
	}

	if existingPackage != nil {
		return existingPackage, "", ErrPackageAlreadyExists
	}

	// Top-level package
	id, err := handleMainPackage(ctx, tx, compiled, now, packageID)
	if err != nil {
		return nil, "", fmt.Errorf("handle main package: %w", err)
	}

	initialVersionID, err := createInitialPackageVersion(ctx, tx, id, compiled, melangeYAML, now, useRoot, customDiskSize)
	if err != nil {
		return nil, "", fmt.Errorf("create initial package version: %w", err)
	}

	if encodedAdditionalFilesData != nil {
		additionalFilesData, err := base64.StdEncoding.DecodeString(*encodedAdditionalFilesData)
		if err != nil {
			return nil, "", fmt.Errorf("decode additional files data: %w", err)
		}

		if err := ImportAdditionalFiles(ctx, tx, initialVersionID, additionalFilesData); err != nil {
			return nil, "", fmt.Errorf("import additional files: %w", err)
		}
	}

	// Subpackages
	if err := handleSubpackages(ctx, tx, id, initialVersionID, compiled, melangeYAML, now, useRoot, customDiskSize); err != nil {
		return nil, "", fmt.Errorf("handle subpackages: %w", err)
	}

	// Update any existing external dependencies to point to this newly created package
	if err := UpdateExternalDependenciesToInternal(ctx, tx, compiled.Package.Name, id, initialVersionID, compiled.Package.Name); err != nil {
		return nil, "", fmt.Errorf("update external dependencies to internal: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, "", fmt.Errorf("commit transaction: %w", err)
	}

	// Trigger GitHub sync after package import
	if err := persistence.EnqueueWork(ctx, "github_sync", []byte("{}")); err != nil {
		logger.Warn("failed to enqueue github_sync after package import", zap.Error(err))
	}

	p, err := GetPackage(ctx, id)
	if err != nil {
		return nil, "", fmt.Errorf("get package: %w", err)
	}

	return p, initialVersionID, nil
}

func ImportAdditionalFiles(ctx context.Context, tx pgx.Tx, packageVersionID string, additionalFilesData []byte) error {
	// additionalFilesData is a tar.gz file, uncompress it and then read the files
	gzReader, err := gzip.NewReader(bytes.NewReader(additionalFilesData))
	if err != nil {
		return fmt.Errorf("create gzip reader: %w", err)
	}
	defer gzReader.Close()

	tarReader := tar.NewReader(gzReader)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}

		if err != nil {
			return fmt.Errorf("read tar header: %w", err)
		}

		// ignore directories
		if header.Typeflag == tar.TypeDir {
			continue
		}

		// Skip Mac OS X resource fork files
		if strings.HasPrefix(filepath.Base(header.Name), "._") {
			logger.Debug("skipping Mac OS X metadata file", zap.String("path", header.Name))
			continue
		}

		content, err := io.ReadAll(tarReader)
		if err != nil {
			return fmt.Errorf("read tar content: %w", err)
		}

		// Clean the path - remove leading "./" or "."
		cleanPath := header.Name
		cleanPath = strings.TrimPrefix(cleanPath, "./")
		cleanPath = strings.TrimPrefix(cleanPath, ".")
		cleanPath = strings.TrimPrefix(cleanPath, "/")

		if err := CreateAdditionalFile(ctx, tx, packageVersionID, cleanPath, content); err != nil {
			return fmt.Errorf("create additional file: %w", err)
		}
	}

	return nil
}

func handleMainPackage(ctx context.Context, tx pgx.Tx, compiled *config.Configuration, now time.Time, packageID string) (string, error) {
	initialCheckForUpdatesAt := now.Add(1 * time.Hour)

	// Use the provided packageID since it's now always required
	id := packageID
	// The package record should already exist, created by the TypeScript side
	// Verify that the existing record matches our expected ID
	existingID, err := getPackageIDByName(ctx, tx, compiled.Package.Name)
	if err != nil {
		return "", fmt.Errorf("get package ID by name: %w", err)
	}
	if existingID != "" && existingID != id {
		// ID mismatch - this is a data consistency error
		return "", fmt.Errorf("package ID mismatch: expected %s, found %s for package %s", id, existingID, compiled.Package.Name)
	}

	_, err = tx.Exec(ctx, `
		UPDATE package SET check_for_updates_at = $1, updated_at = $2
		WHERE id = $3 AND (check_for_updates_at IS NULL OR check_for_updates_at != $1)
	`, initialCheckForUpdatesAt, now, id)
	if err != nil {
		return "", fmt.Errorf("update package check_for_updates_at: %w", err)
	}

	return id, nil
}

func handleSubpackages(ctx context.Context, tx pgx.Tx, mainPackageID string, mainVersionID string, compiled *config.Configuration, melangeYAML []byte, now time.Time, useRoot bool, customDiskSize *int) error {
	subpackages := compiled.Subpackages

	release := 0
	if compiled.Package.Epoch != 0 {
		release = int(compiled.Package.Epoch)
	}

	var license *string
	for _, copyright := range compiled.Package.Copyright {
		license = &copyright.License
		break
	}

	for _, sp := range subpackages {
		// Ensure subpackage record exists
		spPkgID, err := ensurePackageRecord(ctx, tx, sp.Name, &mainPackageID, now)
		if err != nil {
			return fmt.Errorf("ensure subpackage record for %s: %w", sp.Name, err)
		}

		// Ensure subpackage version record exists
		// Subpackages in the original code didn't store their own melange/apko YAML in their version record.
		_, err = ensurePackageVersionRecord(ctx, tx, spPkgID, compiled.Package.Version, nil, now, license, release, useRoot, customDiskSize, compiled)
		if err != nil {
			return fmt.Errorf("ensure subpackage version record for %s: %w", sp.Name, err)
		}

		// Update any existing external dependencies that reference this subpackage to point to the parent package
		if err := UpdateExternalDependenciesToInternal(ctx, tx, sp.Name, mainPackageID, mainVersionID, compiled.Package.Name); err != nil {
			return fmt.Errorf("update external dependencies to internal for subpackage %s: %w", sp.Name, err)
		}
	}
	return nil
}

func createInitialPackageVersion(ctx context.Context, tx pgx.Tx, packageID string, compiled *config.Configuration, melangeYAML []byte, now time.Time, useRoot bool, customDiskSize *int) (string, error) {
	var license *string
	for _, copyright := range compiled.Package.Copyright {
		license = &copyright.License
		break
	}

	release := 0
	if compiled.Package.Epoch != 0 {
		release = int(compiled.Package.Epoch)
	}

	logger.Debug("creating initial package version",
		zap.String("package_id", packageID),
		zap.String("version", compiled.Package.Version),
		zap.Int("release", release),
	)

	melangeStr := string(melangeYAML)
	versionID, err := ensurePackageVersionRecord(ctx, tx, packageID, compiled.Package.Version, &melangeStr, now, license, release, useRoot, customDiskSize, compiled)
	if err != nil {
		return "", fmt.Errorf("ensure package version record: %w", err)
	}

	return versionID, nil
}

func ensurePackageVersionRecord(ctx context.Context, tx pgx.Tx, pkgID string, version string, melangeYAML *string, now time.Time, license *string, release int, useRoot bool, customDiskSize *int, compiled *config.Configuration) (string, error) {

	// Try to update existing record first
	result, err := tx.Exec(ctx, `
		UPDATE package_version SET
			melange_yaml = COALESCE($3, melange_yaml),
			updated_at = $4,
			apk_release = $5,
			license = COALESCE($6, license),
			use_root = $7,
			custom_disk_size = $8
		WHERE package_id = $1 AND version = $2 AND apk_release = $5
	`, pkgID, version, melangeYAML, now, release, license, useRoot, customDiskSize)
	if err != nil {
		return "", fmt.Errorf("update package version %s-%s: %w", pkgID, version, err)
	}

	// If no rows were updated, insert a new record
	if result.RowsAffected() == 0 {
		newID, err := securerandom.Hex(32)
		if err != nil {
			return "", fmt.Errorf("generate random id for package version %s-%s: %w", pkgID, version, err)
		}

		if melangeYAML != nil {
			compiled, err := CompileMelangeYAML(ctx, []byte(*melangeYAML))
			if err != nil {
				return "", fmt.Errorf("compile melange yaml: %w", err)
			}

			if compiled.Package.Epoch != 0 {
				release = int(compiled.Package.Epoch)
			}
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO package_version (id, package_id, version, melange_yaml, created_at, updated_at, apk_release, license, use_root, custom_disk_size)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		`, newID, pkgID, version, melangeYAML, now, now, release, license, useRoot, customDiskSize)
		if err != nil {
			return "", fmt.Errorf("insert package version %s-%s: %w", pkgID, version, err)
		}

		pkgVersion, err := getPackageVersionWithTx(ctx, tx, newID)
		if err != nil {
			return "", fmt.Errorf("get package version with tx: %w", err)
		}

		if err := WritePackageVersionDependencies(ctx, tx, pkgVersion); err != nil {
			return "", fmt.Errorf("write package version dependencies: %w", err)
		}

		return newID, nil
	} else {
		// If we updated an existing record, we need to get its ID
		var existingID string
		err = tx.QueryRow(ctx, `
			SELECT id FROM package_version
			WHERE package_id = $1 AND version = $2 AND apk_release = $3
		`, pkgID, version, release).Scan(&existingID)
		if err != nil {
			return "", fmt.Errorf("get existing package version id %s-%s: %w", pkgID, version, err)
		}

		pkgVersion, err := getPackageVersionWithTx(ctx, tx, existingID)
		if err != nil {
			return "", fmt.Errorf("get package version with tx: %w", err)
		}

		if err := WritePackageVersionDependencies(ctx, tx, pkgVersion); err != nil {
			return "", fmt.Errorf("write package version dependencies: %w", err)
		}

		return existingID, nil
	}
}

func WritePackageVersionDependencies(ctx context.Context, tx pgx.Tx, packageVersion *types.PackageVersion) error {
	autocommit := false
	if tx == nil {
		// if tx is nil, we get the connection from the context and begin a new transaction that will be committed at the end of the function
		conn := persistence.MustGetPooledPostgresSession(ctx)
		defer conn.Release()
		var err error
		tx, err = conn.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin tx: %w", err)
		}
		defer tx.Rollback(ctx)
		autocommit = true
	}

	pkg, err := GetPackageWithTx(ctx, tx, packageVersion.PackageID)
	if err != nil {
		return fmt.Errorf("get package: %w", err)
	}

	if pkg.ParentID != nil {
		// For subpackages, don't add any dependencies - they are handled by their parent
		return nil
	}

	// For main packages, compile melange YAML and extract dependencies
	if packageVersion.MelangeYaml == "" {
		return fmt.Errorf("main package has empty melange YAML")
	}

	compiled, err := CompileMelangeYAML(ctx, []byte(packageVersion.MelangeYaml))
	if err != nil {
		return fmt.Errorf("compile melange YAML: %w", err)
	}

	parentRuntimeDeps, err := getParentDependencies(ctx, tx, compiled.Package.Dependencies.Runtime)
	if err != nil {
		return fmt.Errorf("get parents of runtime dependencies: %w", err)
	}

	parentBuildDeps, err := getParentDependencies(ctx, tx, compiled.Environment.Contents.Packages)
	if err != nil {
		return fmt.Errorf("get parents of build dependencies: %w", err)
	}

	runtimeDeps := deduplicateDependencySpecs(parentRuntimeDeps)
	buildDeps := deduplicateDependencySpecs(parentBuildDeps)

	logger.Debug("writing package version dependencies",
		zap.String("package_version_id", packageVersion.ID),
		zap.String("package_id", packageVersion.PackageID),
		zap.String("package_version", packageVersion.Version),
		zap.Int("package_apk_release", packageVersion.APKRelease),
		zap.Int("runtime_deps", len(runtimeDeps)),
		zap.Any("runtime_deps", runtimeDeps),
		zap.Int("build_deps", len(buildDeps)),
		zap.Any("build_deps", buildDeps))

	if err := WritePackageVersionRuntimeDependencies(ctx, tx, packageVersion, runtimeDeps); err != nil {
		return fmt.Errorf("write package version runtime dependencies: %w", err)
	}
	if err := WritePackageVersionBuildDependencies(ctx, tx, packageVersion, buildDeps); err != nil {
		return fmt.Errorf("write package version build dependencies: %w", err)
	}
	if err := WritePackageVersionProvides(ctx, tx, packageVersion); err != nil {
		return fmt.Errorf("write package version provides: %w", err)
	}

	if autocommit {
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit tx: %w", err)
		}
	}

	return nil
}

// DependencySpec retains the complete Melange/APK selector while also recording
// the normalized dependency name used by the existing dependency tables.
type DependencySpec struct {
	Name string
	Spec string
}

func deduplicateDependencySpecs(deps []DependencySpec) []DependencySpec {
	seen := make(map[string]struct{}, len(deps))
	result := make([]DependencySpec, 0, len(deps))
	for _, dep := range deps {
		if _, ok := seen[dep.Name]; ok {
			continue
		}
		seen[dep.Name] = struct{}{}
		result = append(result, dep)
	}
	return result
}

func getParentDependencies(ctx context.Context, tx pgx.Tx, depNames []string) ([]DependencySpec, error) {
	deps := make([]DependencySpec, 0, len(depNames))
	for _, dep := range depNames {
		depName, _, err := GetPackageInfoWithParentRedirection(ctx, tx, dep)
		if err != nil {
			return nil, fmt.Errorf("get package name with parent redirection: %w", err)
		}
		deps = append(deps, DependencySpec{Name: depName, Spec: dep})
	}
	return deps, nil
}

// GetPackageInfoWithParentRedirection checks if a package is a subpackage and redirects to its parent
// returns the package name and package ID
func GetPackageInfoWithParentRedirection(ctx context.Context, tx pgx.Tx, packageName string) (string, string, error) {
	// parse the package name to remove the version if present
	packageName = ParsePackageName(packageName)

	pkgID, err := getPackageIDByName(ctx, tx, packageName)
	if err != nil {
		// unable to find the package, so we return the version-stripped package name
		return packageName, "", nil
	}

	pkg, err := GetPackageWithTx(ctx, tx, pkgID)
	if err != nil {
		return "", "", fmt.Errorf("get package: %w", err)
	}

	// If this is a subpackage, redirect to parent
	if pkg.ParentID != nil {
		parentPkg, err := GetPackageWithTx(ctx, tx, *pkg.ParentID)
		if err != nil {
			// if we can't find the parent package, we return the version-stripped package name
			// this was not expected to happen, but does in prod
			logger.Warn("unable to find parent package",
				zap.String("package_id", pkgID),
				zap.String("package_name", packageName),
				zap.String("parent_id", *pkg.ParentID),
				zap.Error(err))
			return packageName, pkg.ID, nil
		}

		logger.Debug("redirecting subpackage dependency to parent",
			zap.String("subpackage_id", pkgID),
			zap.String("subpackage_name", packageName),
			zap.String("parent_id", *pkg.ParentID),
			zap.String("parent_name", parentPkg.Name))

		return parentPkg.Name, parentPkg.ID, nil
	}

	// Not a subpackage, return the version-stripped package name
	return packageName, pkgID, nil
}
