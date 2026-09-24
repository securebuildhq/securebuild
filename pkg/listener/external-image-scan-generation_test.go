package listener

import (
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
