package apko_coalescing

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

var first = listener.BuildAPKOTriggerPackage{Name: "first", Version: "1", APKRelease: 0}
var second = listener.BuildAPKOTriggerPackage{Name: "second", Version: "2", APKRelease: 3}

func setup(t *testing.T, repository string) (context.Context, *testutil.TestDatabase) {
	t.Helper()
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	t.Cleanup(func() { testutil.TeardownTestDatabase(context.Background(), t, db) })
	require.NoError(t, testutil.ApplySchemaHero(ctx, db.ConnStr, filepath.Join("integration", "worker", "apko-coalescing", "testdata", "seed-data"), true))
	ctx = param.WithParam(ctx, &param.Param{DBURI: db.ConnStr, ApkRepository: repository})
	require.NoError(t, persistence.InitPostgres(ctx))
	t.Cleanup(func() { persistence.ClosePool(ctx) })
	return ctx, db
}
func payload(r listener.BuildAPKOTriggerPackage) listener.BuildAPKOPayload {
	return listener.BuildAPKOPayload{ImageID: "image", APKOID: "apko", TriggerPackage: &r}
}
func start(t *testing.T, ctx context.Context, l *listener.Listener) {
	t.Helper()
	runCtx, cancel := context.WithCancel(ctx)
	require.NoError(t, l.Start(runCtx))
	t.Cleanup(func() { cancel(); require.NoError(t, l.Stop(context.Background())) })
}
func completed(t *testing.T, ctx context.Context, db *testutil.TestDatabase, id string) {
	t.Helper()
	require.Eventually(t, func() bool {
		var done bool
		err := db.Pool.QueryRow(ctx, `SELECT completed_at IS NOT NULL AND last_error IS NULL FROM work_queue WHERE id=$1`, id).Scan(&done)
		return err == nil && done
	}, 15*time.Second, 10*time.Millisecond)
}
func enqueueMany(t *testing.T, ctx context.Context, r listener.BuildAPKOTriggerPackage, n int) {
	t.Helper()
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := listener.EnqueueBuildAPKO(ctx, payload(r)); errs <- err }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
}

func TestConcurrentBumpsAdoptLegacyRequests(t *testing.T) {
	t.Parallel()
	ctx, db := setup(t, "")
	raw, err := json.Marshal(payload(first))
	require.NoError(t, err)
	require.NoError(t, persistence.EnqueueWork(ctx, "build_apko", string(raw)))
	require.NoError(t, persistence.EnqueueWork(ctx, "build_apko", string(raw)))
	_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET priority=1,next_attempt_at=NOW()+INTERVAL '1 hour' WHERE channel='build_apko'`)
	require.NoError(t, err)
	enqueueMany(t, ctx, second, 32)
	var count int
	var rawMerged []byte
	var priority int
	var delayed bool
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel='build_apko' AND completed_at IS NULL`).Scan(&count))
	require.Equal(t, 1, count)
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT payload,priority,next_attempt_at>NOW() FROM work_queue WHERE channel='build_apko' AND completed_at IS NULL`).Scan(&rawMerged, &priority, &delayed))
	var merged listener.BuildAPKOPayload
	require.NoError(t, json.Unmarshal(rawMerged, &merged))
	require.ElementsMatch(t, []listener.BuildAPKOTriggerPackage{first, second}, merged.TriggerPackages)
	require.Equal(t, 1, priority)
	require.True(t, delayed)
	_, err = listener.EnqueueBuildAPKO(ctx, payload(second))
	require.NoError(t, err)
	var unchanged bool
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT payload=$1::jsonb FROM work_queue WHERE channel='build_apko' AND completed_at IS NULL`, string(rawMerged)).Scan(&unchanged))
	require.True(t, unchanged, "repeating a bump must not extend its publication wait")

	// A legacy retry can predate the keyed row. Keep the keyed row's timestamp:
	// (channel,created_at) is unique even for completed queue rows.
	require.NoError(t, persistence.EnqueueWork(ctx, "build_apko", string(raw)))
	_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET created_at=NOW()-INTERVAL '1 hour' WHERE completed_at IS NULL AND dedupe_key IS NULL`)
	require.NoError(t, err)
	_, err = listener.EnqueueBuildAPKO(ctx, payload(second))
	require.NoError(t, err)
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel='build_apko' AND completed_at IS NULL`).Scan(&count))
	require.Equal(t, 1, count)
	other := payload(first)
	other.APKOID = "other-apko"
	_, err = listener.EnqueueBuildAPKO(ctx, other)
	require.NoError(t, err)
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel='build_apko' AND completed_at IS NULL`).Scan(&count))
	require.Equal(t, 2, count, "different APKOs/tags must never merge")
}

func TestManualClaimedAndUnknownLegacyRequestsStaySeparate(t *testing.T) {
	t.Parallel()
	ctx, db := setup(t, "")
	raw, err := json.Marshal(payload(first))
	require.NoError(t, err)
	_, err = db.Pool.Exec(ctx, `
		INSERT INTO work_queue (id,channel,payload,created_at,processing_started_at) VALUES
		('manual','build_apko','{"imageId":"image","apkoId":"apko"}',NOW()-INTERVAL '4 hours',NULL),
		('future','build_apko',$1::jsonb || '{"unknownOption":true}',NOW()-INTERVAL '3 hours',NULL),
		('claimed','build_apko',$1::jsonb,NOW()-INTERVAL '2 hours',NOW()),
		('malformed','build_apko','{"imageId":"image","apkoId":"apko","triggerPackage":{}}',NOW()-INTERVAL '1 hour',NULL)
	`, string(raw))
	require.NoError(t, err)
	_, err = listener.EnqueueBuildAPKO(ctx, payload(second))
	require.NoError(t, err)
	var untouched int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE id IN ('manual','future','claimed','malformed') AND completed_at IS NULL AND dedupe_key IS NULL`).Scan(&untouched))
	require.Equal(t, 4, untouched)
	var queued int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel='build_apko' AND completed_at IS NULL`).Scan(&queued))
	require.Equal(t, 5, queued)
}

func TestAllRequirementsMustBePublishedBeforeDispatch(t *testing.T) {
	t.Parallel()
	var published atomic.Bool
	archive := index(t, first, second)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !published.Load() && r.URL.Path == "/x86_64/APKINDEX.tar.gz" {
			_, _ = w.Write(index(t, first))
			return
		}
		_, _ = w.Write(archive)
	}))
	t.Cleanup(server.Close)
	ctx, db := setup(t, server.URL)
	backend := &fakeBackend{}
	ctx = buildbackend.WithBackend(ctx, backend)
	id, err := listener.EnqueueBuildAPKO(ctx, payload(first))
	require.NoError(t, err)
	// An old queue entry must not immediately expire a newly merged requirement.
	_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET created_at=NOW()-INTERVAL '2 days' WHERE id=$1`, id)
	require.NoError(t, err)
	_, err = listener.EnqueueBuildAPKO(ctx, payload(second))
	require.NoError(t, err)
	l := listener.NewListener(ctx)
	listener.StartBuildAPKOListener(ctx, l)
	start(t, ctx, l)
	require.Eventually(t, func() bool {
		var waiting bool
		err := db.Pool.QueryRow(ctx, `SELECT completed_at IS NULL AND processing_started_at IS NULL AND next_attempt_at>NOW() FROM work_queue WHERE id=$1`, id).Scan(&waiting)
		return err == nil && waiting
	}, 10*time.Second, 10*time.Millisecond)
	var builds int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM image_build`).Scan(&builds))
	require.Zero(t, builds)
	require.Zero(t, backend.calls.Load())
	published.Store(true)
	_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET next_attempt_at=NOW() WHERE id=$1`, id)
	require.NoError(t, err)
	completed(t, ctx, db, id)
	require.EqualValues(t, 1, backend.calls.Load())
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel='build_image_with_vm_assigned'`).Scan(&builds))
	require.Equal(t, 1, builds)
}

func TestBumpsDuringDispatchScheduleExactlyOneFollowup(t *testing.T) {
	t.Parallel()
	archive := index(t, first, second)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(archive) }))
	t.Cleanup(server.Close)
	ctx, db := setup(t, server.URL)
	backend := &fakeBackend{entered: make(chan struct{}), release: make(chan struct{})}
	ctx = buildbackend.WithBackend(ctx, backend)
	id, err := listener.EnqueueBuildAPKO(ctx, payload(first))
	require.NoError(t, err)
	l := listener.NewListener(ctx)
	listener.StartBuildAPKOListener(ctx, l)
	start(t, ctx, l)
	select {
	case <-backend.entered:
	case <-time.After(10 * time.Second):
		t.Fatal("first dispatch did not acquire a machine")
	}
	enqueueMany(t, ctx, second, 32)
	var unfinished int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel='build_apko' AND completed_at IS NULL`).Scan(&unfinished))
	require.Equal(t, 1, unfinished)
	close(backend.release)
	completed(t, ctx, db, id)
	require.EqualValues(t, 2, backend.calls.Load(), "all mid-dispatch bumps require only one follow-up")
	var builds int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM image_build`).Scan(&builds))
	require.Equal(t, 2, builds)
	next, err := listener.EnqueueBuildAPKO(ctx, payload(second))
	require.NoError(t, err)
	require.NotEqual(t, id, next)
	completed(t, ctx, db, next)
	require.EqualValues(t, 3, backend.calls.Load(), "a bump after completion must create fresh work")
}

func TestMidDispatchBumpSurvivesErrorFinalization(t *testing.T) {
	for _, failure := range []string{"retry", "scheduled", "terminal", "expired"} {
		t.Run(failure, func(t *testing.T) {
			t.Parallel()
			ctx, db := setup(t, "")
			id, err := listener.EnqueueBuildAPKO(ctx, payload(first))
			require.NoError(t, err)
			if failure == "expired" {
				_, err = db.Pool.Exec(ctx, `UPDATE work_queue SET created_at=NOW()-INTERVAL '1 hour' WHERE id=$1`, id)
				require.NoError(t, err)
			}
			entered, release := make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			observed := make(chan []listener.BuildAPKOTriggerPackage, 1)
			l := listener.NewListener(ctx)
			require.NoError(t, l.AddHandler(ctx, "build_apko", 1, time.Minute, func(ctx context.Context, n *pgconn.Notification) error {
				var p listener.BuildAPKOPayload
				if err := json.Unmarshal([]byte(n.Payload), &p); err != nil {
					return err
				}
				if calls.Add(1) == 1 {
					close(entered)
					select {
					case <-release:
					case <-ctx.Done():
						return ctx.Err()
					}
					switch failure {
					case "scheduled", "expired":
						return listener.NewRetryAfterError(errors.New("waiting publication"), time.Second, time.Minute)
					case "terminal":
						return listener.NewNonRetryableError(errors.New("old request failed"))
					default:
						return errors.New("retry")
					}
				}
				observed <- p.TriggerPackages
				return nil
			}))
			start(t, ctx, l)
			select {
			case <-entered:
			case <-time.After(10 * time.Second):
				t.Fatal("handler not started")
			}
			_, err = listener.EnqueueBuildAPKO(ctx, payload(second))
			require.NoError(t, err)
			close(release)
			completed(t, ctx, db, id)
			require.EqualValues(t, 2, calls.Load())
			require.ElementsMatch(t, []listener.BuildAPKOTriggerPackage{first, second}, <-observed)
		})
	}
}

func index(t *testing.T, requirements ...listener.BuildAPKOTriggerPackage) []byte {
	t.Helper()
	var content bytes.Buffer
	for _, r := range requirements {
		fmt.Fprintf(&content, "P:%s\nV:%s-r%d\n\n", r.Name, r.Version, r.APKRelease)
	}
	var out bytes.Buffer
	gz := gzip.NewWriter(&out)
	tw := tar.NewWriter(gz)
	require.NoError(t, tw.WriteHeader(&tar.Header{Name: "APKINDEX", Mode: 0644, Size: int64(content.Len())}))
	_, err := tw.Write(content.Bytes())
	require.NoError(t, err)
	require.NoError(t, tw.Close())
	require.NoError(t, gz.Close())
	return out.Bytes()
}

type fakeBackend struct {
	calls            atomic.Int32
	entered, release chan struct{}
}

func (*fakeBackend) Type() buildbackend.BackendType        { return buildbackend.BackendStatic }
func (*fakeBackend) SeedMachinePool(context.Context) error { return nil }
func (*fakeBackend) AvailableArchitectures(context.Context) ([]string, error) {
	return []string{"aarch64"}, nil
}
func (b *fakeBackend) AcquireBuildMachine(ctx context.Context, _ buildbackend.AcquireOptions) (*buildbackend.BuildMachine, error) {
	if b.calls.Add(1) == 1 && b.entered != nil {
		close(b.entered)
		select {
		case <-b.release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return &buildbackend.BuildMachine{ID: "fixture-vm", WorkDir: "/tmp/coalescing-test"}, nil
}
