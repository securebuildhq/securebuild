package listener

import (
	"context"
	"crypto/sha256"
	_ "embed"
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

//go:embed testdata/melange_transform_input.yaml
var transformInput string

//go:embed testdata/melange_transform_expected.yaml
var transformExpected string

//go:embed testdata/apko_transform_input.yaml
var apkoTransformInput string

//go:embed testdata/apko_transform_expected.yaml
var apkoTransformExpected string

func TestTransformApkoYAMLForNewMinorVersion(t *testing.T) {
	result, err := transformApkoYAMLForNewMinorVersion(
		apkoTransformInput,
		"5.2.37",   // oldVersion
		"5.3",      // newVersion
		"5.2",      // oldMajorMinor
		"5.3",      // newMajorMinor
		"bash-5.2", // oldPackageName
		[]string{"bash-entrypoint-5.2", "bash-entrypoint2", "bash-entrypoint3-5.2", "bash-entrypoint2"}, // subpackageNames
	)
	if err != nil {
		t.Fatalf("transformApkoYAMLForNewMinorVersion returned error: %v", err)
	}

	if result != apkoTransformExpected {
		t.Errorf("transformApkoYAMLForNewMinorVersion result mismatch.\nExpected:\n%s\n\nGot:\n%s", apkoTransformExpected, result)
	}

	// Additional verifications
	// Verify bash packages were updated
	if !strings.Contains(result, "bash-5.3~5.3") {
		t.Errorf("Expected bash-5.3~5.3 to be in result")
	}
	if !strings.Contains(result, "bash-entrypoint-5.3~5.3") {
		t.Errorf("Expected bash-entrypoint-5.3~5.3 to be in result")
	}

	// Verify git was NOT updated (different package)
	if !strings.Contains(result, "git-5.2~5.2.15") {
		t.Errorf("Expected git-5.2~5.2.15 to remain unchanged")
	}
	if strings.Contains(result, "git-5.3") {
		t.Errorf("git package should not have been updated")
	}

	// Verify version strings in environment were updated
	if !strings.Contains(result, `_BASH_VERSION: "5.3"`) {
		t.Errorf("Expected _BASH_VERSION to be updated to 5.3")
	}
	if !strings.Contains(result, `_BASH_BASELINE: "5.3"`) {
		t.Errorf("Expected _BASH_BASELINE to be updated to 5.3")
	}

	// Verify annotation version was updated
	if !strings.Contains(result, `org.opencontainers.image.version: "5.3"`) {
		t.Errorf("Expected annotation version to be updated to 5.3")
	}

	// Verify old version was replaced
	if strings.Contains(result, "5.2.37") {
		t.Errorf("Old version 5.2.37 should have been replaced")
	}
}

func TestTransformMelangeYAMLForNewMinorVersion(t *testing.T) {
	ctx := context.Background()

	ctx, err := param.Init(param.InitSourceEnvironment, map[string]string{
		"PIPELINE_DIR": testutil.SetupTestPipelineDir(t),
	})
	if err != nil {
		t.Fatalf("Failed to initialize params: %v", err)
	}

	// Create a test file server for fetch operations
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
	defer fileServer.Close()

	// Create a mock GitHub API server
	newCommitSHA := "def456789012345678901234567890abcdef1234"
	githubServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/repos/git/git/git/ref/tags/v2.51.1"):
			// Return a lightweight tag (commit)
			ref := github.Reference{
				Ref: github.String("refs/tags/v2.51.1"),
				Object: &github.GitObject{
					Type: github.String("commit"),
					SHA:  github.String(newCommitSHA),
				},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(ref)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer githubServer.Close()

	// Create GitHub client pointing to mock server
	githubClient := github.NewClient(nil)
	githubURL, _ := url.Parse(githubServer.URL + "/")
	githubClient.BaseURL = githubURL
	githubClient.UploadURL = githubURL

	// Replace the file server URL in the test input
	inputWithMockServer := strings.ReplaceAll(transformInput,
		"https://www.kernel.org/pub/software/scm/git",
		fileServer.URL)

	result, err := transformMelangeYAMLForNewMinorVersion(
		ctx,
		inputWithMockServer,
		"git-2.50",
		"git-2.51",
		"2.50.0",
		"2.51.1",
		"2.50",
		"2.51",
		0,
		githubClient,
	)
	if err != nil {
		t.Fatalf("transformMelangeYAMLForNewMinorVersion returned error: %v", err)
	}

	// Replace the file server URL in expected output for comparison
	expectedWithMockServer := strings.ReplaceAll(transformExpected,
		"https://www.kernel.org/pub/software/scm/git",
		fileServer.URL)
	// Also replace the expected SHA256 with the actual one from our test file
	expectedWithMockServer = strings.ReplaceAll(expectedWithMockServer,
		"9af1dbeb5c57ff64cfacdf4af194839a71f493ec0d7d10e46b99ce6434c8dbcf",
		expectedSHA256Hex)

	if result != expectedWithMockServer {
		t.Errorf("transformMelangeYAMLForNewMinorVersion result mismatch.\nExpected:\n%s\n\nGot:\n%s", expectedWithMockServer, result)
	}

	// Additional verifications for digest updates
	// By default (when remove_commit_sha_pins is not set), expected-commit should be updated
	if !strings.Contains(result, newCommitSHA) {
		t.Errorf("Expected commit to be updated to %s", newCommitSHA)
	}
	if !strings.Contains(result, expectedSHA256Hex) {
		t.Errorf("Expected sha256 to be updated to %s", expectedSHA256Hex)
	}
	if strings.Contains(result, "abc123456789012345678901234567890abcdef0") {
		t.Errorf("Expected old commit to be removed")
	}
	if strings.Contains(result, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef") {
		t.Errorf("Expected old sha256 to be replaced")
	}
}

func TestUpdateReferenceImageTag(t *testing.T) {
	tests := []struct {
		name        string
		inputYAML   string
		newTag      string
		expectedRef string
		expectError bool
	}{
		{
			name: "basic reference image update",
			inputYAML: `referenceImage: bitnami/kubectl:1.33.4
test:
  pipeline:
    - name: test-step
      runs: echo "test"
`,
			newTag:      "1.34.0",
			expectedRef: "bitnami/kubectl:1.34.0",
		},
		{
			name: "reference image with registry prefix",
			inputYAML: `referenceImage: docker.io/library/nginx:1.25.3
test:
  pipeline:
    - name: check
      runs: nginx -v
`,
			newTag:      "1.26.0",
			expectedRef: "docker.io/library/nginx:1.26.0",
		},
		{
			name: "no reference image field",
			inputYAML: `test:
  pipeline:
    - name: test
      runs: echo "no ref image"
`,
			newTag:      "1.1.0",
			expectedRef: "",
		},
		{
			name: "reference image with v prefix tag",
			inputYAML: `referenceImage: gcr.io/myproject/myapp:v2.5.0
test:
  pipeline:
    - runs: test
`,
			newTag:      "v2.6.0",
			expectedRef: "gcr.io/myproject/myapp:v2.6.0",
		},
		{
			name: "reference image update preserves other content",
			inputYAML: `referenceImage: alpine:3.18
test:
  pipeline:
    - name: version-check
      runs: |
        cat /etc/alpine-release
        echo "Done"
`,
			newTag:      "3.19",
			expectedRef: "alpine:3.19",
		},
		{
			name: "yaml field ordering may change but data preserved",
			inputYAML: `referenceImage: alpine:3.18
test:
  pipeline:
    - name: step1
      runs: echo test
`,
			newTag:      "3.19",
			expectedRef: "alpine:3.19",
		},
		{
			name: "reference image with registry port",
			inputYAML: `referenceImage: localhost:5000/myimage:v1.0.0
test:
  pipeline:
    - runs: echo "test"
`,
			newTag:      "v2.0.0",
			expectedRef: "localhost:5000/myimage:v2.0.0",
		},
		{
			name: "reference image with registry port and path",
			inputYAML: `referenceImage: myregistry.com:443/project/image:1.2.3
test:
  pipeline:
    - runs: echo "test"
`,
			newTag:      "1.3.0",
			expectedRef: "myregistry.com:443/project/image:1.3.0",
		},
		{
			name:        "empty yaml",
			inputYAML:   ``,
			newTag:      "1.0.0",
			expectedRef: "",
		},
		{
			name: "registry port with implicit latest tag",
			inputYAML: `referenceImage: localhost:5000/myimage
test:
  pipeline:
    - runs: echo "test"
`,
			newTag:      "v1.0.0",
			expectedRef: "localhost:5000/myimage:v1.0.0",
		},
		{
			name: "registry port in path with implicit latest tag",
			inputYAML: `referenceImage: myregistry.com:443/project/image
test:
  pipeline:
    - runs: echo "test"
`,
			newTag:      "1.0.0",
			expectedRef: "myregistry.com:443/project/image:1.0.0",
		},
		{
			name: "yaml with comments - comments are preserved",
			inputYAML: `# This is a header comment
referenceImage: alpine:3.18
# This comment is about the test
test:
  pipeline:
    - name: version-check
      # Inline comment
      runs: cat /etc/alpine-release
`,
			newTag:      "3.19",
			expectedRef: "alpine:3.19",
		},
		{
			name: "image reference in comment should not be replaced",
			inputYAML: `# Previous image was alpine:3.18
# We're using alpine:3.18 as the base
referenceImage: alpine:3.18
test:
  pipeline:
    - name: version-check
      runs: cat /etc/alpine-release
`,
			newTag:      "3.19",
			expectedRef: "alpine:3.19",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := updateReferenceImageTag(tt.inputYAML, tt.newTag)

			if tt.expectError {
				if err == nil {
					t.Errorf("Expected error but got none")
				}
				return
			}

			if err != nil {
				t.Errorf("Unexpected error: %v", err)
				return
			}

			if tt.expectedRef != "" {
				if !strings.Contains(result, tt.expectedRef) {
					t.Errorf("Expected result to contain %q\nGot:\n%s", tt.expectedRef, result)
				}
			}

			// Ensure the test section is preserved
			if strings.Contains(tt.inputYAML, "test:") && !strings.Contains(result, "test:") {
				t.Errorf("test: section was removed from YAML")
			}

			// For the no-reference-image case, ensure the output is unchanged
			if tt.expectedRef == "" && tt.inputYAML != "" && result != tt.inputYAML {
				t.Errorf("Expected no changes when no referenceImage field exists\nInput:\n%s\nOutput:\n%s", tt.inputYAML, result)
			}

			// Comments should always be preserved
			// Extract all comments from input and verify they're in output
			for _, line := range strings.Split(tt.inputYAML, "\n") {
				trimmed := strings.TrimSpace(line)
				if strings.HasPrefix(trimmed, "#") && !strings.Contains(result, trimmed) {
					t.Errorf("Expected comment to be preserved: %q\nOutput:\n%s", trimmed, result)
				}
			}
		})
	}
}
