package catalog_scan_test

import (
	"context"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/scan"
	pkgtestutil "github.com/securebuildhq/securebuild/pkg/testutil"
	"github.com/stretchr/testify/require"
)

func setupCatalogScanTest(t *testing.T, batchSize int) (context.Context, *testutil.TestDatabase) {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	t.Cleanup(func() { testutil.TeardownTestDatabase(ctx, t, db) })
	root, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, db.ConnStr,
		filepath.Join(root, "integration", "worker", "catalog_scan", "testdata", "seed-data"), true))
	ctx, err = param.Init(param.InitSourceEnvironment, map[string]string{
		"DB_URI":               db.ConnStr,
		"PIPELINE_DIR":         pkgtestutil.SetupTestPipelineDir(t),
		"MAX_IMAGES_PER_CYCLE": strconv.Itoa(batchSize),
	})
	require.NoError(t, err)
	require.NoError(t, persistence.InitPostgres(ctx))
	t.Cleanup(func() { persistence.ClosePool(ctx) })
	return ctx, db
}

func TestCatalogScanSchedulerSkipsUnfinishedScansBeforeBatchLimit(t *testing.T) {
	t.Parallel()
	ctx, db := setupCatalogScanTest(t, 2)

	for _, id := range []string{"legacy-pending", "legacy-running", "legacy-retry"} {
		require.NoError(t, persistence.EnqueueWork(ctx, "scan_catalog_image", map[string]string{
			"catalogImageId": id, "imageName": "catalog-scan-image", "imageTag": id,
		}))
	}
	_, err := db.Pool.Exec(ctx, `
		UPDATE work_queue SET processing_started_at = NOW()
		WHERE payload->>'catalogImageId' = 'legacy-running';
		UPDATE work_queue SET next_attempt_at = NOW() + interval '1 hour'
		WHERE payload->>'catalogImageId' = 'legacy-retry'
	`)
	require.NoError(t, err)

	require.NoError(t, scan.ProcessPeriodicScans(ctx))
	var keyedIDs []string
	require.NoError(t, db.Pool.QueryRow(ctx, `
		SELECT array_agg(dedupe_key ORDER BY dedupe_key)
		FROM work_queue WHERE channel = 'scan_catalog_image' AND dedupe_key IS NOT NULL
	`).Scan(&keyedIDs))
	require.Equal(t, []string{"due-a", "due-b"}, keyedIDs)

	require.NoError(t, scan.ProcessPeriodicScans(ctx))
	require.NoError(t, scan.ProcessPeriodicScans(ctx))
	var count, distinctImages, matchingKeys int
	require.NoError(t, db.Pool.QueryRow(ctx, `
		SELECT count(*), count(DISTINCT payload->>'catalogImageId'),
		       count(*) FILTER (WHERE dedupe_key = payload->>'catalogImageId')
		FROM work_queue WHERE channel = 'scan_catalog_image'
	`).Scan(&count, &distinctImages, &matchingKeys))
	require.Equal(t, 6, count)
	require.Equal(t, 6, distinctImages)
	require.Equal(t, 3, matchingKeys)

	var name, tag string
	require.NoError(t, db.Pool.QueryRow(ctx, `
		SELECT payload->>'imageName', payload->>'imageTag'
		FROM work_queue WHERE dedupe_key = 'due-a'
	`).Scan(&name, &tag))
	require.Equal(t, "catalog-scan-image", name)
	require.Equal(t, "due-a", tag)
}

func TestCatalogScanSchedulerConcurrentCyclesEnqueueOnce(t *testing.T) {
	t.Parallel()
	ctx, db := setupCatalogScanTest(t, 25)

	var wg sync.WaitGroup
	errors := make(chan error, 8)
	start := make(chan struct{})
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			errors <- scan.ProcessPeriodicScans(ctx)
		}()
	}
	close(start)
	wg.Wait()
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}
	var count, distinctKeys int
	require.NoError(t, db.Pool.QueryRow(ctx, `
		SELECT count(*), count(DISTINCT dedupe_key)
		FROM work_queue WHERE channel = 'scan_catalog_image'
	`).Scan(&count, &distinctKeys))
	require.Equal(t, 6, count)
	require.Equal(t, count, distinctKeys)
}

func TestCatalogScanSchedulerAllowsNextScanAfterCompletion(t *testing.T) {
	t.Parallel()
	ctx, db := setupCatalogScanTest(t, 1)
	_, err := db.Pool.Exec(ctx, `UPDATE image_catalog SET is_published = false WHERE id <> 'due-a'`)
	require.NoError(t, err)
	require.NoError(t, scan.ProcessPeriodicScans(ctx))

	l := listener.NewListener(ctx)
	require.NoError(t, l.AddHandler(ctx, "scan_catalog_image", 1, time.Minute,
		func(ctx context.Context, _ *pgconn.Notification) error {
			_, err := db.Pool.Exec(ctx, `UPDATE image_catalog SET next_scan_at = NOW() + interval '24 hours' WHERE id = 'due-a'`)
			return err
		}))
	listenerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	require.NoError(t, l.Start(listenerCtx))
	defer func() {
		cancel()
		require.NoError(t, l.Stop(ctx))
	}()

	require.Eventually(t, func() bool {
		var completed bool
		err := db.Pool.QueryRow(ctx, `
			SELECT completed_at IS NOT NULL AND dedupe_key IS NULL AND last_error IS NULL
			FROM work_queue WHERE payload->>'catalogImageId' = 'due-a'
		`).Scan(&completed)
		return err == nil && completed
	}, 5*time.Second, 10*time.Millisecond)

	require.NoError(t, scan.ProcessPeriodicScans(ctx))
	var count int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM work_queue WHERE channel = 'scan_catalog_image'`).Scan(&count))
	require.Equal(t, 1, count, "a freshly scanned image must wait for its next scan")

	_, err = db.Pool.Exec(ctx, `UPDATE image_catalog SET next_scan_at = NOW() - interval '1 minute' WHERE id = 'due-a'`)
	require.NoError(t, err)
	require.NoError(t, scan.ProcessPeriodicScans(ctx))
	require.Eventually(t, func() bool {
		var completed int
		err := db.Pool.QueryRow(ctx, `
			SELECT count(*) FROM work_queue
			WHERE channel = 'scan_catalog_image' AND completed_at IS NOT NULL AND dedupe_key IS NULL
		`).Scan(&completed)
		return err == nil && completed == 2
	}, 5*time.Second, 10*time.Millisecond)
}
