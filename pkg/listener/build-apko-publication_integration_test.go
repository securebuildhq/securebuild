//go:build integration

package listener

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

// Exercise the real APKO handler, PostgreSQL queue, image records, and downstream
// dispatch. Only VM acquisition is replaced; no build process is launched.
func TestBuildAPKORepositoryRetryLifecycle(t *testing.T) {
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	t.Cleanup(func() { testutil.TeardownTestDatabase(ctx, t, db) })

	var stage, requests atomic.Int32
	parentOnly := publicationTestIndex(t, "example")
	allOutputs := publicationTestIndex(t, "example", "example-cli")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		switch stage.Load() {
		case 0:
			http.Error(w, "temporary outage", http.StatusServiceUnavailable)
		case 1:
			_, _ = w.Write([]byte("incomplete index response"))
		case 2:
			_, _ = w.Write(parentOnly)
		case 3:
			if r.URL.Path == "/aarch64/APKINDEX.tar.gz" {
				_, _ = w.Write(allOutputs)
			} else {
				_, _ = w.Write(parentOnly)
			}
		default:
			_, _ = w.Write(allOutputs)
		}
	}))
	t.Cleanup(server.Close)
	ctx = param.WithParam(ctx, &param.Param{DBURI: db.ConnStr, ApkRepository: server.URL})
	backend := &publicationTestBackend{}
	ctx = buildbackend.WithBackend(ctx, backend)
	require.NoError(t, persistence.InitPostgres(ctx))
	t.Cleanup(func() { persistence.ClosePool(ctx) })
	_, err := db.Pool.Exec(ctx, `
		INSERT INTO image (id, name, created_at, updated_at) VALUES ('image', 'example', NOW(), NOW());
		INSERT INTO image_apko (id, image_id, name, tags, created_at, updated_at)
		VALUES ('apko', 'image', 'example', '{latest}', NOW(), NOW());
		INSERT INTO image_apko_version (id, image_apko_id, apko_yaml, created_at, updated_at)
		VALUES ('apko-version', 'apko', 'contents: {}', NOW(), NOW());
	`)
	require.NoError(t, err)
	payload, err := json.Marshal(BuildAPKOPayload{
		ImageID: "image", APKOID: "apko",
		TriggerPackage: &BuildAPKOTriggerPackage{
			PackagesByArchitecture: map[string][]string{
				"aarch64": {"example", "example-cli"}, "x86_64": {"example", "example-cli"},
			},
			Version: "10.3.1", APKRelease: 2,
		},
	})
	require.NoError(t, err)
	require.NoError(t, persistence.EnqueueWork(ctx, "build_apko", string(payload)))
	var originalID string
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT id FROM work_queue WHERE channel = 'build_apko'`).Scan(&originalID))

	// More than five 503s must not exhaust ordinary failure attempts. Then test
	// a malformed index, a missing subpackage, and a lagging second architecture.
	for _, nextStage := range []int32{0, 0, 0, 0, 0, 0, 1, 2, 3} {
		stage.Store(nextStage)
		l := NewListener(ctx)
		StartBuildAPKOListener(ctx, l)
		require.True(t, l.processMessagesForQueue(ctx, l.processors["build_apko"], false))
		require.Eventually(t, func() bool {
			var waiting bool
			queryErr := db.Pool.QueryRow(ctx, `SELECT processing_started_at IS NULL AND completed_at IS NULL AND next_attempt_at > NOW() FROM work_queue WHERE id = $1`, originalID).Scan(&waiting)
			return queryErr == nil && waiting
		}, 5*time.Second, 10*time.Millisecond)

		var failures, builds, dispatches int
		var nextAttempt time.Time
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COALESCE(attempt_count, 0), next_attempt_at FROM work_queue WHERE id = $1`, originalID).Scan(&failures, &nextAttempt))
		require.Zero(t, failures)
		require.Greater(t, time.Until(nextAttempt), 5*time.Second, "retry must be delayed, not immediately eligible")
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM image_build`).Scan(&builds))
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel = 'build_image_with_vm_assigned'`).Scan(&dispatches))
		require.Zero(t, builds)
		require.Zero(t, dispatches)
		require.Zero(t, backend.acquired.Load())

		// A fresh listener still observes the persisted delay. Advance only the
		// due time to exercise the next attempt without sleeping ten seconds.
		restarted := NewListener(ctx)
		StartBuildAPKOListener(ctx, restarted)
		before := requests.Load()
		require.False(t, restarted.processMessagesForQueue(ctx, restarted.processors["build_apko"], false))
		require.Equal(t, before, requests.Load())
		_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET next_attempt_at = NOW() WHERE id = $1`, originalID)
		require.NoError(t, err)
	}

	stage.Store(4)
	l := NewListener(ctx)
	StartBuildAPKOListener(ctx, l)
	require.True(t, l.processMessagesForQueue(ctx, l.processors["build_apko"], false))
	require.Eventually(t, func() bool {
		var complete bool
		queryErr := db.Pool.QueryRow(ctx, `SELECT completed_at IS NOT NULL AND last_error IS NULL FROM work_queue WHERE id = $1`, originalID).Scan(&complete)
		return queryErr == nil && complete
	}, 5*time.Second, 10*time.Millisecond)
	var rows, builds, dispatches int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel = 'build_apko'`).Scan(&rows))
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM image_build`).Scan(&builds))
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel = 'build_image_with_vm_assigned'`).Scan(&dispatches))
	require.Equal(t, 1, rows)
	require.Equal(t, 1, builds)
	require.Equal(t, 1, dispatches)
	require.EqualValues(t, 1, backend.acquired.Load())
	require.False(t, l.processMessagesForQueue(ctx, l.processors["build_apko"], false))

	// The real handler's publication timeout also bounds repository outages.
	stage.Store(0)
	require.NoError(t, persistence.EnqueueWork(ctx, "build_apko", string(payload)))
	_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET created_at = NOW() - INTERVAL '31 minutes' WHERE channel = 'build_apko' AND completed_at IS NULL`)
	require.NoError(t, err)
	require.True(t, l.processMessagesForQueue(ctx, l.processors["build_apko"], false))
	require.Eventually(t, func() bool {
		var failed bool
		queryErr := db.Pool.QueryRow(ctx, `SELECT completed_at IS NOT NULL AND last_error LIKE '%timed out%' FROM work_queue WHERE channel = 'build_apko' AND id <> $1`, originalID).Scan(&failed)
		return queryErr == nil && failed
	}, 5*time.Second, 10*time.Millisecond)
	require.EqualValues(t, 1, backend.acquired.Load())
}

type publicationTestBackend struct{ acquired atomic.Int32 }

func (*publicationTestBackend) Type() buildbackend.BackendType        { return buildbackend.BackendStatic }
func (*publicationTestBackend) SeedMachinePool(context.Context) error { return nil }
func (*publicationTestBackend) AvailableArchitectures(context.Context) ([]string, error) {
	return []string{"aarch64"}, nil
}
func (b *publicationTestBackend) AcquireBuildMachine(context.Context, buildbackend.AcquireOptions) (*buildbackend.BuildMachine, error) {
	b.acquired.Add(1)
	return &buildbackend.BuildMachine{ID: "test-vm", WorkDir: "/tmp/test-image-build"}, nil
}
