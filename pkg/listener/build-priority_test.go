package listener

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
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
				conn := persistence.MustGetPooledPostgresSession(ctx)
				order, err := pendingBuildOrder(ctx, conn, p)
				conn.Release()
				require.NoError(t, err)
				require.Equal(t, []string{"old-ready"}, order)
				require.Equal(t, []string{"old-ready"}, ids(claim(p)))
				require.Empty(t, claim(p))
				_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET next_attempt_at = NOW() WHERE id = 'new-delayed'`)
				require.NoError(t, err)
				require.Equal(t, []string{"new-delayed"}, ids(claim(p)))
			})
			t.Run("newest beyond first FIFO batch", func(t *testing.T) {
				p := reset(1)
				for i := 0; i < 50; i++ {
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
}
