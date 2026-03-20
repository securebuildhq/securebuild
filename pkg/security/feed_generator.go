package security

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// AlpineSecDB represents the Alpine security database format
// Spec: https://secdb.alpinelinux.org/ (e.g., https://secdb.alpinelinux.org/v3.22/main.json)
type AlpineSecDB struct {
	APKURL        string               `json:"apkurl"`
	Archs         []string             `json:"archs"`
	URLPrefix     string               `json:"urlprefix"`
	DistroVersion string               `json:"distroversion"`
	Packages      []AlpineSecDBPackage `json:"packages"`
}

// AlpineSecDBPackage represents a package entry in the Alpine secdb format
type AlpineSecDBPackage struct {
	Pkg AlpinePackageInfo `json:"pkg"`
}

// AlpinePackageInfo represents package security fix information
type AlpinePackageInfo struct {
	Name     string              `json:"name"`
	SecFixes map[string][]string `json:"secfixes"`
}

// CVEPackageFixRow represents a row from the cve_package_fix table
type CVEPackageFixRow struct {
	CVEID                string
	PackageName          string
	ArtifactName         string
	ArtifactType         string
	ArtifactLanguage     string
	ArtifactFixedVersion []string
	PackageFixedVersion  []string
	Severity             string
	Namespace            string
	UpdatedAt            time.Time
}

// GenerateSecDBFeed generates an Alpine secdb format JSON feed from the cve_package_fix table
// Returns the JSON feed as a string
func GenerateSecDBFeed(ctx context.Context) (string, error) {
	logger.Info("starting Alpine secdb feed generation")

	// Query for all CVEs
	rows, err := queryAllCVEs(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to query CVEs: %w", err)
	}

	// Group by package name and build secfixes map
	// Key: package name, Value: map of version -> []CVE IDs
	packageMap := make(map[string]map[string][]string)

	for _, row := range rows {
		// Initialize package map if needed
		if _, exists := packageMap[row.PackageName]; !exists {
			packageMap[row.PackageName] = make(map[string][]string)
		}

		logger.Debug("processing CVE row for feed generation",
			zap.String("cve_id", row.CVEID),
			zap.String("package_name", row.PackageName),
			zap.String("artifact_type", row.ArtifactType),
			zap.Strings("artifact_fixed_version", row.ArtifactFixedVersion),
			zap.Strings("package_fixed_version", row.PackageFixedVersion),
		)

		// Determine where to place this CVE based on artifact type and available fix information
		if len(row.ArtifactFixedVersion) == 0 {
			// Truly unfixable CVE - use version "0" (Alpine secdb convention)
			if !cveExists(packageMap[row.PackageName]["0"], row.CVEID) {
				packageMap[row.PackageName]["0"] = append(
					packageMap[row.PackageName]["0"],
					row.CVEID,
				)
			}
		} else if len(row.PackageFixedVersion) == 0 {
			// Fix exists upstream but we haven't scanned a package with it yet
			// Use "None" to indicate package is vulnerable but no SecureBuild fix version known. This is a case sensitive value supported by Vunnel.
			logger.Debug("adding CVE to 'None' - fix exists but package version unknown",
				zap.String("cve_id", row.CVEID),
				zap.String("package_name", row.PackageName),
				zap.String("artifact_name", row.ArtifactName),
				zap.String("artifact_type", row.ArtifactType),
				zap.Strings("artifact_fixed_version", row.ArtifactFixedVersion),
			)
			if !cveExists(packageMap[row.PackageName]["None"], row.CVEID) {
				packageMap[row.PackageName]["None"] = append(
					packageMap[row.PackageName]["None"],
					row.CVEID,
				)
			}
		} else {
			// We have package_fixed_version populated - use it for both APK and non-APK
			matchingVersions := filterVersions(row.PackageFixedVersion, row.PackageName)
			logger.Debug("filtered package fixed versions",
				zap.String("cve_id", row.CVEID),
				zap.String("package_name", row.PackageName),
				zap.String("artifact_type", row.ArtifactType),
				zap.Strings("package_fixed_version", row.PackageFixedVersion),
				zap.Strings("matching_versions", matchingVersions),
			)
			for _, pkgVersion := range matchingVersions {
				if !cveExists(packageMap[row.PackageName][pkgVersion], row.CVEID) {
					logger.Debug("adding CVE to package version",
						zap.String("cve_id", row.CVEID),
						zap.String("package_name", row.PackageName),
						zap.String("version", pkgVersion),
					)
					packageMap[row.PackageName][pkgVersion] = append(
						packageMap[row.PackageName][pkgVersion],
						row.CVEID,
					)
				}
			}
		}
	}

	// Convert to AlpineSecDB structure
	packages := make([]AlpineSecDBPackage, 0, len(packageMap))
	for pkgName, secfixes := range packageMap {
		packages = append(packages, AlpineSecDBPackage{
			Pkg: AlpinePackageInfo{
				Name:     pkgName,
				SecFixes: secfixes,
			},
		})
	}

	// Create the full secdb structure
	secdb := AlpineSecDB{
		APKURL:        "{{urlprefix}}/{{arch}}/{{pkg.name}}-{{pkg.ver}}.apk",
		Archs:         []string{"x86_64", "aarch64"},
		URLPrefix:     param.GetParam(ctx).ApkRepository,
		DistroVersion: "v1",
		Packages:      packages,
	}

	// Marshal to JSON
	jsonData, err := json.MarshalIndent(secdb, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal Alpine secdb feed to JSON: %w", err)
	}

	return string(jsonData), nil
}

// filterVersions filters a list of versions to only those matching the package name
// and removes -r0 revisions except the leading one if present
func filterVersions(versions []string, packageName string) []string {
	var matched []string
	for _, version := range versions {
		if versionMatchesPackage(version, packageName) {
			matched = append(matched, version)
		}
	}

	// Remove -r0 revisions except the leading one
	return removeTrailingR0Versions(matched)
}

// removeTrailingR0Versions removes all -r0 versions except the leading one if present
func removeTrailingR0Versions(versions []string) []string {
	if len(versions) == 0 {
		return versions
	}

	var result []string

	for i, version := range versions {
		isR0 := strings.HasSuffix(version, "-r0")

		// Keep the first version if it's -r0
		if i == 0 && isR0 {
			result = append(result, version)
		} else if !isR0 {
			// Always keep non-r0 versions
			result = append(result, version)
		}
		// Skip all other -r0 versions
	}

	return result
}

var versionPrefixRegex = regexp.MustCompile(`^(\d+)(?:\.(\d+))?`)

// versionMatchesPackage checks if a version string matches the package name prefix
// For example: "8.0.4" matches "redis-8.0", but "7.4.6" does not
func versionMatchesPackage(version, packageName string) bool {
	// Extract version suffix from package name using last hyphen
	parts := strings.Split(packageName, "-")
	if len(parts) == 1 {
		// No hyphen in package name, accept all versions
		logger.Debug("versionMatchesPackage: no hyphen in package name, accepting version",
			zap.String("version", version),
			zap.String("package_name", packageName),
		)
		return true
	}

	packageVersionSuffix := parts[len(parts)-1]

	// Check if package suffix is a version using the same regex
	packageMatches := versionPrefixRegex.FindStringSubmatch(packageVersionSuffix)
	if packageMatches == nil {
		// Package suffix is not a version (e.g., "openssl-dev"), accept all versions
		logger.Debug("versionMatchesPackage: package suffix not a version, accepting version",
			zap.String("version", version),
			zap.String("package_name", packageName),
			zap.String("package_suffix", packageVersionSuffix),
		)
		return true
	}

	// Extract version prefix from the version string using regex
	versionMatches := versionPrefixRegex.FindStringSubmatch(version)
	if versionMatches == nil {
		logger.Debug("versionMatchesPackage: version does not match regex, rejecting",
			zap.String("version", version),
			zap.String("package_name", packageName),
		)
		return false
	}

	// Compare based on what the package suffix captured
	// packageMatches[1] = major version (e.g., "8")
	// packageMatches[2] = minor version if present (e.g., "0")
	// versionMatches[1] = major version from actual version
	// versionMatches[2] = minor version from actual version if present

	var result bool
	if packageMatches[2] != "" {
		// Package has major.minor (e.g., "redis-8.0")
		// Version must also have major.minor and they must match
		if versionMatches[2] == "" {
			result = false
		} else {
			result = versionMatches[1] == packageMatches[1] && versionMatches[2] == packageMatches[2]
		}
	} else {
		// Package has major only (e.g., "redis-8")
		// Just match major version
		result = versionMatches[1] == packageMatches[1]
	}

	logger.Debug("versionMatchesPackage: comparison result",
		zap.String("version", version),
		zap.String("package_name", packageName),
		zap.String("package_suffix", packageVersionSuffix),
		zap.Strings("package_matches", packageMatches),
		zap.Strings("version_matches", versionMatches),
		zap.Bool("result", result),
	)

	return result
}

// cveExists checks if a CVE ID already exists in the list
func cveExists(cveList []string, cveID string) bool {
	for _, existingCVE := range cveList {
		if existingCVE == cveID {
			return true
		}
	}
	return false
}

// queryAllCVEs queries the database for all CVEs (both fixable and unfixable)
func queryAllCVEs(ctx context.Context) ([]CVEPackageFixRow, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT
			cve_id,
			package_name,
			artifact_name,
			artifact_type,
			artifact_language,
			artifact_fixed_version,
			package_fixed_version,
			severity,
			namespace,
			updated_at
		FROM cve_package_fix
		ORDER BY cve_id, package_name
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query cve_package_fix table: %w", err)
	}
	defer rows.Close()

	var results []CVEPackageFixRow
	for rows.Next() {
		var row CVEPackageFixRow
		var artifactLanguage sql.NullString

		err := rows.Scan(
			&row.CVEID,
			&row.PackageName,
			&row.ArtifactName,
			&row.ArtifactType,
			&artifactLanguage,
			&row.ArtifactFixedVersion,
			&row.PackageFixedVersion,
			&row.Severity,
			&row.Namespace,
			&row.UpdatedAt,
		)
		if err != nil {
			logger.Warn("failed to scan row from cve_package_fix", zap.Error(err))
			continue
		}

		row.ArtifactLanguage = artifactLanguage.String

		results = append(results, row)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	return results, nil
}
