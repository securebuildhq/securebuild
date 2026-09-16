package build_priority_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/securebuildhq/securebuild/pkg/buildpriority"
	"github.com/securebuildhq/securebuild/pkg/image"
	"github.com/stretchr/testify/require"
)

func TestBuildPriorityMetadata(t *testing.T) {
	ctx, db := setupDatabase(t)
	t.Run("database ranks families with aliases prereleases and FIFO fallback", func(t *testing.T) {
		rows, err := db.Pool.Query(ctx, `WITH metadata(id, family, version_key, created_at) AS (
            VALUES ('go-old', 'go', $1::text, 1),
                   ('go-new', 'go', $2::text, 2),
                   ('pg-old', 'pg', $3::text, 3),
                   ('pg-new', 'pg', $4::text, 4),
                   ('go-alias', 'go', $2::text, 5),
                   ('unknown', 'go', NULL, 6),
                   ('go-rc', 'go', $5::text, 7)
        ), ranked AS (SELECT *, `+buildpriority.VersionRank+` AS version_rank FROM metadata)
        SELECT id FROM ranked ORDER BY version_rank, created_at, id`,
			buildpriority.VersionKey("1.9.0"), buildpriority.VersionKey("1.10.0"),
			buildpriority.VersionKey("17.0"), buildpriority.VersionKey("18.0"), buildpriority.VersionKey("1.10.0-rc.1"))
		require.NoError(t, err)
		defer rows.Close()
		var ids []string
		for rows.Next() {
			var id string
			require.NoError(t, rows.Scan(&id))
			ids = append(ids, id)
		}
		require.NoError(t, rows.Err())
		require.Equal(t, []string{"go-new", "pg-new", "go-alias", "unknown", "pg-old", "go-rc", "go-old"}, ids)
	})

	t.Run("removing version tags refreshes the stored key", func(t *testing.T) {
		tx, err := db.Pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx)
		require.NoError(t, image.RemoveAPKOTags(ctx, tx, "go-image", "old", []string{"1.10", "1.10.0"}))
		var key string
		var tags []string
		require.NoError(t, tx.QueryRow(ctx, `SELECT version_sort_key, version_sort_tags FROM image_apko WHERE id = 'new' AND tags = version_sort_tags`).Scan(&key, &tags))
		require.Empty(t, key, "latest alone must fall back to FIFO")
		require.Equal(t, []string{"latest"}, tags)
	})
	t.Run("stale tag keys fall back until repaired", func(t *testing.T) {
		_, err := db.Pool.Exec(ctx, `UPDATE image_apko SET tags = ARRAY['1.9.1'] WHERE id = 'old'`)
		require.NoError(t, err)
		enqueue(t, ctx, "build_apko", buildJob("stale", "old", 0), buildJob("newer", "new", 0))
		started := make(chan string, 2)
		startListener(t, ctx, "build_apko", func(ctx context.Context, n *pgconn.Notification) error {
			var j job
			if err := json.Unmarshal([]byte(n.Payload), &j); err != nil {
				return err
			}
			started <- j.ID
			return nil
		})
		require.Equal(t, "stale", receive(t, started), "stale metadata must use FIFO instead of the old key")
		require.Equal(t, "newer", receive(t, started))
		waitCompleted(t, ctx, db, 2)
		require.NoError(t, buildpriority.Backfill(ctx, db.Pool))
		var key string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT version_sort_key FROM image_apko WHERE id = 'old' AND version_sort_tags = tags`).Scan(&key))
		require.Equal(t, buildpriority.VersionKey("1.9.1"), key)
	})
	t.Run("backfill reports skipped locks resumes and is idempotent", func(t *testing.T) {
		fixture, err := os.ReadFile("testdata/backfill.sql")
		require.NoError(t, err)
		_, err = db.Pool.Exec(ctx, string(fixture))
		require.NoError(t, err)
		tx, err := db.Pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx)
		_, err = tx.Exec(ctx, `UPDATE image_apko SET tags = ARRAY['1.33.6'] WHERE id = 'backfill-2'`)
		require.NoError(t, err)
		require.ErrorContains(t, buildpriority.Backfill(ctx, db.Pool), "0 package versions and 1 image APKOs remain")
		var missing int
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM image_apko WHERE version_sort_key IS NULL`).Scan(&missing))
		require.Equal(t, 1, missing)
		require.NoError(t, tx.Commit(ctx))
		require.NoError(t, buildpriority.Backfill(ctx, db.Pool))
		var key string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT version_sort_key FROM image_apko WHERE id = 'backfill-2'`).Scan(&key))
		require.Equal(t, buildpriority.VersionKey("1.33.6"), key)
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT version_sort_key FROM image_apko WHERE id = 'backfill-1'`).Scan(&key))
		require.Empty(t, key)
		var before, after string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT xmin::text FROM image_apko WHERE id = 'backfill-3'`).Scan(&before))
		require.NoError(t, buildpriority.Backfill(ctx, db.Pool))
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT xmin::text FROM image_apko WHERE id = 'backfill-3'`).Scan(&after))
		require.Equal(t, before, after, "processed keys must not be rewritten or renumbered")
	})

	t.Run("backfill rejects locked missing package keys and stale image keys", func(t *testing.T) {
		_, err := db.Pool.Exec(ctx, `UPDATE package_version SET version_sort_key = NULL WHERE id = 'old-version';
            UPDATE image_apko SET tags = ARRAY['1.9.2'] WHERE id = 'backfill-3'`)
		require.NoError(t, err)
		tx, err := db.Pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx)
		_, err = tx.Exec(ctx, `SELECT id FROM package_version WHERE id = 'old-version' FOR UPDATE;
            SELECT id FROM image_apko WHERE id = 'backfill-3' FOR UPDATE`)
		require.NoError(t, err)
		require.ErrorContains(t, buildpriority.Backfill(ctx, db.Pool), "1 package versions and 1 image APKOs remain")
		require.NoError(t, tx.Rollback(ctx))
		require.NoError(t, buildpriority.Backfill(ctx, db.Pool))
		var key string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT version_sort_key FROM image_apko WHERE id = 'backfill-3' AND version_sort_tags = tags`).Scan(&key))
		require.Equal(t, buildpriority.VersionKey("1.9.2"), key)
	})
	t.Run("cancelled migration can be rerun", func(t *testing.T) {
		cancelled, cancel := context.WithCancel(ctx)
		cancel()
		require.ErrorIs(t, buildpriority.Backfill(cancelled, db.Pool), context.Canceled)
		require.NoError(t, buildpriority.Backfill(ctx, db.Pool))
	})

}
