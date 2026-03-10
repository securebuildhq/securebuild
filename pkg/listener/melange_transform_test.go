package listener

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/go-github/v61/github"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/testutil"
)

func TestTransformMelangeYAMLForPatchVersion(t *testing.T) {
	tests := []struct {
		name               string
		inputYAML          string
		oldVersion         string
		newVersion         string
		epoch              int
		setupMockServer    func() (*httptest.Server, string, string) // returns server, newCommitSHA, expectedSHA256
		expectedContains   []string
		expectedNotContain []string
		wantErr            bool
	}{
		{
			name: "basic patch update with version and epoch",
			inputYAML: `package:
  name: git-2.51
  version: "2.51.0"
  epoch: 0
  description: Git distributed version control system
`,
			oldVersion: "2.51.0",
			newVersion: "2.51.1",
			epoch:      1,
			setupMockServer: func() (*httptest.Server, string, string) {
				return nil, "", ""
			},
			expectedContains: []string{
				`version: "2.51.1"`,
				`epoch: 1`,
			},
			expectedNotContain: []string{
				"2.51.0",
				"epoch: 0",
			},
			wantErr: false,
		},
		{
			name: "patch update preserves package name",
			inputYAML: `package:
  name: git-2.51
  version: "2.51.0"
  epoch: 0
`,
			oldVersion: "2.51.0",
			newVersion: "2.51.1",
			epoch:      1,
			setupMockServer: func() (*httptest.Server, string, string) {
				return nil, "", ""
			},
			expectedContains: []string{
				`name: git-2.51`, // Name should NOT change
				`version: "2.51.1"`,
			},
			expectedNotContain: []string{},
			wantErr:            false,
		},
		{
			name: "patch update with digest updates",
			inputYAML: `package:
  name: git-2.51
  version: "2.51.0"
  epoch: 0

pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/git/git
      tag: v2.51.0
      expected-commit: abc123456789012345678901234567890abcdef0

  - uses: fetch
    with:
      uri: https://example.com/git-${{package.version}}.tar.gz
      expected-sha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
`,
			oldVersion: "2.51.0",
			newVersion: "2.51.1",
			epoch:      2,
			setupMockServer: func() (*httptest.Server, string, string) {
				// Create test file server
				fileContent := []byte("git-2.51.1 tarball content")
				expectedSHA256 := sha256.Sum256(fileContent)
				expectedSHA256Hex := hex.EncodeToString(expectedSHA256[:])

				fileServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if strings.Contains(r.URL.Path, "git-2.51.1.tar.gz") {
						w.WriteHeader(http.StatusOK)
						w.Write(fileContent)
					} else {
						w.WriteHeader(http.StatusNotFound)
					}
				}))

				newCommitSHA := "def456789012345678901234567890abcdef1234"

				return fileServer, newCommitSHA, expectedSHA256Hex
			},
			expectedContains: []string{
				`version: "2.51.1"`,
				`epoch: 2`,
				// Note: tag field stays as v2.51.0 in template, gets evaluated at build time via ${{package.version}}
			},
			expectedNotContain: []string{
				"abc123456789012345678901234567890abcdef0", // Old commit should be replaced
			},
			wantErr: false,
		},
		{
			name: "patch update does not change tag-filter",
			inputYAML: `package:
  name: bash-5.2
  version: "5.2.37"
  epoch: 0

update:
  enabled: true
  github:
    identifier: bminor/bash
    use-tag: true
    tag-filter: ^5\.2\.
`,
			oldVersion: "5.2.37",
			newVersion: "5.2.38",
			epoch:      1,
			setupMockServer: func() (*httptest.Server, string, string) {
				return nil, "", ""
			},
			expectedContains: []string{
				`version: "5.2.38"`,
				`epoch: 1`,
				`tag-filter: ^5\.2\.`, // tag-filter should NOT change
			},
			expectedNotContain: []string{
				"5.2.37",
			},
			wantErr: false,
		},
		{
			name: "patch update with indented epoch",
			inputYAML: `package:
  name: test-package
  version: "1.0.0"
  epoch: 5
  description: Test package
`,
			oldVersion: "1.0.0",
			newVersion: "1.0.1",
			epoch:      6,
			setupMockServer: func() (*httptest.Server, string, string) {
				return nil, "", ""
			},
			expectedContains: []string{
				"  epoch: 6", // Preserve indentation
			},
			expectedNotContain: []string{},
			wantErr:            false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Initialize context with test params
			ctx, err := param.Init(param.InitSourceEnvironment, map[string]string{
				"PIPELINE_DIR": testutil.SetupTestPipelineDir(t),
			})
			if err != nil {
				t.Fatalf("Failed to initialize params: %v", err)
			}

			// Setup mock servers if needed
			var fileServer *httptest.Server
			var githubServer *httptest.Server
			var githubClient *github.Client
			var newCommitSHA, expectedSHA256Hex string

			if tt.setupMockServer != nil {
				fileServer, newCommitSHA, expectedSHA256Hex = tt.setupMockServer()
				if fileServer != nil {
					defer fileServer.Close()
				}
			}

			// Create GitHub mock server if we have a new commit SHA
			if newCommitSHA != "" {
				githubServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if strings.Contains(r.URL.Path, "/git/ref/tags/") {
						ref := github.Reference{
							Ref: github.String("refs/tags/v" + tt.newVersion),
							Object: &github.GitObject{
								Type: github.String("commit"),
								SHA:  github.String(newCommitSHA),
							},
						}
						w.Header().Set("Content-Type", "application/json")
						json.NewEncoder(w).Encode(ref)
					} else {
						w.WriteHeader(http.StatusNotFound)
					}
				}))
				defer githubServer.Close()

				githubClient = github.NewClient(nil)
				githubURL, _ := url.Parse(githubServer.URL + "/")
				githubClient.BaseURL = githubURL
				githubClient.UploadURL = githubURL
			} else {
				githubClient = github.NewClient(nil)
			}

			// Replace file server URL in input if needed
			inputYAML := tt.inputYAML
			if fileServer != nil {
				inputYAML = strings.ReplaceAll(inputYAML, "https://example.com", fileServer.URL)
			}

			// Execute transformation
			result, err := transformMelangeYAMLForPatchVersion(
				ctx,
				inputYAML,
				tt.oldVersion,
				tt.newVersion,
				tt.epoch,
				githubClient,
			)

			// Check error expectation
			if tt.wantErr {
				if err == nil {
					t.Errorf("transformMelangeYAMLForPatchVersion() expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("transformMelangeYAMLForPatchVersion() unexpected error: %v", err)
			}

			// Verify expected contents
			for _, expected := range tt.expectedContains {
				if !strings.Contains(result, expected) {
					t.Errorf("Expected result to contain %q, but it didn't.\nResult:\n%s", expected, result)
				}
			}

			// Verify expected absences
			for _, notExpected := range tt.expectedNotContain {
				if strings.Contains(result, notExpected) {
					t.Errorf("Expected result to NOT contain %q, but it did.\nResult:\n%s", notExpected, result)
				}
			}

			// Verify digest updates if applicable
			if newCommitSHA != "" {
				// By default (when remove_commit_sha_pins is not set), expected-commit should be updated
				if !strings.Contains(result, newCommitSHA) {
					t.Errorf("Expected result to contain new commit SHA %q", newCommitSHA)
				}
			}
			if expectedSHA256Hex != "" {
				if !strings.Contains(result, expectedSHA256Hex) {
					t.Errorf("Expected result to contain new SHA256 %q", expectedSHA256Hex)
				}
			}
		})
	}
}

func TestTransformAdditionalFileContent(t *testing.T) {
	tests := []struct {
		name          string
		content       string
		oldVersion    string
		newVersion    string
		oldMajorMinor string
		newMajorMinor string
		expected      string
	}{
		{
			name: "patch update replaces full version only",
			content: `#!/bin/bash
# Script for git-2.51
# Version: 2.51.0
echo "Installing git version 2.51.0"
`,
			oldVersion:    "2.51.0",
			newVersion:    "2.51.1",
			oldMajorMinor: "",
			newMajorMinor: "",
			expected: `#!/bin/bash
# Script for git-2.51
# Version: 2.51.1
echo "Installing git version 2.51.1"
`,
		},
		{
			name: "minor update replaces both version and major.minor",
			content: `#!/bin/bash
# Script for git-2.51
# Version: 2.51.0
# Package: git-2.51
PACKAGE_DIR="/usr/lib/git-2.51"
`,
			oldVersion:    "2.51.0",
			newVersion:    "2.52.0",
			oldMajorMinor: "2.51",
			newMajorMinor: "2.52",
			expected: `#!/bin/bash
# Script for git-2.52
# Version: 2.52.0
# Package: git-2.52
PACKAGE_DIR="/usr/lib/git-2.52"
`,
		},
		{
			name: "patch update preserves major.minor references",
			content: `#!/bin/bash
# Package: bash-5.2
# Version: 5.2.37
CONFIG_PATH="/etc/bash-5.2/config"
`,
			oldVersion:    "5.2.37",
			newVersion:    "5.2.38",
			oldMajorMinor: "",
			newMajorMinor: "",
			expected: `#!/bin/bash
# Package: bash-5.2
# Version: 5.2.38
CONFIG_PATH="/etc/bash-5.2/config"
`,
		},
		{
			name: "multiple version occurrences",
			content: `Version: 1.0.0
Binary: app-1.0.0
Download: https://example.com/app-1.0.0.tar.gz
Checksum: app-1.0.0.sha256
`,
			oldVersion:    "1.0.0",
			newVersion:    "1.0.1",
			oldMajorMinor: "",
			newMajorMinor: "",
			expected: `Version: 1.0.1
Binary: app-1.0.1
Download: https://example.com/app-1.0.1.tar.gz
Checksum: app-1.0.1.sha256
`,
		},
		{
			name:          "empty content",
			content:       "",
			oldVersion:    "1.0.0",
			newVersion:    "1.0.1",
			oldMajorMinor: "",
			newMajorMinor: "",
			expected:      "",
		},
		{
			name: "no matches",
			content: `#!/bin/bash
echo "Hello World"
`,
			oldVersion:    "1.0.0",
			newVersion:    "1.0.1",
			oldMajorMinor: "",
			newMajorMinor: "",
			expected: `#!/bin/bash
echo "Hello World"
`,
		},
		{
			name: "complex minor version update with multiple replacements",
			content: `# Kotsadm Configuration
# Version: 1.127.1
# Package: kotsadm-1.127
# Migration: kotsadm-1.127-migrations

KOTSADM_VERSION="1.127.1"
KOTSADM_PACKAGE="kotsadm-1.127"
MIGRATION_SCRIPT="/opt/kotsadm-1.127/migrate.sh"
`,
			oldVersion:    "1.127.1",
			newVersion:    "1.128.0",
			oldMajorMinor: "1.127",
			newMajorMinor: "1.128",
			expected: `# Kotsadm Configuration
# Version: 1.128.0
# Package: kotsadm-1.128
# Migration: kotsadm-1.128-migrations

KOTSADM_VERSION="1.128.0"
KOTSADM_PACKAGE="kotsadm-1.128"
MIGRATION_SCRIPT="/opt/kotsadm-1.128/migrate.sh"
`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := transformAdditionalFileContent(
				tt.content,
				tt.oldVersion,
				tt.newVersion,
				tt.oldMajorMinor,
				tt.newMajorMinor,
			)

			if result != tt.expected {
				t.Errorf("transformAdditionalFileContent() result mismatch.\nExpected:\n%s\n\nGot:\n%s", tt.expected, result)
			}
		})
	}
}
