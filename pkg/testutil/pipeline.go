package testutil

import (
	"os"
	"path/filepath"
	"testing"
)

// SetupTestPipelineDir creates a temporary pipeline directory for tests.
// Returns the path to the temporary directory.
// Automatically registers cleanup with t.Cleanup() to remove the directory after the test.
func SetupTestPipelineDir(t *testing.T) string {
	t.Helper()

	tmpDir, err := os.MkdirTemp("", "test-pipelines-*")
	if err != nil {
		t.Fatalf("Failed to create temp pipeline dir: %v", err)
	}

	// Register cleanup to automatically remove directory after test
	t.Cleanup(func() {
		os.RemoveAll(tmpDir)
	})

	// Create packages and test subdirectories for our silly test pipeline
	testDir := filepath.Join(tmpDir, "packages", "test")
	if err := os.MkdirAll(testDir, 0o755); err != nil {
		t.Fatalf("Failed to create packages/test dir: %v", err)
	}

	// Create a silly test pipeline that won't conflict with melange built-ins
	testPipeline := `name: test-hello-package
inputs:
  message:
    description: Message to print
    type: string
    default: "hello world from test pipeline"
pipeline:
  - runs: |
      echo "${{inputs.message}}"
      echo "This is a test pipeline for SecureBuild tests"
`

	if err := os.WriteFile(filepath.Join(testDir, "hello.yaml"), []byte(testPipeline), 0o644); err != nil {
		t.Fatalf("Failed to write test/hello.yaml: %v", err)
	}

	return tmpDir
}
