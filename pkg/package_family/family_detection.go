package package_family

import (
	"fmt"
	"strings"

	"github.com/Masterminds/semver"
)

// Package represents a package with its version information
type Package struct {
	ID      string
	Name    string
	Version string
}

// GeneratePackageName generates an expected package name from the template
// Template format: {name}-{major}.{minor}
// Example: "git-{major}.{minor}" with major=2, minor=50 -> "git-2.50"
func GeneratePackageName(template, familyName string, major, minor int) string {
	result := template
	result = strings.ReplaceAll(result, "{name}", familyName)
	result = strings.ReplaceAll(result, "{major}", fmt.Sprintf("%d", major))
	result = strings.ReplaceAll(result, "{minor}", fmt.Sprintf("%d", minor))
	return result
}

// IdentifyFamilyPackages filters a list of packages to return only those that belong
// to the specified package family based on the package name template.
//
// Algorithm:
// 1. For each package, parse version from package.Version (stored as semver in DB)
// 2. Generate expected package name using packageNameTemplate with familyName, major, minor
// 3. If generated name matches package.Name, the package belongs to the family
//
// Parameters:
//   - packages: List of candidate packages (should be filtered by name prefix like "git-%")
//   - familyName: The name of the package family (e.g., "git")
//   - packageNameTemplate: Template for package names (e.g., "{name}-{major}.{minor}")
//   - versionPattern: Ignored (only used for upstream version parsing, not database versions)
//
// Returns:
//   - List of packages that match the family naming pattern
func IdentifyFamilyPackages(packages []Package, familyName, packageNameTemplate, versionPattern string) []Package {
	var familyPackages []Package

	for _, pkg := range packages {
		// Parse version using semver package
		v, err := semver.NewVersion(pkg.Version)
		if err != nil {
			continue
		}

		major := int(v.Major())
		minor := int(v.Minor())

		// Generate expected package name
		expectedName := GeneratePackageName(packageNameTemplate, familyName, major, minor)

		// Check if the actual package name matches the expected name
		if pkg.Name == expectedName {
			familyPackages = append(familyPackages, pkg)
		}
	}

	return familyPackages
}
