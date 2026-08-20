package package_family

import (
	"regexp"
	"testing"
)

func TestIdentifyFamilyPackages(t *testing.T) {
	tests := []struct {
		name                string
		packages            []Package
		familyName          string
		packageNameTemplate string
		versionPattern      string
		expected            []Package
	}{
		{
			name: "git family with matching packages",
			packages: []Package{
				{ID: "1", Name: "git-2.50", Version: "2.50.0"},
				{ID: "2", Name: "git-2.49", Version: "2.49.1"},
				{ID: "3", Name: "git-2.48", Version: "2.48.2"},
			},
			familyName:          "git",
			packageNameTemplate: "{name}-{major}.{minor}",
			versionPattern:      `^(\d+)\.(\d+)\.(\d+)$`,
			expected: []Package{
				{ID: "1", Name: "git-2.50", Version: "2.50.0"},
				{ID: "2", Name: "git-2.49", Version: "2.49.1"},
				{ID: "3", Name: "git-2.48", Version: "2.48.2"},
			},
		},
		{
			name: "mixed packages with non-matching names",
			packages: []Package{
				{ID: "1", Name: "git-2.50", Version: "2.50.0"},
				{ID: "2", Name: "git-custom", Version: "2.49.1"},
				{ID: "3", Name: "git-2.48", Version: "2.48.2"},
			},
			familyName:          "git",
			packageNameTemplate: "{name}-{major}.{minor}",
			versionPattern:      `^(\d+)\.(\d+)\.(\d+)$`,
			expected: []Package{
				{ID: "1", Name: "git-2.50", Version: "2.50.0"},
				{ID: "3", Name: "git-2.48", Version: "2.48.2"},
			},
		},
		{
			name: "invalid version format",
			packages: []Package{
				{ID: "1", Name: "git-2.50", Version: "invalid"},
				{ID: "2", Name: "git-2.49", Version: "2.49.1"},
			},
			familyName:          "git",
			packageNameTemplate: "{name}-{major}.{minor}",
			versionPattern:      `^(\d+)\.(\d+)\.(\d+)$`,
			expected: []Package{
				{ID: "2", Name: "git-2.49", Version: "2.49.1"},
			},
		},
		{
			name:                "empty packages list",
			packages:            []Package{},
			familyName:          "git",
			packageNameTemplate: "{name}-{major}.{minor}",
			versionPattern:      `^(\d+)\.(\d+)\.(\d+)$`,
			expected:            []Package{},
		},
		{
			name: "different template format",
			packages: []Package{
				{ID: "1", Name: "node-20", Version: "20.10.0"},
				{ID: "2", Name: "node-19", Version: "19.5.0"},
				{ID: "3", Name: "node-18", Version: "18.12.0"},
			},
			familyName:          "node",
			packageNameTemplate: "{name}-{major}",
			versionPattern:      `^(\d+)\.(\d+)\.(\d+)$`,
			expected: []Package{
				{ID: "1", Name: "node-20", Version: "20.10.0"},
				{ID: "2", Name: "node-19", Version: "19.5.0"},
				{ID: "3", Name: "node-18", Version: "18.12.0"},
			},
		},
		{
			name: "package name doesn't match expected pattern",
			packages: []Package{
				{ID: "1", Name: "git-2.50", Version: "2.50.0"},
				{ID: "2", Name: "git-2.49.1", Version: "2.49.1"}, // Wrong format
			},
			familyName:          "git",
			packageNameTemplate: "{name}-{major}.{minor}",
			versionPattern:      `^(\d+)\.(\d+)\.(\d+)$`,
			expected: []Package{
				{ID: "1", Name: "git-2.50", Version: "2.50.0"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IdentifyFamilyPackages(tt.packages, tt.familyName, tt.packageNameTemplate, tt.versionPattern)

			if len(result) != len(tt.expected) {
				t.Errorf("Expected %d packages, got %d", len(tt.expected), len(result))
				return
			}

			// Convert to maps for easier comparison
			resultMap := make(map[string]Package)
			for _, pkg := range result {
				resultMap[pkg.ID] = pkg
			}

			expectedMap := make(map[string]Package)
			for _, pkg := range tt.expected {
				expectedMap[pkg.ID] = pkg
			}

			// Check if all expected packages are in result
			for id, expectedPkg := range expectedMap {
				resultPkg, ok := resultMap[id]
				if !ok {
					t.Errorf("Expected package %s not found in result", id)
					continue
				}
				if resultPkg.Name != expectedPkg.Name || resultPkg.Version != expectedPkg.Version {
					t.Errorf("Package mismatch for ID %s: expected %+v, got %+v", id, expectedPkg, resultPkg)
				}
			}
		})
	}
}

func TestGeneratePackageNamePattern(t *testing.T) {
	tests := []struct {
		name       string
		template   string
		familyName string
		matches    []string
		rejects    []string
	}{
		{
			name:       "default template",
			template:   "{name}-{major}.{minor}",
			familyName: "go",
			matches:    []string{"go-1.24"},
			rejects:    []string{"go-1x24", "go-boring-1.24"},
		},
		{
			name:       "literal plus",
			template:   "lib{name}_{major}+compat",
			familyName: "ssl",
			matches:    []string{"libssl_3+compat"},
			rejects:    []string{"libssl_33compat", "libssl_3compat"},
		},
		{
			name:       "regex characters in family name",
			template:   "{name}-{major}",
			familyName: "lib.foo+bar",
			matches:    []string{"lib.foo+bar-2"},
			rejects:    []string{"libXfooobar-2"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pattern := regexp.MustCompile(GeneratePackageNamePattern(tt.template, tt.familyName))
			for _, value := range tt.matches {
				if !pattern.MatchString(value) {
					t.Errorf("pattern %q did not match %q", pattern, value)
				}
			}
			for _, value := range tt.rejects {
				if pattern.MatchString(value) {
					t.Errorf("pattern %q unexpectedly matched %q", pattern, value)
				}
			}
		})
	}
}
