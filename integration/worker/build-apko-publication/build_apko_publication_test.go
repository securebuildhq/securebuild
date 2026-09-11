package build_apko_publication

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

// Exercise the real APKO handler, PostgreSQL queue, image records, and
// downstream dispatch. Only VM acquisition is replaced; no build is launched.
func TestBuildAPKORepositoryRetryLifecycle(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	t.Cleanup(func() { testutil.TeardownTestDatabase(ctx, t, db) })

	var stage atomic.Int32
	index := publicationTestIndex(t, "example", "10.3.1-r2")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch stage.Load() {
		case 0:
			http.Error(w, "temporary outage", http.StatusServiceUnavailable)
		case 1:
			if r.URL.Path == "/x86_64/APKINDEX.tar.gz" {
				http.NotFound(w, r)
				return
			}
			_, _ = w.Write(index)
		default:
			_, _ = w.Write(index)
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

	l := listener.NewListener(ctx)
	listener.StartBuildAPKOListener(ctx, l)
	listenerCtx, cancel := context.WithCancel(ctx)
	require.NoError(t, l.Start(listenerCtx))
	t.Cleanup(func() {
		cancel()
		_ = l.Stop(ctx)
	})

	payload, err := json.Marshal(listener.BuildAPKOPayload{
		ImageID: "image",
		APKOID:  "apko",
		TriggerPackage: listener.BuildAPKOTriggerPackage{
			Name: "example", Version: "10.3.1", APKRelease: 2,
		},
	})
	require.NoError(t, err)
	require.NoError(t, persistence.EnqueueWork(ctx, "build_apko", string(payload)))

	var queueID string
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT id FROM work_queue WHERE channel = 'build_apko'`).Scan(&queueID))

	for _, currentStage := range []int32{0, 1} {
		stage.Store(currentStage)
		require.Eventually(t, func() bool {
			var waiting bool
			queryErr := db.Pool.QueryRow(ctx, `
				SELECT processing_started_at IS NULL
					AND completed_at IS NULL
					AND next_attempt_at > NOW()
				FROM work_queue WHERE id = $1`, queueID).Scan(&waiting)
			return queryErr == nil && waiting
		}, 10*time.Second, 10*time.Millisecond)

		assertNoImageWork(t, ctx, db, backend)
		var attemptCount int
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COALESCE(attempt_count, 0) FROM work_queue WHERE id = $1`, queueID).Scan(&attemptCount))
		require.Zero(t, attemptCount, "publication waits must not consume failure attempts")

		stage.Store(currentStage + 1)
		_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET next_attempt_at = NOW() WHERE id = $1`, queueID)
		require.NoError(t, err)
	}

	require.Eventually(t, func() bool {
		var complete bool
		queryErr := db.Pool.QueryRow(ctx, `
			SELECT completed_at IS NOT NULL AND last_error IS NULL
			FROM work_queue WHERE id = $1`, queueID).Scan(&complete)
		return queryErr == nil && complete
	}, 10*time.Second, 10*time.Millisecond)

	var queueRows, builds, dispatches int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel = 'build_apko'`).Scan(&queueRows))
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM image_build`).Scan(&builds))
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel = 'build_image_with_vm_assigned'`).Scan(&dispatches))
	require.Equal(t, 1, queueRows, "scheduled retries must reuse the original queue row")
	require.Equal(t, 1, builds)
	require.Equal(t, 1, dispatches)
	require.EqualValues(t, 1, backend.acquired.Load())
}

func assertNoImageWork(t *testing.T, ctx context.Context, db *testutil.TestDatabase, backend *publicationTestBackend) {
	t.Helper()
	var builds, dispatches int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM image_build`).Scan(&builds))
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel = 'build_image_with_vm_assigned'`).Scan(&dispatches))
	require.Zero(t, builds)
	require.Zero(t, dispatches)
	require.Zero(t, backend.acquired.Load())
}

func publicationTestIndex(t *testing.T, packageName, version string) []byte {
	t.Helper()
	content := []byte(fmt.Sprintf("P:%s\nV:%s\n\n", packageName, version))
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	require.NoError(t, tarWriter.WriteHeader(&tar.Header{Name: "APKINDEX", Mode: 0o644, Size: int64(len(content))}))
	_, err := tarWriter.Write(content)
	require.NoError(t, err)
	require.NoError(t, tarWriter.Close())
	require.NoError(t, gzipWriter.Close())
	return archive.Bytes()
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
