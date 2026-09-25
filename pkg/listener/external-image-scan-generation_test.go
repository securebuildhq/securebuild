package listener

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLegacyScanGenerationID(t *testing.T) {
	createdAt := time.Date(2026, time.September, 24, 12, 0, 0, 0, time.UTC)
	status := scan.ScanDirStatus{
		WorkDir: "/builders/scans/sha256:legacy",
		Metadata: scan.ScanMetadata{
			Digest:    "sha256:legacy",
			CreatedAt: createdAt,
		},
		ArchStatuses: map[string]*scan.ArchScanStatus{
			"x86_64":  {Done: true},
			"aarch64": {Done: false},
		},
	}

	architectures := scanStatusArchitectures(status)
	require.Equal(t, []string{"aarch64", "x86_64"}, architectures)

	first := legacyScanGenerationID(status, architectures)
	second := legacyScanGenerationID(status, scanStatusArchitectures(status))
	assert.Equal(t, first, second, "the same pre-generation directory must retain its fence across poller retries")
	assert.Contains(t, first, "legacy-")

	status.WorkDir = "/builders/scans/sha256:other"
	assert.NotEqual(t, first, legacyScanGenerationID(status, scanStatusArchitectures(status)))
}

func TestParseBuilderScanResultDetailsUsesGenerationTime(t *testing.T) {
	createdAt := time.Date(2026, time.September, 25, 10, 30, 0, 123, time.UTC)
	grypeResult := `{"matches":[],"descriptor":{"name":"grype","version":"0.95.0"}}`

	first, err := parseBuilderScanResultDetails(grypeResult, createdAt)
	require.NoError(t, err)
	second, err := parseBuilderScanResultDetails(grypeResult, createdAt)
	require.NoError(t, err)

	firstJSON, err := json.Marshal(first)
	require.NoError(t, err)
	secondJSON, err := json.Marshal(second)
	require.NoError(t, err)

	assert.Equal(t, createdAt, first.CreatedAt)
	assert.Equal(t, firstJSON, secondJSON, "re-polling the same generation must produce identical details")
}
