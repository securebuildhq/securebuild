package listener

import (
	"strings"
	"testing"
)

func TestClassifySbomDownloadFailureSkipsUnsupportedPlatforms(t *testing.T) {
	tests := []struct {
		name   string
		stderr string
	}{
		{
			name: "mismatched single-platform image",
			stderr: `ERROR could not determine source:
  - oci-registry: mismatched platform (expected linux/amd64): image platform="linux/arm64/v8" does not match user specified platform="linux/amd64"
  - oci-model: unexpected status code 401 Unauthorized`,
		},
		{
			name:   "manifest has no matching platform",
			stderr: "no match for platform in manifest: not found",
		},
		{
			name:   "platform image not found",
			stderr: "no image found for platform linux/arm64",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			failure, skipped := classifySbomDownloadFailure(1, tt.stderr)
			if !skipped {
				t.Fatal("expected unsupported platform to be skipped")
			}
			if failure != nil {
				t.Fatalf("expected no failure for skipped platform, got %v", failure)
			}
		})
	}
}

func TestClassifySbomDownloadFailurePreservesRealErrors(t *testing.T) {
	stderr := "unexpected status code 401 Unauthorized: Not Authorized"
	failure, skipped := classifySbomDownloadFailure(1, stderr)
	if skipped {
		t.Fatal("expected authentication error not to be skipped")
	}
	if failure == nil {
		t.Fatal("expected authentication error to be returned")
	}
	if !strings.Contains(failure.Error(), stderr) {
		t.Fatalf("expected failure to contain stderr, got %v", failure)
	}
}
