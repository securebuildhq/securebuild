package scanner

import (
	"context"
	"testing"
)

func TestMockCVEClient(t *testing.T) {
	client, err := NewMockCVEClient("testdata")
	if err != nil {
		t.Fatalf("NewMockCVEClient() error = %v", err)
	}

	ctx := context.Background()

	t.Run("query CVEs for openssl with fixable and unfixable", func(t *testing.T) {
		cves, err := client.QueryCVEs(ctx, "openssl", "3.2.1")
		if err != nil {
			t.Fatalf("QueryCVEs() error = %v", err)
		}

		if len(cves) != 2 {
			t.Errorf("QueryCVEs() returned %d CVEs, want 2", len(cves))
		}

		// Check fixable CVE
		fixable := false
		unfixable := false
		for _, cve := range cves {
			if cve.ID == "CVE-2024-1234" {
				fixable = true
				if cve.FixedVersion != "3.2.2" {
					t.Errorf("CVE-2024-1234 FixedVersion = %s, want 3.2.2", cve.FixedVersion)
				}
				if cve.Severity != "CRITICAL" {
					t.Errorf("CVE-2024-1234 Severity = %s, want CRITICAL", cve.Severity)
				}
			}
			if cve.ID == "CVE-2024-5678" {
				unfixable = true
				if cve.FixedVersion != "" {
					t.Errorf("CVE-2024-5678 should be unfixable (FixedVersion empty), got %s", cve.FixedVersion)
				}
			}
		}

		if !fixable {
			t.Error("Expected to find fixable CVE-2024-1234")
		}
		if !unfixable {
			t.Error("Expected to find unfixable CVE-2024-5678")
		}
	})

	t.Run("query CVEs for glibc", func(t *testing.T) {
		cves, err := client.QueryCVEs(ctx, "glibc", "2.41")
		if err != nil {
			t.Fatalf("QueryCVEs() error = %v", err)
		}

		if len(cves) != 2 {
			t.Errorf("QueryCVEs() returned %d CVEs, want 2", len(cves))
		}

		// Check that we have one fixable and one unfixable
		fixableCount := 0
		unfixableCount := 0
		for _, cve := range cves {
			if cve.FixedVersion != "" {
				fixableCount++
			} else {
				unfixableCount++
			}
		}

		if fixableCount != 1 {
			t.Errorf("Expected 1 fixable CVE, got %d", fixableCount)
		}
		if unfixableCount != 1 {
			t.Errorf("Expected 1 unfixable CVE, got %d", unfixableCount)
		}
	})

	t.Run("query CVEs for redis", func(t *testing.T) {
		cves, err := client.QueryCVEs(ctx, "redis", "8.0.3")
		if err != nil {
			t.Fatalf("QueryCVEs() error = %v", err)
		}

		if len(cves) != 1 {
			t.Errorf("QueryCVEs() returned %d CVEs, want 1", len(cves))
		}

		if cves[0].ID != "CVE-2024-7777" {
			t.Errorf("CVE ID = %s, want CVE-2024-7777", cves[0].ID)
		}
		if cves[0].FixedVersion != "8.0.4-r0" {
			t.Errorf("FixedVersion = %s, want 8.0.4-r0", cves[0].FixedVersion)
		}
	})

	t.Run("query CVEs for package with no vulnerabilities", func(t *testing.T) {
		cves, err := client.QueryCVEs(ctx, "curl", "8.5.0")
		if err != nil {
			t.Fatalf("QueryCVEs() error = %v", err)
		}

		if len(cves) != 0 {
			t.Errorf("QueryCVEs() returned %d CVEs, want 0 (clean package)", len(cves))
		}
	})

	t.Run("query CVEs for package not in fixtures", func(t *testing.T) {
		cves, err := client.QueryCVEs(ctx, "unknown-package", "1.0.0")
		if err != nil {
			t.Fatalf("QueryCVEs() error = %v", err)
		}

		if len(cves) != 0 {
			t.Errorf("QueryCVEs() returned %d CVEs, want 0 (not in fixtures)", len(cves))
		}
	})

	t.Run("resolve package mapping for known package", func(t *testing.T) {
		mapping, err := client.ResolvePackageMapping(ctx, "openssl")
		if err != nil {
			t.Fatalf("ResolvePackageMapping() error = %v", err)
		}

		if mapping.PackageName != "openssl" {
			t.Errorf("PackageName = %s, want openssl", mapping.PackageName)
		}
		if mapping.OSVEcosystem != "Alpine" {
			t.Errorf("OSVEcosystem = %s, want Alpine", mapping.OSVEcosystem)
		}
		if mapping.OSVPackageName != "openssl" {
			t.Errorf("OSVPackageName = %s, want openssl", mapping.OSVPackageName)
		}
	})

	t.Run("resolve package mapping for unknown package returns default", func(t *testing.T) {
		mapping, err := client.ResolvePackageMapping(ctx, "unknown-package")
		if err != nil {
			t.Fatalf("ResolvePackageMapping() error = %v", err)
		}

		// Should return default mapping
		if mapping.PackageName != "unknown-package" {
			t.Errorf("PackageName = %s, want unknown-package", mapping.PackageName)
		}
		if mapping.OSVEcosystem != "Alpine" {
			t.Errorf("OSVEcosystem = %s, want Alpine (default)", mapping.OSVEcosystem)
		}
	})
}

func TestMockCVEClient_FixtureScenarios(t *testing.T) {
	client, err := NewMockCVEClient("testdata")
	if err != nil {
		t.Fatalf("NewMockCVEClient() error = %v", err)
	}

	ctx := context.Background()

	scenarios := []struct {
		name             string
		packageName      string
		version          string
		expectedCVECount int
		expectFixable    bool
		expectUnfixable  bool
	}{
		{
			name:             "openssl has both fixable and unfixable",
			packageName:      "openssl",
			version:          "3.2.1",
			expectedCVECount: 2,
			expectFixable:    true,
			expectUnfixable:  true,
		},
		{
			name:             "glibc has both fixable and unfixable",
			packageName:      "glibc",
			version:          "2.41",
			expectedCVECount: 2,
			expectFixable:    true,
			expectUnfixable:  true,
		},
		{
			name:             "redis has only fixable",
			packageName:      "redis",
			version:          "8.0.3",
			expectedCVECount: 1,
			expectFixable:    true,
			expectUnfixable:  false,
		},
		{
			name:             "curl has no CVEs",
			packageName:      "curl",
			version:          "8.5.0",
			expectedCVECount: 0,
			expectFixable:    false,
			expectUnfixable:  false,
		},
	}

	for _, tt := range scenarios {
		t.Run(tt.name, func(t *testing.T) {
			cves, err := client.QueryCVEs(ctx, tt.packageName, tt.version)
			if err != nil {
				t.Fatalf("QueryCVEs() error = %v", err)
			}

			if len(cves) != tt.expectedCVECount {
				t.Errorf("QueryCVEs() returned %d CVEs, want %d", len(cves), tt.expectedCVECount)
			}

			hasFixable := false
			hasUnfixable := false
			for _, cve := range cves {
				if cve.FixedVersion != "" {
					hasFixable = true
				} else {
					hasUnfixable = true
				}
			}

			if hasFixable != tt.expectFixable {
				t.Errorf("hasFixable = %v, want %v", hasFixable, tt.expectFixable)
			}
			if hasUnfixable != tt.expectUnfixable {
				t.Errorf("hasUnfixable = %v, want %v", hasUnfixable, tt.expectUnfixable)
			}
		})
	}
}
