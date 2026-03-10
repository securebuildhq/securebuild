package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/securebuildhq/securebuild/pkg/sbom"
)

// generateSBOM generates an SBOM for the given image using the existing SBOM functionality
func generateSBOM(ctx context.Context, imageInfo *ImageInfo, outputDir string) (*SBOMData, error) {
	fmt.Printf("  Generating SBOM for %s/%s@%s\n", imageInfo.Registry, imageInfo.Repository, imageInfo.Digest)

	// Use the existing SBOM functionality from pkg/sbom
	sboms, err := sbom.FetchSBOM(ctx, imageInfo.Registry, imageInfo.Repository, imageInfo.Digest)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch SBOM: %w", err)
	}

	if len(sboms) == 0 {
		return nil, fmt.Errorf("no SBOM found for image")
	}
	sbomContent := sboms[0].SBOM

	fmt.Printf("  Found SBOM from source: %s\n", sboms[0].Source)

	// Parse the SBOM content to extract packages
	packages, err := parseSBOMContent(sbomContent)
	if err != nil {
		return nil, fmt.Errorf("failed to parse SBOM content: %w", err)
	}

	fmt.Printf("  Extracted %d packages from SBOM\n", len(packages))

	// Save SBOM to file
	sbomDir := filepath.Join(outputDir, "sbom")
	if err := os.MkdirAll(sbomDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create sbom directory: %w", err)
	}

	sbomFile := filepath.Join(sbomDir, "sbom.json")
	if err := os.WriteFile(sbomFile, []byte(sbomContent), 0644); err != nil {
		return nil, fmt.Errorf("failed to write SBOM file: %w", err)
	}

	return &SBOMData{
		Raw:      sbomContent,
		Packages: packages,
	}, nil
}

// parseSBOMContent parses SBOM content and extracts package information
func parseSBOMContent(sbomContent string) ([]SBOMPackage, error) {
	var packages []SBOMPackage

	// Try to parse as SPDX JSON format first
	var spdxDoc map[string]interface{}
	if err := json.Unmarshal([]byte(sbomContent), &spdxDoc); err != nil {
		return nil, fmt.Errorf("failed to parse SBOM as JSON: %w", err)
	}

	// Check if it's an SPDX document
	if spdxVersion, ok := spdxDoc["spdxVersion"]; ok {
		fmt.Printf("  Detected SPDX SBOM version: %v\n", spdxVersion)
		return parseSPDXPackages(spdxDoc)
	}

	// Check if it's a CycloneDX document
	if bomFormat, ok := spdxDoc["bomFormat"]; ok {
		fmt.Printf("  Detected CycloneDX SBOM format: %v\n", bomFormat)
		return parseCycloneDXPackages(spdxDoc)
	}

	// Check if it's a Syft document
	if artifacts, ok := spdxDoc["artifacts"]; ok {
		fmt.Printf("  Detected Syft SBOM format\n")
		return parseSyftPackages(artifacts)
	}

	return packages, nil
}

// parseSPDXPackages parses packages from SPDX format SBOM
func parseSPDXPackages(spdxDoc map[string]interface{}) ([]SBOMPackage, error) {
	var packages []SBOMPackage

	if packagesList, ok := spdxDoc["packages"].([]interface{}); ok {
		for _, pkg := range packagesList {
			if pkgMap, ok := pkg.(map[string]interface{}); ok {
				name := getStringValue(pkgMap, "name")
				version := getStringValue(pkgMap, "versionInfo")

				// Skip if name is empty or looks like a file path
				if name == "" || strings.Contains(name, "/") {
					continue
				}

				// Determine package type based on name or other attributes
				pkgType := determinePackageType(name, pkgMap)

				if version == "" {
					version = "unknown"
				}

				packages = append(packages, SBOMPackage{
					Name:    name,
					Version: version,
					Type:    pkgType,
				})
			}
		}
	}

	return packages, nil
}

// parseCycloneDXPackages parses packages from CycloneDX format SBOM
func parseCycloneDXPackages(cycloneDXDoc map[string]interface{}) ([]SBOMPackage, error) {
	var packages []SBOMPackage

	if components, ok := cycloneDXDoc["components"].([]interface{}); ok {
		for _, comp := range components {
			if compMap, ok := comp.(map[string]interface{}); ok {
				name := getStringValue(compMap, "name")
				version := getStringValue(compMap, "version")
				pkgType := getStringValue(compMap, "type")

				if name == "" {
					continue
				}

				if version == "" {
					version = "unknown"
				}

				if pkgType == "" {
					pkgType = "library"
				}

				packages = append(packages, SBOMPackage{
					Name:    name,
					Version: version,
					Type:    pkgType,
				})
			}
		}
	}

	return packages, nil
}

// parseSyftPackages parses packages from Syft format SBOM
func parseSyftPackages(artifacts interface{}) ([]SBOMPackage, error) {
	var packages []SBOMPackage

	if artifactsList, ok := artifacts.([]interface{}); ok {
		for _, artifact := range artifactsList {
			if artifactMap, ok := artifact.(map[string]interface{}); ok {
				name := getStringValue(artifactMap, "name")
				version := getStringValue(artifactMap, "version")
				pkgType := getStringValue(artifactMap, "type")

				if name == "" {
					continue
				}

				if version == "" {
					version = "unknown"
				}

				if pkgType == "" {
					pkgType = "library"
				}

				packages = append(packages, SBOMPackage{
					Name:    name,
					Version: version,
					Type:    pkgType,
				})
			}
		}
	}

	return packages, nil
}

// getStringValue safely extracts a string value from a map
func getStringValue(m map[string]interface{}, key string) string {
	if value, ok := m[key]; ok {
		if str, ok := value.(string); ok {
			return str
		}
	}
	return ""
}

// determinePackageType determines the package type based on name and attributes
func determinePackageType(name string, pkgMap map[string]interface{}) string {
	// Check for common package manager indicators
	if strings.Contains(name, "apk:") || strings.Contains(name, ".apk") {
		return "apk"
	}

	if strings.Contains(name, "deb:") || strings.Contains(name, ".deb") {
		return "deb"
	}

	if strings.Contains(name, "rpm:") || strings.Contains(name, ".rpm") {
		return "rpm"
	}

	if strings.Contains(name, "npm:") || strings.Contains(name, "node_modules") {
		return "npm"
	}

	if strings.Contains(name, "pip:") || strings.Contains(name, "python") {
		return "python"
	}

	if strings.Contains(name, "go:") || strings.Contains(name, "golang") {
		return "go"
	}

	// Check for downloadLocation or other attributes
	if downloadLocation, ok := pkgMap["downloadLocation"].(string); ok {
		if strings.Contains(downloadLocation, "pypi.org") {
			return "python"
		}
		if strings.Contains(downloadLocation, "npmjs.com") {
			return "npm"
		}
		if strings.Contains(downloadLocation, "golang.org") {
			return "go"
		}
	}

	// Default to library
	return "library"
}

// filterSBOM filters the SBOM to only include packages that are truly needed for a minimal image
func filterSBOM(ctx context.Context, sbomData *SBOMData, imageInfo *ImageInfo, outputDir string) (*FilteredSBOM, error) {
	fmt.Println("  Filtering SBOM to minimal requirements...")

	var filteredPackages []SBOMPackage

	// Essential packages that are almost always needed
	essentialPackages := map[string]bool{
		"ca-certificates":        true,
		"ca-certificates-bundle": true,
		"tzdata":                 true,
		"musl":                   true,
		"libc":                   true,
		"libc6":                  true,
		"glibc":                  true,
		"libssl":                 true,
		"openssl":                true,
		"zlib":                   true,
		"libz":                   true,
	}

	// Filter packages based on various criteria
	for _, pkg := range sbomData.Packages {
		shouldInclude := false

		// Always include essential packages
		if essentialPackages[pkg.Name] {
			shouldInclude = true
		}

		// Include packages that might be needed based on entrypoint/cmd
		if shouldInclude || isNeededForEntrypoint(pkg, imageInfo) {
			shouldInclude = true
		}

		// Include packages that are runtime dependencies
		if shouldInclude || isRuntimeDependency(pkg) {
			shouldInclude = true
		}

		// Exclude development/build-time packages
		if shouldInclude && !isDevelopmentPackage(pkg) {
			filteredPackages = append(filteredPackages, pkg)
		}
	}

	filteredSBOM := &FilteredSBOM{
		Packages: filteredPackages,
	}

	fmt.Printf("  Filtered from %d to %d packages\n", len(sbomData.Packages), len(filteredPackages))

	// Save filtered SBOM to file
	filteredSBOMFile := filepath.Join(outputDir, "sbom", "filtered-sbom.json")
	filteredSBOMJSON, err := json.MarshalIndent(filteredSBOM, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal filtered SBOM: %w", err)
	}

	if err := os.WriteFile(filteredSBOMFile, filteredSBOMJSON, 0644); err != nil {
		return nil, fmt.Errorf("failed to write filtered SBOM file: %w", err)
	}

	return filteredSBOM, nil
}

// isNeededForEntrypoint checks if a package is needed based on the image's entrypoint/cmd
func isNeededForEntrypoint(pkg SBOMPackage, imageInfo *ImageInfo) bool {
	// Check if the package name appears in entrypoint or cmd
	for _, entry := range imageInfo.Entrypoint {
		if strings.Contains(entry, pkg.Name) {
			return true
		}
	}

	for _, cmd := range imageInfo.Cmd {
		if strings.Contains(cmd, pkg.Name) {
			return true
		}
	}

	// Check for common runtime dependencies based on entrypoint
	if len(imageInfo.Entrypoint) > 0 {
		entrypoint := strings.Join(imageInfo.Entrypoint, " ")

		// Python applications
		if strings.Contains(entrypoint, "python") {
			if strings.Contains(pkg.Name, "python") || pkg.Type == "python" {
				return true
			}
		}

		// Node.js applications
		if strings.Contains(entrypoint, "node") || strings.Contains(entrypoint, "npm") {
			if strings.Contains(pkg.Name, "node") || pkg.Type == "npm" {
				return true
			}
		}

		// Go applications
		if strings.Contains(entrypoint, "go") {
			if strings.Contains(pkg.Name, "go") || pkg.Type == "go" {
				return true
			}
		}

		// Java applications
		if strings.Contains(entrypoint, "java") || strings.Contains(entrypoint, "jar") {
			if strings.Contains(pkg.Name, "java") || strings.Contains(pkg.Name, "jdk") || strings.Contains(pkg.Name, "jre") {
				return true
			}
		}
	}

	return false
}

// isRuntimeDependency checks if a package is a runtime dependency
func isRuntimeDependency(pkg SBOMPackage) bool {
	runtimePackages := map[string]bool{
		"bash":      true,
		"sh":        true,
		"dash":      true,
		"busybox":   true,
		"coreutils": true,
		"findutils": true,
		"grep":      true,
		"sed":       true,
		"awk":       true,
		"curl":      true,
		"wget":      true,
	}

	return runtimePackages[pkg.Name]
}

// isDevelopmentPackage checks if a package is a development/build-time package
func isDevelopmentPackage(pkg SBOMPackage) bool {
	devPackages := []string{
		"gcc", "g++", "clang", "make", "cmake", "autoconf", "automake",
		"libtool", "pkg-config", "build-essential", "dev", "devel",
		"headers", "static", "doc", "docs", "man", "info",
	}

	name := strings.ToLower(pkg.Name)
	for _, devPkg := range devPackages {
		if strings.Contains(name, devPkg) {
			return true
		}
	}

	return false
}
