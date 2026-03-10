package security

import (
	"context"
	_ "embed"
	"strings"
	"testing"

	"github.com/anchore/syft/syft/format/syftjson"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

//go:embed test-data/everything-sbom.json
var everythingSBOM string

//go:embed test-data/everything-cves.json
var everythingCVEs string

func TestCorrelateVulnerabilityToPackage(t *testing.T) {
	ctx := context.Background()

	// Parse SBOM using official Syft decoder
	decoder := syftjson.NewFormatDecoder()
	sbomData, _, _, err := decoder.Decode(strings.NewReader(everythingSBOM))
	require.NoError(t, err, "failed to parse test SBOM")

	tests := []struct {
		name                 string
		cveMatch             CVEPackageFix
		expectedPackageNames []string
	}{
		// APK package tests - redis-8.0
		{
			name: "redis-8.0 APK package (CVE-2025-46817)",
			cveMatch: CVEPackageFix{
				CVEID:            "CVE-2025-46817",
				ArtifactName:     "redis-8.0",
				ArtifactVersion:  "8.0.3-r4",
				ArtifactType:     "apk",
				ArtifactLanguage: "",
				PackageName:      "redis-8.0",
				PackageVersion:   "8.0.3-r4",
			},
			expectedPackageNames: []string{"redis-8.0"},
		},
		{
			name: "redis-8.0 APK package (CVE-2025-49844)",
			cveMatch: CVEPackageFix{
				CVEID:            "CVE-2025-49844",
				ArtifactName:     "redis-8.0",
				ArtifactVersion:  "8.0.3-r4",
				ArtifactType:     "apk",
				ArtifactLanguage: "",
				PackageName:      "redis-8.0",
				PackageVersion:   "8.0.3-r4",
			},
			expectedPackageNames: []string{"redis-8.0"},
		},

		// APK package test - python-3.12
		{
			name: "python-3.12 APK package (CVE-2025-6075)",
			cveMatch: CVEPackageFix{
				CVEID:            "CVE-2025-6075",
				ArtifactName:     "python-3.12",
				ArtifactVersion:  "3.12.12-r8",
				ArtifactType:     "apk",
				ArtifactLanguage: "",
				PackageName:      "python-3.12",
				PackageVersion:   "3.12.12-r8",
			},
			expectedPackageNames: []string{"python-3.12"},
		},

		// Ruby gem test - rexml -> ruby-3.3
		{
			name: "rexml gem maps to ruby-3.3 package (GHSA-c2f4-jgmc-q2r5)",
			cveMatch: CVEPackageFix{
				CVEID:            "GHSA-c2f4-jgmc-q2r5",
				ArtifactName:     "rexml",
				ArtifactVersion:  "3.3.9",
				ArtifactType:     "gem",
				ArtifactLanguage: "ruby",
				PackageName:      "rexml",
				PackageVersion:   "3.3.9",
			},
			expectedPackageNames: []string{"ruby-3.3"},
		},

		// Go module tests - golang.org/x/crypto
		{
			name: "golang.org/x/crypto v0.41.0 in helm maps to helm-3.19 (GHSA-j5w8-q4qc-rx2x)",
			cveMatch: CVEPackageFix{
				CVEID:            "GHSA-j5w8-q4qc-rx2x",
				ArtifactName:     "golang.org/x/crypto",
				ArtifactVersion:  "v0.41.0",
				ArtifactType:     "go-module",
				ArtifactLanguage: "go",
				PackageName:      "golang.org/x/crypto",
				PackageVersion:   "v0.41.0",
			},
			expectedPackageNames: []string{"helm-3.19"},
		},
		{
			name: "golang.org/x/crypto v0.45.0 in kots and kotsadm maps to both packages (GHSA-j5w8-q4qc-rx2x)",
			cveMatch: CVEPackageFix{
				CVEID:            "GHSA-j5w8-q4qc-rx2x",
				ArtifactName:     "golang.org/x/crypto",
				ArtifactVersion:  "v0.45.0",
				ArtifactType:     "go-module",
				ArtifactLanguage: "go",
				PackageName:      "golang.org/x/crypto",
				PackageVersion:   "v0.45.0",
			},
			expectedPackageNames: []string{"kots-cli-1.128", "kotsadm-1.128"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Run correlation - returns multiple results
			results, err := CorrelateVulnerabilityToPackage(ctx, tt.cveMatch, sbomData)

			require.NoError(t, err, "correlation should succeed")
			require.Len(t, results, len(tt.expectedPackageNames), "should return expected number of packages")

			// Extract package names from results
			var actualPackageNames []string
			for _, result := range results {
				actualPackageNames = append(actualPackageNames, result.PackageName)
			}

			// Verify all expected package names are present (order doesn't matter)
			assert.ElementsMatch(t, tt.expectedPackageNames, actualPackageNames, "PackageName list mismatch")

			// Verify artifact fields are preserved in all results
			for _, result := range results {
				assert.Equal(t, tt.cveMatch.ArtifactName, result.ArtifactName, "ArtifactName should be preserved")
				assert.Equal(t, tt.cveMatch.ArtifactType, result.ArtifactType, "ArtifactType should be preserved")
				assert.Equal(t, tt.cveMatch.ArtifactLanguage, result.ArtifactLanguage, "ArtifactLanguage should be preserved")
			}
		})
	}
}
