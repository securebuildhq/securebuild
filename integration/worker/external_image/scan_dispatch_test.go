package worker_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/externalimage"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/stretchr/testify/require"
)

const dispatchDigest = "sha256:dispatch-capacity"
const dispatchPayload = `{"digest":"sha256:dispatch-capacity"}`

func setupScanDispatchTest(t *testing.T, endpoint string) (context.Context, *testutil.TestDatabase) {
	t.Helper()
	if testing.Short() {
		t.Skip("requires PostgreSQL and SchemaHero")
	}
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	t.Cleanup(func() { testutil.TeardownTestDatabase(ctx, t, db) })
	ctx = context.WithValue(ctx, param.ParamContextKey, &param.Param{
		DBURI: db.ConnStr, R2Endpoint: endpoint, R2ImageScansBucketName: "scans",
		R2AccessKey: "test", R2SecretKey: "test", R2UsePathStyle: true, MaxScansPerBuilder: 16,
	})
	require.NoError(t, persistence.InitPostgres(ctx))
	t.Cleanup(func() { persistence.ClosePool(ctx) })
	applyScanDispatchFixture(t, ctx, db, "metadata")
	return ctx, db
}

func applyScanDispatchFixture(t *testing.T, ctx context.Context, db *testutil.TestDatabase, name string) {
	t.Helper()
	root, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, db.ConnStr, filepath.Join(root, "integration/worker/external_image/testdata/scan-dispatch", name), true))
}

func TestSBOMDownloadsReleaseDatabaseConnection(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL and SchemaHero")
	}
	var handler http.HandlerFunc
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handler(w, r) }))
	defer server.Close()
	ctx, _ := setupScanDispatchTest(t, server.URL)
	var body bytes.Buffer
	gz := gzip.NewWriter(&body)
	_, err := gz.Write([]byte(`{"artifacts":[]}`))
	require.NoError(t, err)
	require.NoError(t, gz.Close())
	// Leave one connection for metadata. The object-store callback must be able
	// to acquire that same last connection while the download is still pending.
	for range 39 {
		conn, err := persistence.GetPooledPostgresSession(ctx)
		require.NoError(t, err)
		defer conn.Release()
	}
	for _, plural := range []bool{false, true} {
		t.Run(map[bool]string{false: "single", true: "all_architectures"}[plural], func(t *testing.T) {
			acquired := make(chan error, 2)
			handler = func(w http.ResponseWriter, r *http.Request) {
				acquireCtx, cancel := context.WithTimeout(ctx, time.Second)
				defer cancel()
				conn, err := persistence.GetPooledPostgresSession(acquireCtx)
				if err == nil {
					conn.Release()
				}
				acquired <- err
				_, _ = w.Write(body.Bytes())
			}
			downloadCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			count := 1
			if plural {
				sboms, err := externalimage.GetExternalImageSBOMs(downloadCtx, dispatchDigest)
				require.NoError(t, err)
				require.Len(t, sboms, 2)
				require.Equal(t, []string{"aarch64", "x86_64"}, []string{sboms[0].Arch, sboms[1].Arch})
				for _, sbom := range sboms {
					require.Equal(t, `{"artifacts":[]}`, sbom.SBOM)
					require.Equal(t, "syft", sbom.Source)
				}
				count = 2
			} else {
				sbom, err := externalimage.GetExternalImageSBOM(downloadCtx, dispatchDigest)
				require.NoError(t, err)
				require.NotNil(t, sbom)
				require.Equal(t, `{"artifacts":[]}`, *sbom)
			}
			for range count {
				select {
				case err := <-acquired:
					require.NoError(t, err, "SBOM download must not hold the last Postgres connection")
				default:
					t.Fatal("object-store request was not observed")
				}
			}
		})
	}
}

func TestScanDispatchReservesBeforeDownloading(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL and SchemaHero")
	}
	var requests atomic.Int32
	var handler http.HandlerFunc
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); handler(w, r) }))
	defer server.Close()
	ctx, db := setupScanDispatchTest(t, server.URL)
	cache, err := scan.InitScanCapacityCache(ctx) // No builders yet: no SSH during initialization.
	require.NoError(t, err)
	ctx = listener.WithScanCapacityCache(ctx, cache)
	assertQueued := func(t *testing.T) {
		t.Helper()
		var queued int
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM external_image_scan WHERE digest=$1 AND status='queued' AND current_scan_generation_id IS NULL`, dispatchDigest).Scan(&queued))
		require.Equal(t, 2, queued)
	}
	t.Run("no builders", func(t *testing.T) {
		require.NoError(t, listener.HandleExternalImageScanOnBuilder(ctx, dispatchPayload))
		require.Zero(t, requests.Load())
		assertQueued(t)
	})
	applyScanDispatchFixture(t, ctx, db, "builder")
	t.Run("busy builder at capacity", func(t *testing.T) {
		cache.SetBuilderScans("dispatch-builder", []scan.ScanDirInfo{{Digest: "existing"}}, time.Now())
		require.NoError(t, listener.HandleExternalImageScanOnBuilder(ctx, dispatchPayload))
		require.Zero(t, requests.Load())
		assertQueued(t)
		cache.SetBuilderScans("dispatch-builder", nil, time.Now())
	})
	t.Run("reservation survives refresh and releases on download failure", func(t *testing.T) {
		observed := make(chan error, 1)
		handler = func(w http.ResponseWriter, r *http.Request) {
			cache.SetBuilderScans("dispatch-builder", nil, time.Now())
			reservation, err := scan.SelectBuilderForScan(ctx, cache)
			if reservation != nil {
				reservation.Release()
			}
			observed <- err
			_, _ = w.Write([]byte("invalid gzip"))
		}
		require.Error(t, listener.HandleExternalImageScanOnBuilder(ctx, dispatchPayload))
		require.ErrorIs(t, <-observed, scan.ErrNoBuilderAvailable)
		require.Zero(t, cache.GetTotalScanCount())
		assertQueued(t)
	})
	t.Run("cancelled download releases reservation", func(t *testing.T) {
		cancelCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		handler = func(w http.ResponseWriter, r *http.Request) { cancel(); <-r.Context().Done() }
		require.Error(t, listener.HandleExternalImageScanOnBuilder(cancelCtx, dispatchPayload))
		require.Zero(t, cache.GetTotalScanCount())
		assertQueued(t)
	})
	t.Run("failed builder connection releases reservation and requeues", func(t *testing.T) {
		var body bytes.Buffer
		gz := gzip.NewWriter(&body)
		_, err := gz.Write([]byte(`{"artifacts":[]}`))
		require.NoError(t, err)
		require.NoError(t, gz.Close())
		handler = func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body.Bytes()) }
		require.Error(t, listener.HandleExternalImageScanOnBuilder(ctx, dispatchPayload))
		require.Zero(t, cache.GetTotalScanCount())
		assertQueued(t)
	})
	t.Run("lost database claim releases reservation", func(t *testing.T) {
		var body bytes.Buffer
		gz := gzip.NewWriter(&body)
		_, err := gz.Write([]byte(`{"artifacts":[]}`))
		require.NoError(t, err)
		require.NoError(t, gz.Close())
		claimErrors := make(chan error, 2)
		handler = func(w http.ResponseWriter, r *http.Request) {
			_, err := db.Pool.Exec(ctx, `UPDATE external_image_scan SET status='running',scan_status_updated_at=NOW(),current_scan_generation_id='other-dispatch' WHERE digest=$1`, dispatchDigest)
			claimErrors <- err
			_, _ = w.Write(body.Bytes())
		}
		require.NoError(t, listener.HandleExternalImageScanOnBuilder(ctx, dispatchPayload))
		require.NoError(t, <-claimErrors)
		require.NoError(t, <-claimErrors)
		require.Zero(t, cache.GetTotalScanCount())
		var running int
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM external_image_scan WHERE digest=$1 AND status='running' AND current_scan_generation_id='other-dispatch'`, dispatchDigest).Scan(&running))
		require.Equal(t, 2, running)
	})
}
