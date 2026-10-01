package worker_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/pkg/externalimage"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/stretchr/testify/require"
)

func TestScanPollerPreservesDispatchAfterFleetSnapshot(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL and SchemaHero")
	}
	for _, committed := range []bool{false, true} {
		t.Run(map[bool]string{false: "pending_download", true: "committed_scan"}[committed], func(t *testing.T) {
			downloading := make(chan struct{})
			unblockDownload := make(chan struct{})
			var releaseOnce sync.Once
			releaseDownload := func() { releaseOnce.Do(func() { close(unblockDownload) }) }
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(downloading)
				select {
				case <-unblockDownload:
				case <-r.Context().Done():
				}
				_, _ = w.Write([]byte("invalid gzip"))
			}))
			t.Cleanup(server.Close)
			ctx, db := setupScanDispatchTest(t, server.URL)
			cache, err := scan.InitScanCapacityCache(ctx)
			require.NoError(t, err)
			ctx = listener.WithScanCapacityCache(ctx, cache)
			applyScanDispatchFixture(t, ctx, db, "poller-builder")

			// Pause the real poller in SSH setup for an existing builder. Accepting
			// this connection proves its fleet query has already returned.
			tcp, err := net.Listen("tcp", "127.0.0.1:0")
			require.NoError(t, err)
			t.Cleanup(func() { _ = tcp.Close() })
			_, key, err := ed25519.GenerateKey(rand.Reader)
			require.NoError(t, err)
			keyBytes, err := x509.MarshalPKCS8PrivateKey(key)
			require.NoError(t, err)
			encoded := base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyBytes}))
			_, err = db.Pool.Exec(ctx, `UPDATE machine_pool SET private_key=$1,port=$2 WHERE id='poller-builder'`, encoded, tcp.Addr().(*net.TCPAddr).Port)
			require.NoError(t, err)
			accepted := make(chan net.Conn, 1)
			go func() {
				conn, err := tcp.Accept()
				if err == nil {
					accepted <- conn
				}
			}()
			pollResult := make(chan error, 1)
			pollDone := make(chan struct{})
			go func() { defer close(pollDone); pollResult <- listener.PollExternalImageScanStatus(ctx, cache) }()
			var connection net.Conn
			select {
			case connection = <-accepted:
			case <-time.After(10 * time.Second):
				t.Fatal("poller did not reach the SSH barrier")
			}
			t.Cleanup(func() {
				_ = connection.Close()
				select {
				case <-pollDone:
				case <-time.After(10 * time.Second):
					t.Error("poller did not stop")
				}
			})

			// This builder becomes selectable only after the old fleet query. Retire
			// the barrier builder so both dispatches must target the new busy builder.
			_, err = db.Pool.Exec(ctx, `UPDATE machine_pool SET status='stopped' WHERE id='poller-builder'`)
			require.NoError(t, err)
			applyScanDispatchFixture(t, ctx, db, "builder")
			if committed {
				reservation, err := scan.SelectBuilderForScan(ctx, cache)
				require.NoError(t, err)
				defer reservation.Release()
				claimed, err := externalimage.ClaimScanGeneration(ctx, dispatchDigest, []string{"x86_64", "aarch64"}, "new-launch", scan.ScanStalenessThreshold)
				require.NoError(t, err)
				require.True(t, claimed)
				reservation.Commit(scan.ScanDirInfo{Digest: dispatchDigest, ScanGenerationID: "new-launch", Architectures: []string{"x86_64", "aarch64"}})
			} else {
				handlerCtx, cancel := context.WithCancel(ctx)
				handlerDone := make(chan struct{})
				handlerResult := make(chan error, 1)
				go func() {
					defer close(handlerDone)
					handlerResult <- listener.HandleExternalImageScanOnBuilder(handlerCtx, dispatchPayload)
				}()
				t.Cleanup(func() {
					releaseDownload()
					cancel()
					select {
					case <-handlerDone:
					case <-time.After(10 * time.Second):
						t.Error("dispatch did not stop")
					}
				})
				select {
				case <-downloading:
				case <-time.After(10 * time.Second):
					t.Fatal("dispatch did not reach the SBOM download")
				}
				// Check cleanup at the end too, after the reservation has survived the poll.
				defer func() {
					releaseDownload()
					<-handlerDone
					require.Error(t, <-handlerResult)
					require.Zero(t, cache.GetTotalScanCount())
				}()
			}
			require.Equal(t, 1, cache.GetBuilderScanCount("dispatch-builder"))
			require.NoError(t, connection.Close())
			select {
			case <-pollDone:
			case <-time.After(10 * time.Second):
				t.Fatal("poller did not finish")
			}
			require.NoError(t, <-pollResult)
			require.Equal(t, 1, cache.GetBuilderScanCount("dispatch-builder"), "the older fleet list must not erase the dispatch")
			second, err := scan.SelectBuilderForScan(ctx, cache)
			if second != nil {
				defer second.Release()
			}
			require.ErrorIs(t, err, scan.ErrNoBuilderAvailable)
			if committed {
				var running int
				require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM external_image_scan WHERE digest=$1 AND status='running' AND current_scan_generation_id='new-launch'`, dispatchDigest).Scan(&running))
				require.Equal(t, 2, running, "the stale fleet list must not requeue a newer generation")
				// A later poll must still recover scans from a genuinely removed builder.
				_, err = db.Pool.Exec(ctx, `UPDATE machine_pool SET status='stopped' WHERE id='dispatch-builder'`)
				require.NoError(t, err)
				require.NoError(t, listener.PollExternalImageScanStatus(ctx, cache))
				require.Zero(t, cache.GetTotalScanCount())
				var queued int
				require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM external_image_scan WHERE digest=$1 AND status='queued' AND current_scan_generation_id IS NULL`, dispatchDigest).Scan(&queued))
				require.Equal(t, 2, queued)

			}
		})
	}
}
