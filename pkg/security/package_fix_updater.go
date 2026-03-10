package security

import (
	"context"
	"fmt"
	"sort"

	"github.com/Masterminds/semver/v3"
	"github.com/anchore/syft/syft/artifact"
	"github.com/anchore/syft/syft/pkg"
	"github.com/anchore/syft/syft/sbom"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// UpdatePackageFixVersions processes an SBOM to update the package_fixed_version column
// in the cve_package_fix table. This function identifies which package versions contain
// fixed versions of non-APK artifacts (Go modules, npm packages, etc.) and records this
// information for vulnerability feed generation.
//
// Process:
// 1. Extract package -> dependency relationships from SBOM
// 2. For each CVE in the database with artifact_fixed_version set:
//    a. Check if the scanned artifact version >= any fixed version (using Grype's version comparison)
//    b. If yes, record the package version as containing the fix
//
// Parameters:
//   - ctx: Context for database operations
//   - s: SBOM containing package and dependency information
//   - targetPackage: The package being scanned (e.g., "redis-8.0" at version "8.0.4-r0")
//
// Returns error if database operations fail.
func UpdatePackageFixVersions(
	ctx context.Context,
	s *sbom.SBOM,
	targetPackage pkg.Package,
) error {
	logger.Info("updating package fixed versions from SBOM",
		zap.String("package", targetPackage.Name),
		zap.String("version", targetPackage.Version),
	)

	// Build artifact map only for artifacts owned by this specific package
	// Use ownership relationships to find which artifacts belong to this package
	artifactMap := make(map[string]string)

	// Get all relationships where this package is the owner (From)
	rels := s.RelationshipsForPackage(targetPackage, artifact.OwnershipByFileOverlapRelationship)
	for _, rel := range rels {
		if rel.From != nil && rel.From.ID() == targetPackage.ID() {
			// This package owns the child artifact
			if childPkg, ok := rel.To.(pkg.Package); ok {
				artifactMap[childPkg.Name] = childPkg.Version
			}
		}
	}

	// Also include the package itself if it's an APK
	if targetPackage.Type == pkg.ApkPkg {
		artifactMap[targetPackage.Name] = targetPackage.Version
	}

	logger.Debug("extracted artifacts owned by package from SBOM",
		zap.String("package", targetPackage.Name),
		zap.String("version", targetPackage.Version),
		zap.Int("artifact_count", len(artifactMap)),
	)

	// Step 2: Query CVEs for this package that have artifact fixes but unknown package fixes
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT
			cve_id,
			artifact_name,
			artifact_type,
			artifact_fixed_version
		FROM cve_package_fix
		WHERE package_name = $1
		  AND artifact_fixed_version IS NOT NULL
		  AND array_length(artifact_fixed_version, 1) > 0
		ORDER BY cve_id, artifact_name
	`

	rows, err := conn.Query(ctx, query, targetPackage.Name)
	if err != nil {
		return fmt.Errorf("failed to query CVEs for package %s: %w", targetPackage.Name, err)
	}
	defer rows.Close()

	// Step 3: Collect all CVEs that need updates (must complete before executing updates)
	type updateInfo struct {
		cveID        string
		artifactName string
	}
	var updates []updateInfo

	for rows.Next() {
		var (
			cveID                string
			artifactName         string
			artifactType         string
			artifactFixedVersion []string
		)

		err := rows.Scan(
			&cveID,
			&artifactName,
			&artifactType,
			&artifactFixedVersion,
		)
		if err != nil {
			return fmt.Errorf("failed to scan CVE row: %w", err)
		}

		// Check if this SBOM contains the artifact
		scannedArtifactVersion, found := artifactMap[artifactName]
		if !found {
			// This SBOM doesn't contain the artifact, skip
			continue
		}

		// Check if the scanned artifact version satisfies any of the fixed versions
		hasFixVersion, err := ArtifactVersionSatisfiesAnyFix(
			scannedArtifactVersion,
			artifactFixedVersion,
			artifactType,
		)
		if err != nil {
			logger.Warn("failed to compare versions",
				zap.String("cve_id", cveID),
				zap.String("artifact", artifactName),
				zap.String("scanned_version", scannedArtifactVersion),
				zap.Strings("fixed_versions", artifactFixedVersion),
				zap.Error(err),
			)
			continue
		}

		if !hasFixVersion {
			// This package version doesn't contain the fix
			continue
		}

		// Add to updates list
		updates = append(updates, updateInfo{
			cveID:        cveID,
			artifactName: artifactName,
		})
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("error iterating CVE rows: %w", err)
	}

	// Step 4: Execute all updates in transactions with SELECT FOR UPDATE
	updatedCount := 0

	for _, update := range updates {
		// Start transaction for this update
		tx, err := conn.Begin(ctx)
		if err != nil {
			return fmt.Errorf("failed to begin transaction: %w", err)
		}

		// Fetch current package_fixed_version array with row lock
		var currentVersions []string
		fetchQuery := `
			SELECT COALESCE(package_fixed_version, ARRAY[]::text[])
			FROM cve_package_fix
			WHERE package_name = $1
			  AND cve_id = $2
			  AND artifact_name = $3
			FOR UPDATE
		`
		err = tx.QueryRow(ctx, fetchQuery, targetPackage.Name, update.cveID, update.artifactName).Scan(&currentVersions)
		if err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("failed to fetch current package_fixed_version for %s (CVE %s, artifact %s): %w",
				targetPackage.Name, update.cveID, update.artifactName, err)
		}

		// Deduplicate at major.minor.patch level - keep only lowest version for each prefix
		newVersions := deduplicateVersionsByPrefix(currentVersions, targetPackage.Version)

		// Update with deduplicated array
		updateQuery := `
			UPDATE cve_package_fix
			SET package_fixed_version = $1
			WHERE package_name = $2
			  AND cve_id = $3
			  AND artifact_name = $4
		`
		_, err = tx.Exec(ctx, updateQuery, newVersions, targetPackage.Name, update.cveID, update.artifactName)
		if err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("failed to update package_fixed_version for %s@%s (CVE %s, artifact %s): %w",
				targetPackage.Name, targetPackage.Version, update.cveID, update.artifactName, err)
		}

		// Commit transaction
		err = tx.Commit(ctx)
		if err != nil {
			return fmt.Errorf("failed to commit transaction: %w", err)
		}

		updatedCount++
		logger.Debug("updated package_fixed_version",
			zap.String("package", targetPackage.Name),
			zap.String("version", targetPackage.Version),
			zap.String("cve_id", update.cveID),
			zap.String("artifact", update.artifactName),
		)
	}

	logger.Info("completed package fixed version update",
		zap.String("package", targetPackage.Name),
		zap.String("version", targetPackage.Version),
		zap.Int("updated_cves", updatedCount),
	)

	return nil
}

// deduplicateVersionsByPrefix deduplicates versions at the major.minor.patch level,
// keeping only the lowest version for each prefix.
// For example: ["8.0.3-r2", "8.0.3-r4", "8.0.4-r1"] -> ["8.0.3-r2", "8.0.4-r1"]
func deduplicateVersionsByPrefix(existingVersions []string, newVersion string) []string {
	// Copy input to avoid mutating caller's data
	allVersions := make([]string, len(existingVersions), len(existingVersions)+1)
	copy(allVersions, existingVersions)
	allVersions = append(allVersions, newVersion)

	// Sort by semver (lowest first)
	sort.Slice(allVersions, func(i, j int) bool {
		vi, errI := semver.NewVersion(allVersions[i])
		vj, errJ := semver.NewVersion(allVersions[j])
		if errI != nil || errJ != nil {
			return allVersions[i] < allVersions[j]
		}
		return vi.LessThan(vj)
	})

	// Iterate and keep only first occurrence of each major.minor.patch
	result := make([]string, 0, len(allVersions))
	seen := make(map[string]bool)

	for _, v := range allVersions {
		ver, err := semver.NewVersion(v)
		if err != nil {
			// Keep unparseable versions
			if !seen[v] {
				result = append(result, v)
				seen[v] = true
			}
			continue
		}

		prefix := fmt.Sprintf("%d.%d.%d", ver.Major(), ver.Minor(), ver.Patch())
		if !seen[prefix] {
			result = append(result, v)
			seen[prefix] = true
		}
	}

	return result
}
