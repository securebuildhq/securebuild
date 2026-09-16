package build_priority_test

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/buildpriority"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

func setupDatabase(t *testing.T) (context.Context, *testutil.TestDatabase) {
	t.Helper()
	if testing.Short() {
		t.Skip("requires PostgreSQL in Docker and SchemaHero")
	}
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	t.Cleanup(func() { testutil.TeardownTestDatabase(context.Background(), t, db) })
	ctx, err := param.Init(param.InitSourceEnvironment, map[string]string{"DB_URI": db.ConnStr})
	require.NoError(t, err)
	require.NoError(t, persistence.InitPostgres(ctx))
	t.Cleanup(func() { persistence.ClosePool(ctx) })
	root, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, db.ConnStr,
		filepath.Join(root, "integration/worker/build-priority/testdata/seed-data"), true))
	require.NoError(t, buildpriority.Backfill(ctx, db.Pool))
	return ctx, db
}

type job struct {
	ID        string `json:"testId"`
	PackageID string `json:"packageId"`
	VersionID string `json:"packageVersionId,omitempty"`
	ApkoID    string `json:"apkoId"`
	Priority  int    `json:"-"`
}

func buildJob(id, target string, priority int) job {
	return job{ID: id, PackageID: target, VersionID: target + "-version", ApkoID: target, Priority: priority}
}

func enqueue(t *testing.T, ctx context.Context, channel string, jobs ...job) {
	t.Helper()
	for _, j := range jobs {
		require.NoError(t, persistence.EnqueueWorkWithPriority(ctx, channel, j, j.Priority))
	}
}

// Observe the real claim/dispatch/completion path. A single worker makes start
// order observable without relying on goroutine scheduling within a batch.
func startListener(t *testing.T, ctx context.Context, channel string, handler listener.NotificationHandler) {
	t.Helper()
	l := listener.NewListener(ctx)
	require.NoError(t, l.AddHandler(ctx, channel, 1, time.Hour, handler))
	runCtx, cancel := context.WithCancel(ctx)
	t.Cleanup(func() { cancel(); require.NoError(t, l.Stop(ctx)) })
	require.NoError(t, l.Start(runCtx))
}

func receive(t *testing.T, started <-chan string) string {
	t.Helper()
	select {
	case id := <-started:
		return id
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not start promptly")
	}
	return ""
}

func waitCompleted(t *testing.T, ctx context.Context, db *testutil.TestDatabase, count int) {
	t.Helper()
	// Handler return precedes the completion UPDATE. Canceling earlier races that
	// write and produces a context-canceled error instead of a completed job.
	require.Eventually(t, func() bool {
		var completed int
		err := db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue
   WHERE completed_at IS NOT NULL AND last_error IS NULL`).Scan(&completed)
		return err == nil && completed == count
	}, 10*time.Second, 10*time.Millisecond, "all jobs must be persisted successfully before stopping the listener")
}

func TestBuildPriorityClaims(t *testing.T) {
	ctx, db := setupDatabase(t)
	for _, channel := range []string{"build_package", "build_apko", "scan_image"} {
		t.Run(channel, func(t *testing.T) {
			type scenario struct {
				name string
				jobs []job
				want []string
			}
			scenarios := []scenario{
				{"manual priority and same-version FIFO", []job{
					buildJob("old-first", "old", 0), buildJob("new-first", "new", 0),
					buildJob("new-second", "new", 0), buildJob("manual-old", "old", 1),
				}, []string{"manual-old", "new-first", "new-second", "old-first"}},
				{"missing metadata stays runnable", []job{
					buildJob("missing", "deleted", 0), buildJob("old", "old", 0), buildJob("new", "new", 0),
				}, []string{"missing", "new", "old"}},
			}
			if channel == "scan_image" {
				scenarios = scenarios[:1]
				scenarios[0].want = []string{"manual-old", "old-first", "new-first", "new-second"}
			}
			if channel == "build_package" {
				soloNew := buildJob("solo-new", "solo", 0)
				soloNew.VersionID = "solo-new-version"
				unspecified := buildJob("new", "new", 0)
				unspecified.VersionID = ""
				scenarios = append(scenarios,
					scenario{"unmapped package ranks its own versions", []job{buildJob("solo-old", "solo", 0), soloNew}, []string{"solo-new", "solo-old"}},
					scenario{"unspecified version uses latest upstream", []job{buildJob("old", "old", 0), unspecified}, []string{"new", "old"}},
				)
			}
			if channel != "scan_image" {
				jobs := make([]job, 0, 651)
				want := []string{"new-last"}
				for i := 0; i < 650; i++ {
					id := fmt.Sprintf("old-%03d", i)
					jobs = append(jobs, buildJob(id, "old", 0))
					want = append(want, id)
				}
				jobs = append(jobs, buildJob("new-last", "new", 0))
				scenarios = append(scenarios, scenario{"newest beyond first FIFO batch", jobs, want})
			}
			for _, scenario := range scenarios {
				t.Run(scenario.name, func(t *testing.T) {
					_, err := db.Pool.Exec(ctx, `DELETE FROM work_queue`)
					require.NoError(t, err)
					enqueue(t, ctx, channel, scenario.jobs...)
					started := make(chan string, len(scenario.jobs))
					startListener(t, ctx, channel, func(ctx context.Context, n *pgconn.Notification) error {
						var j job
						if err := json.Unmarshal([]byte(n.Payload), &j); err != nil {
							return err
						}
						started <- j.ID
						return nil
					})
					var got []string
					for range scenario.jobs {
						got = append(got, receive(t, started))
					}
					waitCompleted(t, ctx, db, len(scenario.jobs))
					require.Equal(t, scenario.want, got)
				})
			}
		})
	}
}

func TestNewArrivalsWhileSaturated(t *testing.T) {
	ctx, db := setupDatabase(t)
	for _, channel := range []string{"build_package", "build_apko"} {
		t.Run(channel, func(t *testing.T) {
			_, err := db.Pool.Exec(ctx, `DELETE FROM work_queue`)
			require.NoError(t, err)
			enqueue(t, ctx, channel, buildJob("running", "old", 0))
			started := make(chan string, 3)
			release := make(chan struct{}, 3)
			startListener(t, ctx, channel, func(ctx context.Context, n *pgconn.Notification) error {
				var j job
				if err := json.Unmarshal([]byte(n.Payload), &j); err != nil {
					return err
				}
				started <- j.ID
				select {
				case <-release:
					return nil
				case <-ctx.Done():
					return ctx.Err()
				}
			})
			require.Equal(t, "running", receive(t, started))
			enqueue(t, ctx, channel, buildJob("old-pending", "old", 0), buildJob("new-pending", "new", 0))
			var claimed int
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue
    WHERE payload->>'testId' <> 'running' AND processing_started_at IS NOT NULL`).Scan(&claimed))
			require.Zero(t, claimed, "saturated workers must leave pending jobs unclaimed")
			release <- struct{}{}
			require.Equal(t, "new-pending", receive(t, started))
			release <- struct{}{}
			require.Equal(t, "old-pending", receive(t, started))
			release <- struct{}{}
			waitCompleted(t, ctx, db, 3)
		})
	}
}

func TestLockedAndScheduledBuilds(t *testing.T) {
	ctx, db := setupDatabase(t)
	for _, channel := range []string{"build_package", "build_apko"} {
		for _, state := range []string{"locked", "scheduled"} {
			t.Run(channel+"/"+state, func(t *testing.T) {
				_, err := db.Pool.Exec(ctx, `DELETE FROM work_queue`)
				require.NoError(t, err)
				enqueue(t, ctx, channel, buildJob("old-ready", "old", 0), buildJob("new-waiting", "new", 0))
				tx, err := db.Pool.Begin(ctx)
				require.NoError(t, err)
				defer tx.Rollback(ctx)
				if state == "locked" {
					// A prior worker died after claiming this row. Another transaction holds
					// its lock during recovery, so SKIP LOCKED must let older work proceed.
					_, err = tx.Exec(ctx, `UPDATE work_queue SET processing_started_at = NOW() - INTERVAL '2 hours', attempt_count = 2 WHERE payload->>'testId' = 'new-waiting'`)
				} else {
					_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET next_attempt_at = NOW() + INTERVAL '1 hour' WHERE payload->>'testId' = 'new-waiting'`)
				}
				require.NoError(t, err)
				started := make(chan string, 2)
				attempts := make(chan int, 2)
				startListener(t, ctx, channel, func(ctx context.Context, n *pgconn.Notification) error {
					var j job
					if err := json.Unmarshal([]byte(n.Payload), &j); err != nil {
						return err
					}
					attempt, _ := listener.GetAttemptInfo(ctx)
					attempts <- attempt
					started <- j.ID
					return nil
				})
				require.Equal(t, "old-ready", receive(t, started))
				require.Equal(t, 1, <-attempts)
				waitCompleted(t, ctx, db, 1)
				if state == "locked" {
					require.NoError(t, tx.Commit(ctx))
				} else {
					_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET next_attempt_at = NOW() WHERE payload->>'testId' = 'new-waiting'`)
					require.NoError(t, err)
				}
				_, err = db.Pool.Exec(ctx, `SELECT pg_notify($1, '')`, channel)
				require.NoError(t, err)
				require.Equal(t, "new-waiting", receive(t, started))
				expectedAttempt := 1
				if state == "locked" {
					expectedAttempt = 4
				}
				require.Equal(t, expectedAttempt, <-attempts)
				waitCompleted(t, ctx, db, 2)
			})
		}
	}
}
