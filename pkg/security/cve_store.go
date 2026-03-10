package security

import (
	"context"
	"fmt"
	"time"

	"github.com/anchore/syft/syft/artifact"
	"github.com/anchore/syft/syft/pkg"
	"github.com/anchore/syft/syft/sbom"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

// CVEPackageFix represents a CVE vulnerability match mapped to a package fix
// This is an in-memory representation used during scanning and correlation
// Note: PackageVersion and ArtifactVersion are NOT stored in the database
type CVEPackageFix struct {
	CVEID string // CVE-2024-1234 or GO-2025-3955

	// Package columns (APK package that needs to be upgraded)
	PackageName    string // APK package name (e.g., "helm-3.19")
	PackageVersion string // APK package version (e.g., "3.19.0-r2")

	// Artifact columns (original vulnerable artifact from Grype scan)
	ArtifactName     string // Original artifact (e.g., "golang.org/x/crypto" or "helm-3.19")
	ArtifactVersion  string // Artifact version (e.g., "v0.41.0")
	ArtifactType     string // Type from Grype (e.g., "go-module", "apk", "npm")
	ArtifactLanguage string // Language if applicable (e.g., "go", empty for apk)

	// CVE details
	ArtifactFixedVersion []string // List of versions that fix the CVE
	Severity             string   // Critical, High, Medium, Low

	// Vulnerability namespace
	Namespace string // nvd:cpe, github:go, etc.
}

// CorrelateVulnerabilityToPackage correlates a vulnerability from a language package
// (e.g., golang.org/x/crypto) back to ALL APK packages that contain it
//
// For APK packages: returns a single-element slice with the CVEPackageFix as-is
// For non-APK packages: uses OwnershipByFileOverlapRelationship to find ALL owning APK packages
//
// Returns multiple CVEPackageFix records when the same artifact exists in multiple packages
// (e.g., golang.org/x/crypto might be in helm-3.19, kotsadm-1.128, and kubectl-1.33)
//
// Algorithm:
// 1. Find the vulnerable artifact in the SBOM
// 2. Use SBOM.RelationshipsForPackage() with OwnershipByFileOverlapRelationship
// 3. Find ALL relationships where the artifact is the child (To) and parent is an APK package
// 4. Return one CVEPackageFix per owning APK package
func CorrelateVulnerabilityToPackage(ctx context.Context, cveMatch CVEPackageFix, sbomData *sbom.SBOM) ([]CVEPackageFix, error) {
	// If this is already an APK package, no correlation needed
	if cveMatch.ArtifactType == "apk" {
		return []CVEPackageFix{cveMatch}, nil
	}

	// Find the vulnerable artifact package in the SBOM
	var vulnerableArtifact *pkg.Package
	for p := range sbomData.Artifacts.Packages.Enumerate() {
		if p.Name == cveMatch.ArtifactName && p.Version == cveMatch.ArtifactVersion {
			vulnerableArtifact = &p
			break
		}
	}

	if vulnerableArtifact == nil {
		return nil, fmt.Errorf("could not find vulnerable artifact %s@%s in SBOM", cveMatch.ArtifactName, cveMatch.ArtifactVersion)
	}

	// Get the file path from the vulnerable artifact's location (for logging/debugging)
	var binaryPath string
	locations := vulnerableArtifact.Locations.ToSlice()
	if len(locations) > 0 {
		binaryPath = locations[0].Path()
	}

	// Use Syft's public API to find ownership relationships
	// This finds ALL packages that own this artifact via file overlap
	rels := sbomData.RelationshipsForPackage(*vulnerableArtifact, artifact.OwnershipByFileOverlapRelationship)

	logger.Debug("checking ownership relationships for artifact",
		zap.String("artifact", cveMatch.ArtifactName),
		zap.String("artifact_version", cveMatch.ArtifactVersion),
		zap.String("binary_path", binaryPath),
		zap.Int("relationship_count", len(rels)))

	// Find ALL APK packages that own this artifact
	var results []CVEPackageFix
	for _, rel := range rels {
		// Check if vulnerableArtifact is the child (To) in this relationship
		if rel.To != nil && rel.To.ID() == vulnerableArtifact.ID() {
			// The parent (From) is the owning package
			if parent, ok := rel.From.(pkg.Package); ok {
				logger.Debug("found ownership relationship",
					zap.String("parent_name", parent.Name),
					zap.String("parent_version", parent.Version),
					zap.String("parent_type", string(parent.Type)),
					zap.String("child_name", cveMatch.ArtifactName))

				if parent.Type == pkg.ApkPkg {
					// Create a new CVEPackageFix for this owning package
					// Clone the original match and update package fields
					correlatedMatch := cveMatch
					correlatedMatch.PackageName = parent.Name
					correlatedMatch.PackageVersion = parent.Version
					results = append(results, correlatedMatch)

					logger.Debug("correlated vulnerability to APK package",
						zap.String("artifact", cveMatch.ArtifactName),
						zap.String("artifact_version", cveMatch.ArtifactVersion),
						zap.String("apk_package", parent.Name),
						zap.String("apk_version", parent.Version),
						zap.String("binary_path", binaryPath))
				}
			}
		}
	}

	if len(results) == 0 {
		return nil, fmt.Errorf("could not find APK package owning file %s for vulnerable artifact %s@%s", binaryPath, cveMatch.ArtifactName, cveMatch.ArtifactVersion)
	}

	logger.Debug("correlation complete",
		zap.String("artifact", cveMatch.ArtifactName),
		zap.String("artifact_version", cveMatch.ArtifactVersion),
		zap.Int("apk_packages_found", len(results)))

	return results, nil
}

// StoreCVEMatches stores CVE matches in the database after correlating them to APK packages
func StoreCVEMatches(ctx context.Context, apkoID string, matches []CVEPackageFix, sbomData *sbom.SBOM) error {
	if len(matches) == 0 {
		logger.Debug("no CVE matches to store", zap.String("apkoID", apkoID))
		return nil
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now().UTC()

	// Process each CVE match and store in database
	for _, match := range matches {
		// Run correlation algorithm to map language packages to APK packages
		// This can return multiple packages if the artifact exists in multiple places
		correlatedMatches, err := CorrelateVulnerabilityToPackage(ctx, match, sbomData)
		if err != nil {
			logger.Warn("failed to correlate vulnerability to package, skipping",
				zap.String("cveID", match.CVEID),
				zap.String("artifact", match.ArtifactName),
				zap.String("artifact_version", match.ArtifactVersion),
				zap.Error(err))
			continue
		}

		// Insert a record for each owning APK package
		for _, correlatedMatch := range correlatedMatches {
			// Generate ID for the record
			id, err := securerandom.Hex(16)
			if err != nil {
				logger.Warn("failed to generate ID for CVE record", zap.Error(err))
				continue
			}

			// Insert or update CVE record with new schema fields
			// Unique constraint is on (artifact_name, cve_id, package_name)
			upsertQuery := `
				INSERT INTO cve_package_fix (
					id, cve_id,
					package_name,
					artifact_name, artifact_type, artifact_language,
					artifact_fixed_version, severity, namespace,
					created_at, updated_at
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
				ON CONFLICT (artifact_name, cve_id, package_name) DO UPDATE SET
					artifact_type = EXCLUDED.artifact_type,
					artifact_language = EXCLUDED.artifact_language,
					artifact_fixed_version = EXCLUDED.artifact_fixed_version,
					severity = EXCLUDED.severity,
					namespace = EXCLUDED.namespace,
					updated_at = EXCLUDED.updated_at
				WHERE cve_package_fix.artifact_fixed_version IS DISTINCT FROM EXCLUDED.artifact_fixed_version
				   OR cve_package_fix.severity IS DISTINCT FROM EXCLUDED.severity`

			_, err = conn.Exec(ctx, upsertQuery,
				id,
				correlatedMatch.CVEID,
				correlatedMatch.PackageName,
				correlatedMatch.ArtifactName,
				correlatedMatch.ArtifactType,
				correlatedMatch.ArtifactLanguage,
				correlatedMatch.ArtifactFixedVersion,
				correlatedMatch.Severity,
				correlatedMatch.Namespace,
				now,
			)
			if err != nil {
				logger.Errorf("failed to upsert CVE record for %s: %v", correlatedMatch.CVEID, err)
				continue
			}
		}
	}

	// Update last_scanned_for_cves timestamp on image_sbom table
	updateQuery := `
		UPDATE image_sbom
		SET last_scanned_for_cves = $1
		WHERE image_apko_id = $2`

	_, err := conn.Exec(ctx, updateQuery, now, apkoID)
	if err != nil {
		return fmt.Errorf("failed to update last_scanned_for_cves timestamp: %w", err)
	}

	logger.Info("successfully stored CVE matches",
		zap.String("apkoID", apkoID),
		zap.Int("total_matches", len(matches)),
		zap.Int("fixable_matches", countFixableMatches(matches)))

	return nil
}

// countFixableMatches counts the number of fixable CVEs in the matches
func countFixableMatches(matches []CVEPackageFix) int {
	count := 0
	for _, match := range matches {
		if len(match.ArtifactFixedVersion) > 0 {
			count++
		}
	}
	return count
}
