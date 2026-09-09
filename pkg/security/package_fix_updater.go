package security

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/Masterminds/semver/v3"
	"github.com/anchore/syft/syft/pkg"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// UpdatePackageFixVersions records resolutions only after checking the same APK
// version on both supported architectures. Missing Go dependencies require complete
// binary catalogs; absence from an incomplete SBOM is not evidence of removal.
func UpdatePackageFixVersions(ctx context.Context, scans []PackageFixScan, targetPackage pkg.Package, sourceID string) error {
	inventories, err := packageInventories(scans, targetPackage)
	if err != nil {
		return err
	}
	if sourceID == "" {
		return fmt.Errorf("scan source is required for package fix evidence")
	}
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	rows, err := conn.Query(ctx, `SELECT cve_id, artifact_name, artifact_type, artifact_fixed_version
 FROM cve_package_fix WHERE package_name = $1 ORDER BY cve_id, artifact_name`, targetPackage.Name)
	if err != nil {
		return fmt.Errorf("query package CVEs: %w", err)
	}
	type observation struct{ cve, name, reason string }
	var observations []observation
	for rows.Next() {
		var cve, name, artifactType string
		var fixes []string
		if err := rows.Scan(&cve, &name, &artifactType, &fixes); err != nil {
			rows.Close()
			return err
		}
		reason := evaluatePackageFix(inventories, cve, name, artifactType, fixes)
		if reason != "" {
			observations = append(observations, observation{cve, name, reason})
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}

	for _, observation := range observations {
		// Lock before merging: concurrent image builds must not overwrite evidence or
		// restore a fix invalidated by a newer build that reintroduced the dependency.
		tx, err := conn.Begin(ctx)
		if err != nil {
			return err
		}
		err = func() error {
			defer tx.Rollback(ctx)
			var currentVersions []string
			var rawEvidence []byte
			if err := tx.QueryRow(ctx, `SELECT COALESCE(package_fixed_version, ARRAY[]::text[]),
    COALESCE(package_fix_evidence, '{}'::jsonb) FROM cve_package_fix
    WHERE package_name=$1 AND cve_id=$2 AND artifact_name=$3 FOR UPDATE`,
				targetPackage.Name, observation.cve, observation.name).Scan(&currentVersions, &rawEvidence); err != nil {
				return err
			}
			evidence := map[string]packageFixEvidence{}
			if err := json.Unmarshal(rawEvidence, &evidence); err != nil {
				return fmt.Errorf("decode package fix evidence: %w", err)
			}
			record := packageFixEvidence{Reason: observation.reason, Source: sourceID, ObservedAt: time.Now().UTC(), SBOMSHA256: map[string]string{}}
			for _, scan := range scans {
				record.SBOMSHA256[scan.Architecture] = scan.SHA256
			}
			// Conflicting observations for an immutable package version fail closed.
			if previous, ok := evidence[targetPackage.Version]; !ok || previous.Reason != fixAffected {
				evidence[targetPackage.Version] = record
			}
			newVersions, err := mergePackageFixVersions(currentVersions, targetPackage.Version, evidence)
			if err != nil {
				return err
			}
			encoded, err := json.Marshal(evidence)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE cve_package_fix SET package_fixed_version=$1,
    package_fix_evidence=$2, updated_at=NOW()
    WHERE package_name=$3 AND cve_id=$4 AND artifact_name=$5`,
				newVersions, encoded, targetPackage.Name, observation.cve, observation.name); err != nil {
				return err
			}
			return tx.Commit(ctx)
		}()
		if err != nil {
			return fmt.Errorf("record resolution for %s@%s / %s: %w", targetPackage.Name, targetPackage.Version, observation.cve, err)
		}
		logger.Debug("recorded package vulnerability observation", zap.String("package", targetPackage.Name),
			zap.String("version", targetPackage.Version), zap.String("cve", observation.cve), zap.String("reason", observation.reason))
	}
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
