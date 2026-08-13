package sbpackage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"

	apkopackage "chainguard.dev/apko/pkg/apk/apk"
	"github.com/Masterminds/semver"
	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

func ListPackageVersionsNeedingDependencyGraphRebuild(ctx context.Context) ([]*types.PackageVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT pv.id
		FROM package_version pv
		JOIN package p ON pv.package_id = p.id
		LEFT JOIN package_version_dependency_runtime pvr ON pv.id = pvr.package_version_id
		LEFT JOIN package_version_dependency_buildtime pvb ON pv.id = pvb.package_version_id
		WHERE p.parent_id IS NULL
		  AND pvr.package_version_id IS NULL
		  AND pvb.package_version_id IS NULL
	`

	rows, err := conn.Query(ctx, query)
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

func ListPackageVersionRuntimeDependencies(ctx context.Context, packageVersionID string) ([]string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select COALESCE(dependency_spec, depends_on_package_name) from package_version_dependency_runtime where package_version_id = $1`
	rows, err := conn.Query(ctx, query, packageVersionID)
	if err != nil {
		return nil, fmt.Errorf("list package version runtime dependencies: %w", err)
	}
	defer rows.Close()

	dependencies := []string{}

	for rows.Next() {
		var dependency string
		err := rows.Scan(&dependency)
		if err != nil {
			return nil, fmt.Errorf("scan dependency: %w", err)
		}
		dependencies = append(dependencies, dependency)
	}

	return dependencies, nil
}

func SetPackageVersionRuntimeDependencyVersion(ctx context.Context, pkgVersion *types.PackageVersion, runtimeDep string, dependsOnPackageVersion *types.PackageVersion) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `update package_version_dependency_runtime set depends_on_package_version_id = $1 where package_version_id = $2 and (dependency_spec = $3 or depends_on_package_name = $4)`
	_, err := conn.Exec(ctx, query, dependsOnPackageVersion.ID, pkgVersion.ID, runtimeDep, ParsePackageName(runtimeDep))
	if err != nil {
		return fmt.Errorf("update package version dependency runtime: %w", err)
	}

	return nil
}

// DependencyType represents the type of dependency (runtime or build)
type DependencyType string

const (
	DependencyTypeRuntime DependencyType = "runtime"
	DependencyTypeBuild   DependencyType = "build"
)

// packageVersionCandidate represents a candidate package version that provides a dependency
type packageVersionCandidate struct {
	PackageID     string
	VersionID     string
	Version       string
	APKRelease    int
	ParentID      *string
	ParsedVersion *semver.Version // nil if version cannot be parsed as semver
}

// packageVersionCandidateList implements sort.Interface for sorting candidates by semver (descending)
type packageVersionCandidateList []packageVersionCandidate

func (p packageVersionCandidateList) Len() int {
	return len(p)
}

func (p packageVersionCandidateList) Swap(i, j int) {
	p[i], p[j] = p[j], p[i]
}

func (p packageVersionCandidateList) Less(i, j int) bool {
	// If both have parsed versions, compare by semver (descending order)
	if p[i].ParsedVersion != nil && p[j].ParsedVersion != nil {
		if p[i].ParsedVersion.GreaterThan(p[j].ParsedVersion) {
			return true
		}
		if p[i].ParsedVersion.LessThan(p[j].ParsedVersion) {
			return false
		}
		// Same semver, compare by APK release (descending order)
		return p[i].APKRelease > p[j].APKRelease
	}

	// If one parses and the other doesn't, prefer the one that parses (comes first in descending order)
	if p[i].ParsedVersion != nil && p[j].ParsedVersion == nil {
		return true
	}
	if p[i].ParsedVersion == nil && p[j].ParsedVersion != nil {
		return false
	}

	// If neither parses, fall back to lexicographic comparison (descending order)
	if p[i].Version != p[j].Version {
		return p[i].Version > p[j].Version
	}
	// Same version string, compare by APK release (descending order)
	return p[i].APKRelease > p[j].APKRelease
}

// resolvePackageIDFromCandidate resolves a package ID from a candidate (return parent if subpackage, otherwise return package ID)
func resolvePackageIDFromCandidate(candidate packageVersionCandidate, depName string) (string, error) {
	if candidate.ParentID != nil {
		// This is a subpackage, return the parent package ID
		logger.Debug("dependency provided by subpackage, resolving to parent",
			zap.String("depends_on_package_name", depName),
			zap.String("subpackage_id", candidate.PackageID),
			zap.String("parent_id", *candidate.ParentID))
		return *candidate.ParentID, nil
	}
	// This is a main package, return its ID
	return candidate.PackageID, nil
}

// selectMatchingCandidate selects a matching candidate from the list based on version constraints.
// It sorts candidates by semver (descending) and then by APK release (descending).
// If no version constraint is specified, it returns the latest (first in sorted order).
// If a version constraint is specified, it returns the first candidate that satisfies the constraint.
// If no candidate satisfies the constraint, it falls back to the latest.
func selectMatchingCandidate(candidates []packageVersionCandidate, constraint apkopackage.ParsedConstraint, depName string) (string, error) {
	if len(candidates) == 0 {
		// No package provides this name - cannot resolve
		return "", fmt.Errorf("dependency not found by name or provides: %s: %w", depName, ErrPackageNotFound)
	}

	// Sort candidates by semver (descending) and then by APK release (descending)
	// This ensures proper semantic version ordering, not lexicographic
	// Versions that cannot be parsed are treated as oldest (come at the end)
	sort.Sort(packageVersionCandidateList(candidates))

	// If no version constraint is specified, use the latest (first in sorted order)
	if constraint.Version == "" {
		pkgID, err := resolvePackageIDFromCandidate(candidates[0], depName)
		if err != nil {
			return "", fmt.Errorf("resolve package ID from candidate for dependency %s: %w", depName, err)
		}
		logger.Debug("found dependency via provides, using latest version",
			zap.String("depends_on_package_name", depName),
			zap.String("package_id", pkgID),
			zap.String("package_version_id", candidates[0].VersionID),
			zap.String("package_version", candidates[0].Version))
		return pkgID, nil
	}

	// Version constraint is specified, use SatisfiedBy to find matching candidates
	// Try candidates in order (newest first) until we find one that satisfies the constraint
	for _, candidate := range candidates {
		// Parse candidate version as apkopackage.Version for constraint checking
		candidateVersion, err := apkopackage.ParseVersion(candidate.Version)
		if err != nil {
			logger.Debug("failed to parse candidate version for constraint check, skipping",
				zap.String("depends_on_package_name", depName),
				zap.String("package_id", candidate.PackageID),
				zap.String("package_version_id", candidate.VersionID),
				zap.String("version", candidate.Version),
				zap.Error(err))
			continue
		}

		// Check if this candidate version satisfies the constraint
		satisfied, err := constraint.SatisfiedBy(candidateVersion)
		if err != nil {
			logger.Debug("failed to check if version satisfies constraint, skipping",
				zap.String("depends_on_package_name", depName),
				zap.String("package_id", candidate.PackageID),
				zap.String("package_version_id", candidate.VersionID),
				zap.String("version", candidate.Version),
				zap.String("constraint", constraint.Version),
				zap.Error(err))
			continue
		}

		if satisfied {
			pkgID, err := resolvePackageIDFromCandidate(candidate, depName)
			if err != nil {
				return "", fmt.Errorf("resolve package ID from candidate for dependency %s (constraint match): %w", depName, err)
			}
			logger.Debug("found dependency via provides with constraint match",
				zap.String("depends_on_package_name", depName),
				zap.String("constraint", constraint.Version),
				zap.String("matched_version", candidate.Version),
				zap.String("package_id", pkgID),
				zap.String("package_version_id", candidate.VersionID))
			return pkgID, nil
		}
	}

	// Version constraint specified but no match found - return error
	// We should not fall back to latest as it would create incorrect dependency relationships
	return "", fmt.Errorf("no candidate satisfies version constraint %s for dependency %s: %w", constraint.Version, depName, ErrPackageNotFound)
}

// resolveDependencyPackageID resolves a dependency to a package ID by:
// 1. First trying to find a package by exact name
// 2. If not found, looking up in package_version_provides to find packages that provide this name
// 3. If version constraint is specified, matching using ParsedConstraint.SatisfiedBy
// 4. If no version constraint, getting the latest version among all packages that provide this name
// Returns the package ID, or an error if the dependency cannot be resolved
func resolveDependencyPackageID(ctx context.Context, tx pgx.Tx, dep string) (string, error) {
	// Parse dependency to extract name and optional version constraint using apko's parser
	parsed := apkopackage.ResolvePackageNameVersionPin(dep)
	depName := parsed.Name

	// First, try to find a package by exact name
	depPkgID, err := getPackageIDByName(ctx, tx, depName)
	if err == nil {
		// An exact dependency can name a subpackage. Rebuild its parent package.
		pkg, getErr := GetPackageWithTx(ctx, tx, depPkgID)
		if getErr != nil {
			return "", fmt.Errorf("get exact dependency package: %w", getErr)
		}
		if pkg.ParentID != nil {
			return *pkg.ParentID, nil
		}
		return depPkgID, nil
	}
	if err != ErrPackageNotFound {
		return "", fmt.Errorf("get package id by name: %w", err)
	}

	// Package not found by exact name, try to find via provides
	// Query package_version_provides to find packages that provide this name
	// This includes both main packages and subpackages - we'll resolve to parent if needed
	query := `
		SELECT DISTINCT pv.package_id, pv.id, pv.version, pv.apk_release, p.parent_id
		FROM package_version_provides pvp
		JOIN package_version pv ON pvp.package_version_id = pv.id
		JOIN package p ON pv.package_id = p.id
		WHERE pvp.provides_name = $1
	`

	rows, err := tx.Query(ctx, query, depName)
	if err != nil {
		return "", fmt.Errorf("query package_version_provides: %w", err)
	}
	defer rows.Close()

	var candidates []packageVersionCandidate

	for rows.Next() {
		var pkgID, versionID, version string
		var apkRelease int
		var parentID sql.NullString
		if err := rows.Scan(&pkgID, &versionID, &version, &apkRelease, &parentID); err != nil {
			return "", fmt.Errorf("scan provides row: %w", err)
		}
		var parentIDPtr *string
		if parentID.Valid {
			parentIDPtr = &parentID.String
		}

		// Parse version as semver for sorting
		var parsedVersion *semver.Version
		semverParsed, err := semver.NewVersion(version)
		if err != nil {
			logger.Error(fmt.Errorf("failed to parse version as semver: %w", err),
				zap.String("depends_on_package_name", depName),
				zap.String("package_id", pkgID),
				zap.String("package_version_id", versionID),
				zap.String("version", version))
			// parsedVersion remains nil - will be treated as oldest in sorting
		} else {
			parsedVersion = semverParsed
		}

		candidates = append(candidates, packageVersionCandidate{
			PackageID:     pkgID,
			VersionID:     versionID,
			Version:       version,
			APKRelease:    apkRelease,
			ParentID:      parentIDPtr,
			ParsedVersion: parsedVersion,
		})
	}

	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("error iterating provides rows: %w", err)
	}

	// Select matching candidate from sorted list
	pkgID, err := selectMatchingCandidate(candidates, parsed, depName)
	if err != nil {
		return "", fmt.Errorf("select matching candidate for dependency %s: %w", depName, err)
	}
	return pkgID, nil
}

func writePackageVersionDependencies(ctx context.Context, tx pgx.Tx, packageVersion *types.PackageVersion, deps []DependencySpec, depType DependencyType) error {
	var tableName string

	switch depType {
	case DependencyTypeRuntime:
		tableName = "package_version_dependency_runtime"
	case DependencyTypeBuild:
		tableName = "package_version_dependency_buildtime"
	default:
		return fmt.Errorf("invalid dependency type: %s", depType)
	}

	query := fmt.Sprintf(`delete from %s where package_version_id = $1`, tableName)
	_, err := tx.Exec(ctx, query, packageVersion.ID)
	if err != nil {
		return fmt.Errorf("delete package version dependency %s: %w", depType, err)
	}

	query = `select name from package where id = $1`
	row := tx.QueryRow(ctx, query, packageVersion.PackageID)
	var pkgName string
	err = row.Scan(&pkgName)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return fmt.Errorf("scan package name: %w", err)
	}

	logger.Debug(fmt.Sprintf("inserting %s dependencies", depType),
		zap.String("package_version_id", packageVersion.ID),
		zap.String("package_name", pkgName),
		zap.String("package_version", packageVersion.Version),
		zap.Int("package_apk_release", packageVersion.APKRelease),
		zap.Int(fmt.Sprintf("%s_deps", depType), len(deps)),
		zap.Any(fmt.Sprintf("%s_deps", depType), deps))

	// Deduplicate dependencies by normalized name and keep the first selector.
	uniqueDeps := make(map[string]string)
	for _, dep := range deps {
		if _, exists := uniqueDeps[dep.Name]; !exists {
			uniqueDeps[dep.Name] = dep.Spec
		}
	}

	for depName, originalDep := range uniqueDeps {
		depPkgID, err := resolveDependencyPackageID(ctx, tx, originalDep)
		if err != nil {
			// Continue updating other packages even if one is missing, but log the error because this is an erro and the package needs to be created.
			if errors.Is(err, ErrPackageNotFound) {
				logger.Error(err,
					zap.String("dependency_type", string(depType)),
					zap.String("package_version_id", packageVersion.ID),
					zap.String("package_name", pkgName),
					zap.String("package_version", packageVersion.Version),
					zap.Int("package_apk_release", packageVersion.APKRelease),
					zap.String("depends_on_package_name", depName),
					zap.String("original_dependency", originalDep))
				// Continue iterating - skip this dependency
				continue
			}
			// Return on all other errors (database errors, transient failures, etc.)
			// This ensures the transaction rolls back instead of committing with missing dependencies
			return fmt.Errorf("resolve %s dependency %s: %w", depType, depName, err)
		}

		query := fmt.Sprintf(`INSERT INTO %s (package_version_id, package_name, package_version, package_apk_release, depends_on_package_id, depends_on_package_name, dependency_spec, depends_on_package_is_external) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (package_version_id, depends_on_package_id) DO UPDATE SET depends_on_package_name = EXCLUDED.depends_on_package_name, dependency_spec = EXCLUDED.dependency_spec, depends_on_package_is_external = EXCLUDED.depends_on_package_is_external`, tableName)
		_, err = tx.Exec(ctx, query, packageVersion.ID, pkgName, packageVersion.Version, packageVersion.APKRelease, depPkgID, depName, originalDep, false)
		if err != nil {
			return fmt.Errorf("insert package version dependency %s: %w", depType, err)
		}
	}

	return nil
}

func WritePackageVersionRuntimeDependencies(ctx context.Context, tx pgx.Tx, packageVersion *types.PackageVersion, runtimeDeps []DependencySpec) error {
	return writePackageVersionDependencies(ctx, tx, packageVersion, runtimeDeps, DependencyTypeRuntime)
}

func SetPackageVersionBuildDependencyVersion(ctx context.Context, pkgVersion *types.PackageVersion, buildDep string, dependsOnPackageVersion *types.PackageVersion) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `update package_version_dependency_buildtime set depends_on_package_version_id = $1 where package_version_id = $2 and (dependency_spec = $3 or depends_on_package_name = $4)`
	_, err := conn.Exec(ctx, query, dependsOnPackageVersion.ID, pkgVersion.ID, buildDep, ParsePackageName(buildDep))
	if err != nil {
		return fmt.Errorf("update package version dependency buildtime: %w", err)
	}

	return nil
}

func ListPackageVersionBuildDependencies(ctx context.Context, packageVersionID string) ([]string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select COALESCE(dependency_spec, depends_on_package_name) from package_version_dependency_buildtime where package_version_id = $1`
	rows, err := conn.Query(ctx, query, packageVersionID)
	if err != nil {
		return nil, fmt.Errorf("list package version build dependencies: %w", err)
	}
	defer rows.Close()

	dependencies := []string{}

	for rows.Next() {
		var dependency string
		err := rows.Scan(&dependency)
		if err != nil {
			return nil, fmt.Errorf("scan dependency: %w", err)
		}
		dependencies = append(dependencies, dependency)
	}

	return dependencies, nil
}

func WritePackageVersionBuildDependencies(ctx context.Context, tx pgx.Tx, packageVersion *types.PackageVersion, buildDeps []DependencySpec) error {
	return writePackageVersionDependencies(ctx, tx, packageVersion, buildDeps, DependencyTypeBuild)
}

func GetPackageDependencyMap(ctx context.Context) (map[string][]string, error) {
	db := persistence.MustGetPooledPostgresSession(ctx)
	defer db.Release()

	// Map of package name to its dependents (packages that depend on this package)
	dependencyMap := make(map[string][]string)

	// Query both runtime and buildtime dependencies, excluding subpackages
	query := `
		SELECT DISTINCT 
			depends_on_package_name,
			package_name
		FROM (
			SELECT pvdr.depends_on_package_name, pvdr.package_name
			FROM package_version_dependency_runtime pvdr
			JOIN package_version pv ON pvdr.package_version_id = pv.id
			JOIN package p ON pv.package_id = p.id
			WHERE pvdr.depends_on_package_is_external = false
			  AND p.parent_id IS NULL
			UNION
			SELECT pvdb.depends_on_package_name, pvdb.package_name
			FROM package_version_dependency_buildtime pvdb
			JOIN package_version pv ON pvdb.package_version_id = pv.id
			JOIN package p ON pv.package_id = p.id
			WHERE pvdb.depends_on_package_is_external = false
			  AND p.parent_id IS NULL
		) AS all_deps
		ORDER BY depends_on_package_name, package_name
	`

	rows, err := db.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query dependencies: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var dependsOnPackage, packageName string
		if err := rows.Scan(&dependsOnPackage, &packageName); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}

		// Add packageName as a dependent of dependsOnPackage
		dependencyMap[dependsOnPackage] = append(dependencyMap[dependsOnPackage], packageName)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	// Ensure all packages that appear as dependents also have entries in the map
	for _, dependents := range dependencyMap {
		for _, dependent := range dependents {
			if _, exists := dependencyMap[dependent]; !exists {
				dependencyMap[dependent] = []string{}
			}
		}
	}

	return dependencyMap, nil
}

// UpdateExternalDependenciesToInternal updates dependency records that were marked as external
// to point to a newly created internal package and its latest version
func UpdateExternalDependenciesToInternal(ctx context.Context, tx pgx.Tx, packageName string, packageID string, packageVersionID string, targetPackageName string) error {
	// Update runtime dependencies
	runtimeQuery := `
		UPDATE package_version_dependency_runtime 
		SET depends_on_package_id = $1, depends_on_package_version_id = $2, depends_on_package_name = $3, depends_on_package_is_external = false
		WHERE depends_on_package_name = $4 AND depends_on_package_is_external = true
	`
	_, err := tx.Exec(ctx, runtimeQuery, packageID, packageVersionID, targetPackageName, packageName)
	if err != nil {
		return fmt.Errorf("update runtime dependencies for package %s: %w", packageName, err)
	}

	// Update build dependencies
	buildQuery := `
		UPDATE package_version_dependency_buildtime 
		SET depends_on_package_id = $1, depends_on_package_version_id = $2, depends_on_package_name = $3, depends_on_package_is_external = false
		WHERE depends_on_package_name = $4 AND depends_on_package_is_external = true
	`
	_, err = tx.Exec(ctx, buildQuery, packageID, packageVersionID, targetPackageName, packageName)
	if err != nil {
		return fmt.Errorf("update build dependencies for package %s: %w", packageName, err)
	}

	logger.Debug("updated external dependencies to internal",
		zap.String("original_package_name", packageName),
		zap.String("target_package_name", targetPackageName),
		zap.String("package_id", packageID),
		zap.String("package_version_id", packageVersionID))

	return nil
}
