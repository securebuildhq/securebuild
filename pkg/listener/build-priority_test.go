package listener

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/buildpriority"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

// Exercise the real PostgreSQL selection/claim query, including ordering across
// batches, concurrent locks, retries, and workers that are already occupied.
func TestBuildPriorityClaims(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL in Docker and SchemaHero")
	}
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, db)
	ctx, err := param.Init(param.InitSourceEnvironment, map[string]string{"DB_URI": db.ConnStr})
	require.NoError(t, err)
	require.NoError(t, persistence.InitPostgres(ctx))
	defer persistence.ClosePool(ctx)
	_, err = db.Pool.Exec(ctx, `
		INSERT INTO package (id, name, created_at) VALUES ('old', 'go-1.9', NOW()), ('new', 'go-1.10', NOW());
		INSERT INTO package_family (id, name, created_at, updated_at, check_for_updates_at)
		VALUES ('go', 'go', NOW(), NOW(), NOW());
		INSERT INTO package_family_package (package_family_id, package_id, version_major, version_minor, created_at)
		VALUES ('go', 'old', 1, 9, NOW()), ('go', 'new', 1, 10, NOW());
		INSERT INTO package_version (id, package_id, version, apk_release, created_at)
		VALUES ('old-version', 'old', '1.9.0', 99, NOW()), ('new-version', 'new', '1.10.0', 0, NOW() - INTERVAL '1 day');
		INSERT INTO image (id, name, created_at) VALUES ('go-image', 'go', NOW());
		INSERT INTO image_apko (id, image_id, name, tags, created_at, updated_at)
		VALUES ('old', 'go-image', 'old', ARRAY['1.9.0'], NOW(), NOW()),
		       ('new', 'go-image', 'new', ARRAY['latest', '1.10', '1.10.0'], NOW() - INTERVAL '1 day', NOW());
	`)
	require.NoError(t, err)

	require.NoError(t, buildpriority.Backfill(ctx, db.Pool))

	for _, channel := range []string{"build_package", "build_apko"} {
		t.Run(channel, func(t *testing.T) {
			reset := func(workers int) *queueProcessor {
				_, err := db.Pool.Exec(ctx, `DELETE FROM work_queue`)
				require.NoError(t, err)
				return &queueProcessor{channel: channel, maxWorkers: workers, workerPool: make(chan struct{}, workers), maxDuration: time.Hour}
			}
			sequence := 0
			enqueue := func(id, target string, priority interface{}) {
				sequence++
				payload := fmt.Sprintf(`{"packageId":%q,"packageVersionId":%q,"apkoId":%q}`, target, target+"-version", target)
				_, err := db.Pool.Exec(ctx, `INSERT INTO work_queue (id, channel, payload, created_at, priority)
					VALUES ($1, $2, $3, TIMESTAMPTZ '2026-01-01' + $4 * INTERVAL '1 second', $5)`,
					id, channel, payload, sequence, priority)
				require.NoError(t, err)
			}
			claim := func(p *queueProcessor) []queueMessage {
				messages, err := (&Listener{}).fetchAndLockMessages(ctx, p)
				require.NoError(t, err)
				return messages
			}
			ids := func(messages []queueMessage) []string {
				result := make([]string, len(messages))
				for i, msg := range messages {
					result[i] = msg.id
				}
				return result
			}

			t.Run("priority version FIFO and returned batch order", func(t *testing.T) {
				p := reset(4)
				enqueue("old-first", "old", nil)
				enqueue("new-first", "new", 0)
				enqueue("new-second", "new", 0)
				enqueue("manual-old", "old", 1)
				require.Equal(t, []string{"manual-old", "new-first", "new-second", "old-first"}, ids(claim(p)))
				require.Empty(t, claim(p), "in-flight jobs must not be claimed again")
			})
			t.Run("saturation leaves newer arrivals eligible", func(t *testing.T) {
				p := reset(1)
				p.workerPool <- struct{}{}
				enqueue("old-first", "old", 0)
				require.Empty(t, claim(p))
				enqueue("new-arrival", "new", 0)
				<-p.workerPool
				require.Equal(t, []string{"new-arrival"}, ids(claim(p)))
				require.Equal(t, []string{"old-first"}, ids(claim(p)), "older work still drains")
			})
			t.Run("handler completion immediately admits newest pending work", func(t *testing.T) {
				reset(1)
				runCtx, cancel := context.WithCancel(ctx)
				started := make(chan string, 3)
				release := make(chan struct{})
				l := NewListener(ctx)
				require.NoError(t, l.AddHandler(ctx, channel, 1, time.Hour, func(ctx context.Context, notification *pgconn.Notification) error {
					var payload struct {
						PackageID string `json:"packageId"`
					}
					if err := json.Unmarshal([]byte(notification.Payload), &payload); err != nil {
						return err
					}
					started <- payload.PackageID
					select {
					case <-release:
						return nil
					case <-ctx.Done():
						return ctx.Err()
					}
				}))
				p := l.processors[channel]
				defer func() {
					cancel()
					require.Eventually(t, func() bool { return !p.processing.Load() && len(p.workerPool) == 0 }, 2*time.Second, 10*time.Millisecond)
				}()
				expectStart := func(target string) {
					t.Helper()
					select {
					case got := <-started:
						require.Equal(t, target, got)
					case <-time.After(2 * time.Second):
						t.Fatal("handler did not start promptly after capacity became available")
					}
				}
				enqueue("running", "old", 0)
				// Run only this processor: no notifications or scheduled poll can
				// mask a missing handler-completion signal.
				l.startQueueProcessor(runCtx, p)
				expectStart("old")
				enqueue("old-pending", "old", 0)
				enqueue("new-pending", "new", 0)
				var claimed int
				require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue
                    WHERE id IN ('old-pending', 'new-pending') AND processing_started_at IS NOT NULL`).Scan(&claimed))
				require.Zero(t, claimed, "saturated processors must leave pending jobs unclaimed")
				release <- struct{}{}
				expectStart("new")
				release <- struct{}{}
				expectStart("old")
				release <- struct{}{}
			})
			t.Run("locked jobs are skipped and expired jobs retry", func(t *testing.T) {
				p := reset(1)
				enqueue("old-first", "old", 0)
				enqueue("new-locked", "new", 0)
				tx, err := db.Pool.Begin(ctx)
				require.NoError(t, err)
				defer tx.Rollback(ctx)
				_, err = tx.Exec(ctx, `SELECT id FROM work_queue WHERE id = 'new-locked' FOR UPDATE`)
				require.NoError(t, err)
				require.Equal(t, []string{"old-first"}, ids(claim(p)))
				require.NoError(t, tx.Rollback(ctx))
				_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET processing_started_at = NOW() - INTERVAL '2 hours', attempt_count = 2 WHERE id = 'new-locked'`)
				require.NoError(t, err)
				messages := claim(p)
				require.Equal(t, []string{"new-locked"}, ids(messages))
				require.Equal(t, 3, messages[0].attemptCount)
			})
			t.Run("deleted metadata does not wedge queue", func(t *testing.T) {
				p := reset(1)
				enqueue("missing", "deleted", 0)
				require.Equal(t, []string{"missing"}, ids(claim(p)))
			})
			t.Run("scheduled retries wait until due before ranking", func(t *testing.T) {
				p := reset(1)
				enqueue("old-ready", "old", 0)
				enqueue("new-delayed", "new", 0)
				_, err := db.Pool.Exec(ctx, `UPDATE work_queue SET next_attempt_at = NOW() + INTERVAL '1 hour' WHERE id = 'new-delayed'`)
				require.NoError(t, err)
				require.Equal(t, []string{"old-ready"}, ids(claim(p)))
				require.Empty(t, claim(p))
				_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET next_attempt_at = NOW() WHERE id = 'new-delayed'`)
				require.NoError(t, err)
				require.Equal(t, []string{"new-delayed"}, ids(claim(p)))
			})
			t.Run("newest beyond first FIFO batch", func(t *testing.T) {
				p := reset(1)
				for i := 0; i < 650; i++ {
					enqueue(fmt.Sprintf("old-%02d", i), "old", 0)
				}
				enqueue("new-last", "new", 0)
				require.Equal(t, []string{"new-last"}, ids(claim(p)))
			})
			if channel == "build_package" {
				t.Run("unspecified package version uses latest upstream version", func(t *testing.T) {
					p := reset(1)
					enqueue("old-first", "old", 0)
					enqueue("new-unspecified", "new", 0)
					_, err := db.Pool.Exec(ctx, `UPDATE work_queue SET payload = payload - 'packageVersionId' WHERE id = 'new-unspecified'`)
					require.NoError(t, err)
					require.Equal(t, []string{"new-unspecified"}, ids(claim(p)))
				})
			}
		})
	}
	t.Run("other channels retain priority and FIFO", func(t *testing.T) {
		_, err := db.Pool.Exec(ctx, `DELETE FROM work_queue;
			INSERT INTO work_queue (id, channel, payload, created_at, priority) VALUES
			('first', 'scan_image', '{}', NOW() - INTERVAL '3 seconds', NULL),
			('second', 'scan_image', '{}', NOW() - INTERVAL '2 seconds', 0),
			('high', 'scan_image', '{}', NOW(), 1)`)
		require.NoError(t, err)
		p := &queueProcessor{channel: "scan_image", maxWorkers: 3, workerPool: make(chan struct{}, 3), maxDuration: time.Hour}
		messages, err := (&Listener{}).fetchAndLockMessages(ctx, p)
		require.NoError(t, err)
		require.Len(t, messages, 3)
		require.Equal(t, "high", messages[0].id)
		require.Equal(t, "first", messages[1].id)
		require.Equal(t, "second", messages[2].id)
	})
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
	t.Run("tag reassignment refreshes both owners without a backfill", func(t *testing.T) {
		require.NoError(t, assignImageAPKOTags(ctx, "go-image", "old", []string{"1.10", "1.10.0"}))
		var oldKey, newKey string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT version_sort_key FROM image_apko WHERE id = 'old'`).Scan(&oldKey))
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT version_sort_key FROM image_apko WHERE id = 'new'`).Scan(&newKey))
		require.Equal(t, buildpriority.VersionKey("1.10.0"), oldKey)
		require.Empty(t, newKey, "old owner only has latest remaining and must fall back to FIFO")
	})
	t.Run("stale tag keys fall back until repaired", func(t *testing.T) {
		_, err := db.Pool.Exec(ctx, `UPDATE image_apko SET tags = ARRAY['1.9.1'] WHERE id = 'old'`)
		require.NoError(t, err)
		var stale bool
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT version_sort_tags IS DISTINCT FROM tags FROM image_apko WHERE id = 'old'`).Scan(&stale))
		require.True(t, stale)
		_, err = db.Pool.Exec(ctx, `UPDATE image_apko SET tags = ARRAY['2.0.0'],
            version_sort_tags = ARRAY['2.0.0'], version_sort_key = $1 WHERE id = 'new'`, buildpriority.VersionKey("2.0.0"))
		require.NoError(t, err)
		_, err = db.Pool.Exec(ctx, `DELETE FROM work_queue;
            INSERT INTO work_queue (id, channel, payload, created_at) VALUES
            ('stale', 'build_apko', '{"apkoId":"old"}', NOW() - INTERVAL '1 second'),
            ('rolling', 'build_apko', '{"apkoId":"new"}', NOW())`)
		require.NoError(t, err)
		conn := persistence.MustGetPooledPostgresSession(ctx)
		defer conn.Release()
		var rank int
		require.NoError(t, conn.QueryRow(ctx, `WITH `+buildOrderCTE("build_apko")+`result AS (SELECT * FROM build_order) SELECT version_rank FROM result WHERE id = 'stale'`, "build_apko", "1 hour").Scan(&rank))
		require.Zero(t, rank)
		require.NoError(t, buildpriority.Backfill(ctx, db.Pool))
		var key string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT version_sort_key FROM image_apko WHERE id = 'old' AND version_sort_tags = tags`).Scan(&key))
		require.Equal(t, buildpriority.VersionKey("1.9.1"), key)
	})
	t.Run("backfill reports skipped locks resumes and is idempotent", func(t *testing.T) {
		_, err := db.Pool.Exec(ctx, `INSERT INTO image_apko (id, image_id, name, tags, created_at, updated_at)
            SELECT 'backfill-' || n, 'go-image', 'backfill-' || n,
                CASE WHEN n = 1 THEN ARRAY['nightly'] ELSE ARRAY['1.9.1'] END, NOW(), NOW()
            FROM generate_series(1, 1101) n`)
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
