package worker_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/securebuildhq/securebuild/pkg/util"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// referenceTime is the fixed "now" used in tier tests. All seed data
// timestamps are relative to this value.
const referenceTime = "2026-01-15T12:00:00Z"

// tierTestDigests mirrors the seed data in testdata/seed-data/.
var (
	activeDigest    = "sha256:active-tier-digest-12345678901234567890123456789012"
	recentDigest    = "sha256:recent-tier-digest-12345678901234567890123456789012"
	staleDigest     = "sha256:stale-tier-digest-12345678901234567890123456789012"
	inactiveDigest  = "sha256:inactive-tier-digest-12345678901234567890123456789012"
	neverScannedDg  = "sha256:never-scanned-digest-12345678901234567890123456789012"
	freshDigest     = "sha256:fresh-active-digest-12345678901234567890123456789012"
	activeScannedDg = "sha256:active-scanned-digest-12345678901234567890123456789012"
)

func setupTierTestDB(t *testing.T) (context.Context, func()) {
	t.Helper()
	ctx := context.Background()

	testDB := testutil.SetupTestDatabase(ctx, t)

	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	schemaDir := filepath.Join(projectRoot, "db", "schema", "tables")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, schemaDir, false)
	require.NoError(t, err)

	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "external_image", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	overrides := map[string]string{
		"DB_URI": testDB.ConnStr,
	}
	ctx, err = param.Init(param.InitSourceEnvironment, overrides)
	require.NoError(t, err)

	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)

	// Inject a fake clock so tier queries and idempotency checks use a
	// deterministic reference time. Both scan and externalimage packages
	// read the now func from util.WithNowFunc.
	refTime, err := time.Parse(time.RFC3339, referenceTime)
	require.NoError(t, err)
	ctx = util.WithNowFunc(ctx, func() time.Time { return refTime })

	cleanup := func() {
		persistence.ClosePool(ctx)
		testutil.TeardownTestDatabase(ctx, t, testDB)
	}

	return ctx, cleanup
}

// TestSelectExternalImageDigestsToScanTiers verifies that the tiered back-off
// scheduling selects digests from the correct tier based on last_submitted_at
// and that images >90 days old are included in the inactive tier.
func TestSelectExternalImageDigestsToScanTiers(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()

	ctx, cleanup := setupTierTestDB(t)
	defer cleanup()

	t.Run("All tiers selected with sufficient capacity", func(t *testing.T) {
		digests, err := scan.SelectExternalImageDigestsToScan(ctx, 25)
		require.NoError(t, err)

		assert.Contains(t, digests, neverScannedDg, "never-scanned digest should be selected")
		assert.Contains(t, digests, activeDigest, "active tier digest should be selected")
		assert.Contains(t, digests, recentDigest, "recent tier digest should be selected")
		assert.Contains(t, digests, staleDigest, "stale tier digest should be selected")
		assert.Contains(t, digests, inactiveDigest, "inactive tier digest should be selected")
	})

	t.Run("Never-scanned prioritized over rescans when capacity=1", func(t *testing.T) {
		digests, err := scan.SelectExternalImageDigestsToScan(ctx, 1)
		require.NoError(t, err)

		assert.Len(t, digests, 1)
		assert.Contains(t, digests, neverScannedDg, "never-scanned should be prioritized over active rescans")
	})

	t.Run("Never-scanned and active tier with capacity=2", func(t *testing.T) {
		digests, err := scan.SelectExternalImageDigestsToScan(ctx, 2)
		require.NoError(t, err)

		assert.Len(t, digests, 2)
		assert.Contains(t, digests, neverScannedDg)
		// Second slot should be from the active tier (either active or active-scanned)
		assert.True(t, containsAny(digests, activeDigest, activeScannedDg),
			"second digest should be from active tier, got %v", digests)
		assert.NotContains(t, digests, recentDigest, "recent tier should not be reached with capacity 2")
	})

	t.Run("Active tier fills before recent tier", func(t *testing.T) {
		// Capacity 3: never-scanned(1) + active(2) = 3, recent should not appear
		digests, err := scan.SelectExternalImageDigestsToScan(ctx, 3)
		require.NoError(t, err)

		assert.Len(t, digests, 3)
		assert.Contains(t, digests, neverScannedDg)
		assert.NotContains(t, digests, recentDigest, "recent tier should not be reached with capacity 3")
		assert.NotContains(t, digests, staleDigest, "stale tier should not be reached with capacity 3")
	})

	t.Run("Inactive digest (>90 days) is selected", func(t *testing.T) {
		digests, err := scan.SelectExternalImageDigestsToScan(ctx, 25)
		require.NoError(t, err)

		assert.Contains(t, digests, inactiveDigest, "inactive tier digest should be selected")
	})
}

// TestSelectExternalImageDigestsToScanFreshNotStale verifies that a digest
// scanned within the tier's rescan interval is NOT selected.
func TestSelectExternalImageDigestsToScanFreshNotStale(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()

	ctx, cleanup := setupTierTestDB(t)
	defer cleanup()

	digests, err := scan.SelectExternalImageDigestsToScan(ctx, 25)
	require.NoError(t, err)

	assert.NotContains(t, digests, freshDigest, "recently scanned digest within interval should not be selected")
}

// TestHandleExternalImageScanIdempotency verifies that a scan message arriving
// after a scan already completed within 4 hours is discarded without re-scanning.
// Uses the "fresh" digest from seed data, which has last_security_scanned_at
// set to 1 hour before the reference time (within the 4h idempotency threshold).
func TestHandleExternalImageScanIdempotency(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()

	ctx, cleanup := setupTierTestDB(t)
	defer cleanup()

	// Track scan call count via mock. This mock is expected to never be called
	// because the handler should discard the message before reaching RunScanForDigest.
	// If scanCallCount is non-zero, the idempotency guard failed.
	scanCallCount := 0
	mockScanExternalImage := func(ctx context.Context, digest string) (map[string]string, error) {
		scanCallCount++
		return map[string]string{
			"x86_64": `{"matches":[],"descriptor":{"name":"grype","version":"0.95.0"}}`,
		}, nil
	}
	ctx = listener.WithMockScanExternalImage(ctx, mockScanExternalImage)

	// Call the handler with the fresh digest — should discard because scan
	// completed 1 hour before reference time (within 4h threshold).
	payload := `{"digest":"` + freshDigest + `"}`
	err := listener.HandleExternalImageScan(ctx, payload)
	require.NoError(t, err)

	assert.Equal(t, 0, scanCallCount, "scan should not be called for recently scanned digest")

	// Verify scan status is still 'succeeded' (not re-scanned)
	scanStatuses := getScanStatuses(t, ctx, freshDigest)
	require.Len(t, scanStatuses, 1)
	assert.Equal(t, "succeeded", scanStatuses[0].Status)
}

// containsAny returns true if the slice contains any of the given values.
func containsAny(slice []string, values ...string) bool {
	for _, s := range slice {
		for _, v := range values {
			if s == v {
				return true
			}
		}
	}
	return false
}
