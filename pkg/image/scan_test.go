package image

import (
	_ "embed"
	"testing"

	"github.com/securebuildhq/securebuild/pkg/image/types"
)

//go:embed testdata/grype-scan-raw.json
var grypeScanRaw string

// $ grype registry.replicated.com/library/replicated-sdk-image:1.8.0
// ✔ Loaded image                                                                                                                                                        registry.replicated.com/library/replicated-sdk-image:1.8.0
// ✔ Parsed image                                                                                                                                           sha256:2f2dbfb250fdf972713279eca8901460168d853f826d194b5ee16bfdcec58a15
// ✔ Cataloged contents                                                                                                                                            b9a8b9399a1c7d5141a1738b1404485f182a6a514237f057432a2f2c9c267759
//   ├── ✔ Packages                        [168 packages]
//   ├── ✔ Executables                     [106 executables]
//   ├── ✔ File metadata                   [512 locations]
//   └── ✔ File digests                    [512 files]
// ✘ Scan for vulnerabilities        [8 vulnerability matches]
//   ├── by severity: 0 critical, 1 high, 3 medium, 2 low, 0 negligible (2 unknown)
//   └── by status:   6 fixed, 2 not-fixed, 0 ignored
// NAME             INSTALLED   FIXED IN    TYPE       VULNERABILITY        SEVERITY  EPSS %  RISK
// curl             8.15.0-r4               apk        CVE-2025-9086        High      22.32   < 0.1
// curl             8.15.0-r4               apk        CVE-2025-10148       Medium    8.26    < 0.1
// helm.sh/helm/v3  v3.18.4     3.18.5      go-module  GHSA-f9f8-9pmf-xv68  Medium    2.73    < 0.1
// helm.sh/helm/v3  v3.18.4     3.18.5      go-module  GHSA-9h84-qmv7-982p  Medium    1.48    < 0.1
// busybox          1.37.0-r48  1.37.0-r49  apk        CVE-2024-58251       Low       1.99    < 0.1
// busybox          1.37.0-r48  1.37.0-r50  apk        CVE-2025-46394       Low       0.95    < 0.1
// busybox          1.37.0-r48  1.37.0-r49  apk        GHSA-rrv5-483w-xmr9  Unknown   N/A     N/A
// busybox          1.37.0-r48  1.37.0-r50  apk        GHSA-wp4q-9jq4-gv74  Unknown   N/A     N/A

func TestParseScanResultDetails(t *testing.T) {
	// Parse the scan result
	result, err := ParseScanResultDetails(grypeScanRaw)
	if err != nil {
		t.Fatalf("ParseScanResultDetails failed: %v", err)
	}

	// Verify counts
	expectedCounts := types.ImageScanResult{
		CriticalCount: 0,
		HighCount:     1,
		MediumCount:   3,
		LowCount:      2,
		TotalCount:    6,
	}

	if result.Counts != expectedCounts {
		t.Errorf("Counts mismatch:\nExpected: %+v\nGot: %+v", expectedCounts, result.Counts)
	}

	// Verify fixed counts
	expectedFixedCounts := types.ImageScanResult{
		CriticalCount: 0,
		HighCount:     0,
		MediumCount:   2,
		LowCount:      2,
		TotalCount:    4,
	}

	if result.FixedCounts != expectedFixedCounts {
		t.Errorf("Fixed counts mismatch:\nExpected: %+v\nGot: %+v", expectedFixedCounts, result.FixedCounts)
	}

	// Verify Critical vulnerabilities
	if len(result.Critical) != 0 {
		t.Errorf("Expected 0 critical vulnerabilities, got %d", len(result.Critical))
	}

	// Verify High vulnerabilities
	if len(result.High) != 1 {
		t.Errorf("Expected 1 high vulnerability, got %d", len(result.High))
	}
	if _, exists := result.High["CVE-2025-9086"]; !exists {
		t.Error("Expected CVE-2025-9086 in high vulnerabilities")
	}

	// Verify Medium vulnerabilities
	if len(result.Medium) != 3 {
		t.Errorf("Expected 3 medium vulnerabilities, got %d", len(result.Medium))
	}
	expectedMedium := []string{"CVE-2025-10148", "GHSA-f9f8-9pmf-xv68", "GHSA-9h84-qmv7-982p"}
	for _, cve := range expectedMedium {
		if _, exists := result.Medium[cve]; !exists {
			t.Errorf("Expected %s in medium vulnerabilities", cve)
		}
	}

	// Verify Low vulnerabilities
	if len(result.Low) != 2 {
		t.Errorf("Expected 2 low vulnerabilities, got %d", len(result.Low))
	}
	expectedLow := []string{"CVE-2024-58251", "CVE-2025-46394"}
	for _, cve := range expectedLow {
		if _, exists := result.Low[cve]; !exists {
			t.Errorf("Expected %s in low vulnerabilities", cve)
		}
	}

	// Verify vulnerability details
	if len(result.VulnerabilityDetails) != expectedCounts.TotalCount {
		t.Errorf("Expected %d vulnerability details, got %d", expectedCounts.TotalCount, len(result.VulnerabilityDetails))
	}

	// Verify specific vulnerability details
	var cve20259086 *types.VulnerabilityDetail
	for i, detail := range result.VulnerabilityDetails {
		if detail.CVE == "CVE-2025-9086" {
			cve20259086 = &result.VulnerabilityDetails[i]
			break
		}
	}

	if cve20259086 == nil {
		t.Fatal("CVE-2025-9086 not found in vulnerability details")
	}

	if cve20259086.Severity != "high" {
		t.Errorf("Expected severity 'high' for CVE-2025-9086, got '%s'", cve20259086.Severity)
	}
	if cve20259086.ArtifactID != "74da3d01e579a493" {
		t.Errorf("Expected artifact ID '74da3d01e579a493' for CVE-2025-9086, got '%s'", cve20259086.ArtifactID)
	}
	if cve20259086.ArtifactName != "curl" {
		t.Errorf("Expected artifact name 'curl' for CVE-2025-9086, got '%s'", cve20259086.ArtifactName)
	}
	if cve20259086.ArtifactVersion != "8.15.0-r4" {
		t.Errorf("Expected artifact version '8.15.0-r4' for CVE-2025-9086, got '%s'", cve20259086.ArtifactVersion)
	}
	if cve20259086.ArtifactPath != "/usr/lib/apk/db/installed" {
		t.Errorf("Expected artifact path '/usr/lib/apk/db/installed' for CVE-2025-9086, got '%s'", cve20259086.ArtifactPath)
	}
	if cve20259086.ArtifactType != "apk" {
		t.Errorf("Expected artifact type 'apk' for CVE-2025-9086, got '%s'", cve20259086.ArtifactType)
	}
	if cve20259086.FixState != "unknown" {
		t.Errorf("Expected fix state 'unknown' for CVE-2025-9086, got '%s'", cve20259086.FixState)
	}

	// Verify a fixed vulnerability
	var ghsaf9f8 *types.VulnerabilityDetail
	for i, detail := range result.VulnerabilityDetails {
		if detail.CVE == "GHSA-f9f8-9pmf-xv68" {
			ghsaf9f8 = &result.VulnerabilityDetails[i]
			break
		}
	}

	if ghsaf9f8 == nil {
		t.Fatal("GHSA-f9f8-9pmf-xv68 not found in vulnerability details")
	}

	if ghsaf9f8.FixState != "fixed" {
		t.Errorf("Expected fix state 'fixed' for GHSA-f9f8-9pmf-xv68, got '%s'", ghsaf9f8.FixState)
	}
	if len(ghsaf9f8.FixVersions) != 1 || ghsaf9f8.FixVersions[0] != "3.18.5" {
		t.Errorf("Expected fix version '3.18.5' for GHSA-f9f8-9pmf-xv68, got %v", ghsaf9f8.FixVersions)
	}

	// Verify CVE-2024-58251 has description from related vulnerability
	// This CVE has no description in the main vulnerability object, but has one in relatedVulnerabilities
	var cve202458251 *types.VulnerabilityDetail
	for i, detail := range result.VulnerabilityDetails {
		if detail.CVE == "CVE-2024-58251" {
			cve202458251 = &result.VulnerabilityDetails[i]
			break
		}
	}

	if cve202458251 == nil {
		t.Fatal("CVE-2024-58251 not found in vulnerability details")
	}

	expectedDescription := "In netstat in BusyBox through 1.37.0, local users can launch of network application with an argv[0] containing an ANSI terminal escape sequence, leading to a denial of service (terminal locked up) when netstat is used by a victim."
	if cve202458251.Description != expectedDescription {
		t.Errorf("Expected CVE-2024-58251 description to be set from related vulnerability.\nExpected: %s\nGot: %s", expectedDescription, cve202458251.Description)
	}

	if cve202458251.Description == "" {
		t.Error("CVE-2024-58251 should have a description from related vulnerability, but got empty string")
	}

	// Verify descriptor
	if result.Descriptor.Name != "grype" {
		t.Errorf("Expected descriptor name 'grype', got '%s'", result.Descriptor.Name)
	}
	if result.Descriptor.Version != "0.95.0" {
		t.Errorf("Expected descriptor version '0.95.0', got '%s'", result.Descriptor.Version)
	}
}
