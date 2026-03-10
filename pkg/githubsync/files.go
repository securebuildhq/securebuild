package githubsync

import (
	"fmt"
	"regexp"
	"strings"
)

// getPrefix returns the two-character prefix for organizing files
// For names shorter than 2 characters, returns the full name
func getPrefix(name string) string {
	name = strings.ToLower(name)
	if len(name) < 2 {
		return name
	}
	return name[:2]
}

// sanitizeName ensures names are safe for the filesystem
// Preserves alphanumeric, dash, underscore, dot, and plus characters
func sanitizeName(name string) string {
	// Remove any path traversal attempts
	name = strings.ReplaceAll(name, "..", "")
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, "\\", "_")

	reg := regexp.MustCompile(`[^a-zA-Z0-9_.\-+]`)
	name = reg.ReplaceAllString(name, "_")

	return name
}

// getVersion returns the version string without revision suffix, suitable for file paths
// Examples: "1.0.8-r1" -> "1.0.8", "v15.2.3" -> "15.2.3", "0.0_git20250305" -> "0.0_git20250305"
func getVersion(version string) string {
	// Remove 'v' prefix if present
	version = strings.TrimPrefix(version, "v")

	// Strip revision suffix (-r1, -r2, etc.) if present
	// This allows epoch-based overwrites to work with the same file path
	if idx := strings.LastIndex(version, "-r"); idx != -1 {
		// Check if everything after -r is numeric
		remainder := version[idx+2:]
		isRevision := true
		for _, c := range remainder {
			if c < '0' || c > '9' {
				isRevision = false
				break
			}
		}
		if isRevision && len(remainder) > 0 {
			version = version[:idx]
		}
	}

	return version
}

// generatePackageFile creates a FileEntry for a package melange.yaml file
// The file is stored at the path: packages/<prefix>/<package-name>/<version>/melange.yaml
func generatePackageFile(pv PackageVersion) (FileEntry, error) {
	// Get full version for file path
	version := getVersion(pv.Version)
	safeVersion := sanitizeName(version)
	safeFamilyName := sanitizeName(pv.FamilyName)

	if safeFamilyName == "" {
		return FileEntry{}, fmt.Errorf("family name becomes empty after sanitization: %s", pv.FamilyName)
	}

	twoCharPrefix := getPrefix(safeFamilyName)
	singlePrefix := twoCharPrefix[:1]

	path := fmt.Sprintf("packages/%s/%s/%s/%s/melange.yaml",
		singlePrefix, twoCharPrefix, safeFamilyName, safeVersion)

	return FileEntry{
		Path:    path,
		Content: pv.MelangeYaml,
	}, nil
}

// generatePackageAdditionalFile creates a FileEntry for a package additional
// file (patch, config, etc.)
// The file is stored at the path: packages/<prefix>/<package-name>/<version>/<filename>
func generatePackageAdditionalFile(pv PackageVersion, filename, content string) (FileEntry, error) {
	safeFamilyName := sanitizeName(pv.FamilyName)
	safeVersion := sanitizeName(pv.Version)

	if safeFamilyName == "" {
		return FileEntry{}, fmt.Errorf("package name becomes empty after sanitization: %s", pv.FamilyName)
	}

	twoCharPrefix := getPrefix(safeFamilyName)
	singlePrefix := twoCharPrefix[:1]

	path := fmt.Sprintf("packages/%s/%s/%s/%s/%s",
		singlePrefix, twoCharPrefix, safeFamilyName, safeVersion, filename)

	return FileEntry{
		Path:    path,
		Content: content,
	}, nil
}

// generateImageFile creates FileEntry objects for an image APKO file and optionally its test file
// Returns APKO file entry and test file entry (nil if no test YAML exists)
func generateImageFile(iav ImageAPKOVersion) (apkoFile FileEntry, testFile *FileEntry, err error) {
	safeImageName := sanitizeName(iav.ImageName)
	safeTag := sanitizeName(iav.Tag)

	// OCI tags cannot include plus signs
	safeTag = strings.ReplaceAll(safeTag, "+", "_")

	if safeImageName == "" {
		return FileEntry{}, nil, fmt.Errorf("image name becomes empty after sanitization: %s", iav.ImageName)
	}

	twoCharPrefix := getPrefix(safeImageName)
	singlePrefix := twoCharPrefix[:1]

	// Generate APKO file entry
	apkoPath := fmt.Sprintf("images/%s/%s/%s/%s.apko.yaml",
		singlePrefix, twoCharPrefix, safeImageName, safeTag)

	apkoFile = FileEntry{
		Path:    apkoPath,
		Content: iav.APKOYAML,
	}

	// Generate test file entry if test YAML exists
	if iav.TestYAML != "" {
		testPath := fmt.Sprintf("images/%s/%s/%s/%s.apko.test.yaml",
			singlePrefix, twoCharPrefix, safeImageName, safeTag)

		testFile = &FileEntry{
			Path:    testPath,
			Content: iav.TestYAML,
		}
	}

	return apkoFile, testFile, nil
}
