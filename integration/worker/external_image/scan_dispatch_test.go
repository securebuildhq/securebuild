package worker_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/externalimage"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/stretchr/testify/require"
)

func TestExternalImageScanDispatchClaim(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, testDB.ConnStr, filepath.Join(projectRoot, "db", "schema", "tables"), false))

	ctx, minioStorage := setupMinIOOverrides(ctx, t, testDB.ConnStr)
	defer testutil.TeardownMinIO(ctx, t, minioStorage)

	require.NoError(t, persistence.InitPostgres(ctx))
	defer persistence.ClosePool(ctx)

	cache, err := scan.InitScanCapacityCache(ctx)
	require.NoError(t, err)
	ctx = listener.WithScanCapacityCache(ctx, cache)

	t.Run("recent terminal scans are not reclaimed", func(t *testing.T) {
		const digest = "sha256:recent-terminal-dispatch-claim"
		seedExternalImageScanForDispatch(t, ctx, digest)
		setScanStatus(t, ctx, digest, "x86_64", externalimage.ScanStatusSucceeded)
		setScanStatus(t, ctx, digest, "aarch64", externalimage.ScanStatusFailed)

		require.NoError(t, listener.HandleExternalImageScanOnBuilder(ctx, scanPayload(digest)))
		require.Equal(t, map[string]string{
			"aarch64": "failed",
			"x86_64":  "succeeded",
		}, scanStatusesByArch(t, ctx, digest))
	})

	t.Run("only eligible architectures are reverted after dispatch failure", func(t *testing.T) {
		const digest = "sha256:partial-dispatch-claim"
		seedExternalImageScanForDispatch(t, ctx, digest)
		setScanStatus(t, ctx, digest, "x86_64", externalimage.ScanStatusSucceeded)

		require.NoError(t, listener.HandleExternalImageScanOnBuilder(ctx, scanPayload(digest)))
		require.Equal(t, map[string]string{
			"aarch64": "queued",
			"x86_64":  "succeeded",
		}, scanStatusesByArch(t, ctx, digest))
	})

	t.Run("stale terminal scans remain eligible", func(t *testing.T) {
		const digest = "sha256:stale-terminal-dispatch-claim"
		seedExternalImageScanForDispatch(t, ctx, digest)
		setScanStatus(t, ctx, digest, "x86_64", externalimage.ScanStatusSucceeded)
		setScanStatus(t, ctx, digest, "aarch64", externalimage.ScanStatusFailed)
		setScanCompletedAt(t, ctx, digest, time.Now().Add(-4*time.Hour-time.Minute))

		require.NoError(t, listener.HandleExternalImageScanOnBuilder(ctx, scanPayload(digest)))
		// No builders exist in the test database, so a successful claim is
		// reverted to queued after dispatch cannot reserve a builder.
		require.Equal(t, map[string]string{
			"aarch64": "queued",
			"x86_64":  "queued",
		}, scanStatusesByArch(t, ctx, digest))
	})

	t.Run("queued retries may retain a recent prior completion", func(t *testing.T) {
		const digest = "sha256:queued-prior-completion-dispatch-claim"
		seedExternalImageScanForDispatch(t, ctx, digest)
		setScanStatus(t, ctx, digest, "x86_64", externalimage.ScanStatusSucceeded)
		setScanStatus(t, ctx, digest, "aarch64", externalimage.ScanStatusSucceeded)
		queuedAt := time.Now().Add(-time.Hour)
		setScanQueuedAt(t, ctx, digest, "x86_64", queuedAt)

		require.NoError(t, listener.HandleExternalImageScanOnBuilder(ctx, scanPayload(digest)))
		statuses := getScanStatuses(t, ctx, digest)
		require.Len(t, statuses, 2)
		require.Equal(t, "queued", statuses[1].Status)
		require.NotNil(t, statuses[1].ScanStatusUpdatedAt)
		require.True(t, statuses[1].ScanStatusUpdatedAt.After(queuedAt), "queued row should be claimed and reverted")
	})
}

func seedExternalImageScanForDispatch(t *testing.T, ctx context.Context, digest string) {
	t.Helper()
	require.NoError(t, externalimage.InitializeSBOMStatusPending(ctx, digest))
	for _, arch := range []string{"x86_64", "aarch64"} {
		require.NoError(t, externalimage.SetExternalImageSBOM(ctx, digest, `{"artifacts":[]}`, "syft", arch, 1, digest))
		require.NoError(t, externalimage.InitializeScanStatusQueued(ctx, digest, arch))
	}
	require.NoError(t, externalimage.SetSBOMStatusSucceeded(ctx, digest))
}

func setScanStatus(t *testing.T, ctx context.Context, digest, arch string, status externalimage.ScanStatus) {
	t.Helper()
	require.NoError(t, externalimage.SetExternalImageScanStatus(ctx, externalimage.SetExternalImageScanStatusParams{
		Digest: digest,
		Arch:   arch,
		Status: status,
	}))
}

func setScanCompletedAt(t *testing.T, ctx context.Context, digest string, completedAt time.Time) {
	t.Helper()
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	_, err := conn.Exec(ctx, `UPDATE external_image_scan SET scan_completed_at = $2 WHERE digest = $1`, digest, completedAt)
	require.NoError(t, err)
}

func setScanQueuedAt(t *testing.T, ctx context.Context, digest, arch string, queuedAt time.Time) {
	t.Helper()
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	_, err := conn.Exec(ctx, `
		UPDATE external_image_scan
		SET status = 'queued', scan_status_updated_at = $3
		WHERE digest = $1 AND arch = $2
	`, digest, arch, queuedAt)
	require.NoError(t, err)
}

func scanStatusesByArch(t *testing.T, ctx context.Context, digest string) map[string]string {
	t.Helper()
	statuses := map[string]string{}
	for _, status := range getScanStatuses(t, ctx, digest) {
		statuses[status.Arch] = status.Status
	}
	return statuses
}

func scanPayload(digest string) string {
	return `{"digest":"` + digest + `"}`
}
