package catalog_scan_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/stretchr/testify/require"
)

func loadCleanupTest(t *testing.T) (context.Context, *testutil.TestDatabase, string) {
	t.Helper()
	ctx, db := setupCatalogScanTest(t, 2)
	root, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, db.ConnStr,
		filepath.Join(root, "integration", "worker", "catalog_scan", "testdata", "cleanup"), true))
	sql, err := os.ReadFile(filepath.Join(root, "scripts", "sql", "retire-duplicate-catalog-scans.sql"))
	require.NoError(t, err)
	return ctx, db, string(sql)
}

func retireDuplicates(t *testing.T, ctx context.Context, db *testutil.TestDatabase, sql string) []string {
	t.Helper()
	rows, err := db.Pool.Query(ctx, sql)
	require.NoError(t, err)
	defer rows.Close()
	var retired []string
	for rows.Next() {
		var id, imageID, keeperID string
		require.NoError(t, rows.Scan(&id, &imageID, &keeperID))
		require.NotEmpty(t, imageID)
		require.NotEqual(t, id, keeperID)
		retired = append(retired, id)
	}
	require.NoError(t, rows.Err())
	return retired
}

func TestCatalogScanCleanupPreservesWorkAndHistory(t *testing.T) {
	t.Parallel()
	ctx, db, sql := loadCleanupTest(t)

	root, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	preview, err := os.ReadFile(filepath.Join(root, "scripts", "sql", "preview-duplicate-catalog-scans.sql"))
	require.NoError(t, err)
	var pending, images, running, duplicates int
	require.NoError(t, db.Pool.QueryRow(ctx, string(preview)).Scan(&pending, &images, &running, &duplicates))
	require.Equal(t, 14, pending)
	require.Equal(t, 7, images)
	require.Equal(t, 3, running)
	require.Equal(t, 6, duplicates)

	before := make(map[string]string)
	rows, err := db.Pool.Query(ctx, `SELECT id, to_jsonb(w)::text FROM work_queue w`)
	require.NoError(t, err)
	for rows.Next() {
		var id, record string
		require.NoError(t, rows.Scan(&id, &record))
		before[id] = record
	}
	require.NoError(t, rows.Err())
	rows.Close()

	retired := retireDuplicates(t, ctx, db, sql)
	require.ElementsMatch(t, []string{
		"oldest-duplicate", "keyed-duplicate", "running-duplicate",
		"multi-running-duplicate", "completed-duplicate", "retry-duplicate",
	}, retired)

	rows, err = db.Pool.Query(ctx, `
		SELECT id, to_jsonb(w)::text, completed_at IS NOT NULL,
		       dedupe_key IS NULL, COALESCE(last_error, '')
		FROM work_queue w
	`)
	require.NoError(t, err)
	count := 0
	for rows.Next() {
		var id, record, lastError string
		var completed, keyReleased bool
		require.NoError(t, rows.Scan(&id, &record, &completed, &keyReleased, &lastError))
		count++
		if slices.Contains(retired, id) {
			require.True(t, completed)
			require.True(t, keyReleased)
			require.Contains(t, lastError, "superseded duplicate catalog scan; kept queue item ")
			if id == "retry-duplicate" {
				require.Contains(t, lastError, "earlier scan error")
			}
			var original, updated map[string]any
			require.NoError(t, json.Unmarshal([]byte(before[id]), &original))
			require.NoError(t, json.Unmarshal([]byte(record), &updated))
			for _, field := range []string{"completed_at", "dedupe_key", "last_error"} {
				delete(original, field)
				delete(updated, field)
			}
			require.Equal(t, original, updated, "retired row %s must retain its metadata", id)
		} else {
			require.JSONEq(t, before[id], record, "retained row %s must be unchanged", id)
		}
	}
	require.NoError(t, rows.Err())
	rows.Close()
	require.Equal(t, len(before), count, "cleanup must retain queue history")
	require.Empty(t, retireDuplicates(t, ctx, db, sql), "repeating cleanup must be harmless")
}

func TestCatalogScanCleanupSkipsLockedDuplicates(t *testing.T) {
	t.Parallel()
	ctx, db, sql := loadCleanupTest(t)
	tx, err := db.Pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `SELECT id FROM work_queue WHERE id = 'oldest-duplicate' FOR UPDATE`)
	require.NoError(t, err)

	retired := retireDuplicates(t, ctx, db, sql)
	require.Len(t, retired, 5)
	require.NotContains(t, retired, "oldest-duplicate")
	require.NoError(t, tx.Rollback(ctx))
	require.Equal(t, []string{"oldest-duplicate"}, retireDuplicates(t, ctx, db, sql))
}

func TestCatalogScanCleanupLimitsEachBatch(t *testing.T) {
	t.Parallel()
	ctx, db, sql := loadCleanupTest(t)
	_, err := db.Pool.Exec(ctx, `
		INSERT INTO work_queue (id, channel, payload, created_at)
		SELECT 'batch-' || n, 'scan_catalog_image', '{"catalogImageId":"batch"}'::jsonb,
		       '2025-02-01'::timestamptz + n * interval '1 second'
		FROM generate_series(1, 1005) AS n
	`)
	require.NoError(t, err)
	require.Len(t, retireDuplicates(t, ctx, db, sql), 1000)
	require.Len(t, retireDuplicates(t, ctx, db, sql), 10)
	require.Empty(t, retireDuplicates(t, ctx, db, sql))

	var pending int
	require.NoError(t, db.Pool.QueryRow(ctx, `
		SELECT count(*) FROM work_queue
		WHERE channel = 'scan_catalog_image' AND payload->>'catalogImageId' = 'batch'
		  AND completed_at IS NULL
	`).Scan(&pending))
	require.Equal(t, 1, pending)
}
