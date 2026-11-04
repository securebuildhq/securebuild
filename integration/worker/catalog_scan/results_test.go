package catalog_scan_test

import (
	"context"
	"fmt"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/stretchr/testify/require"
)

func TestCatalogScanStoresResultsWithOptionalAlternateImage(t *testing.T) {
	for _, name := range []string{"null-alternate", "empty-alternate", "configured-alternate"} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			ctx, db := setupCatalogScanTest(t, 1)
			root, err := testutil.FindProjectRoot()
			require.NoError(t, err)
			require.NoError(t, testutil.ApplySchemaHero(ctx, db.ConnStr,
				filepath.Join(root, "integration", "worker", "catalog_scan", "testdata", "scan-results"), true))

			const standardResult = `{"matches":[],"descriptor":{"name":"grype","version":"standard-test"}}`
			const alternateResult = `{"matches":[],"descriptor":{"name":"grype","version":"alternate-test"}}`
			var standardCalls, customCalls atomic.Int32
			ctx = listener.WithMockCatalogSBOMScanner(ctx, func(_ context.Context, x86, arm string, custom bool) (map[string]string, error) {
				if x86 != `{"artifacts":[]}` || arm != `{"artifacts":[]}` {
					return nil, fmt.Errorf("expected both stored SBOMs, got x86=%q arm=%q", x86, arm)
				}
				if custom {
					customCalls.Add(1)
				} else {
					standardCalls.Add(1)
				}
				return map[string]string{"x86_64": standardResult, "aarch64": standardResult}, nil
			})

			l := listener.NewListener(ctx)
			listener.StartScanCatalogImageListener(ctx, l)
			listenerCtx, cancel := context.WithCancel(ctx)
			defer cancel()
			require.NoError(t, l.Start(listenerCtx))
			defer func() {
				cancel()
				require.NoError(t, l.Stop(ctx))
			}()

			catalogID := "scan-" + name
			startedAt := time.Now().UTC()
			enqueued, err := persistence.EnqueueUniqueWork(ctx, "scan_catalog_image", listener.ScanCatalogImagePayload{
				CatalogImageID: catalogID, ImageName: name, ImageTag: "latest",
			}, catalogID)
			require.NoError(t, err)
			require.True(t, enqueued)

			require.Eventually(t, func() bool {
				var completed bool
				err := db.Pool.QueryRow(ctx, `
					SELECT completed_at IS NOT NULL AND last_error IS NULL AND dedupe_key IS NULL
					FROM work_queue WHERE channel = 'scan_catalog_image' AND payload->>'catalogImageId' = $1
				`, catalogID).Scan(&completed)
				return err == nil && completed
			}, 5*time.Second, 10*time.Millisecond)
			require.EqualValues(t, 1, standardCalls.Load(), "a successful scan must not retry")
			require.EqualValues(t, 1, customCalls.Load())

			var x86, arm string
			var alternateX86, alternateArm *string
			var scannedAt, nextScanAt time.Time
			require.NoError(t, db.Pool.QueryRow(ctx, `
				SELECT last_scan_result_x86, last_scan_result_aarch64,
				       last_scan_result_alternate_x86, last_scan_result_alternate_aarch64,
				       last_scanned_at, next_scan_at
				FROM image_catalog WHERE id = $1
			`, catalogID).Scan(&x86, &arm, &alternateX86, &alternateArm, &scannedAt, &nextScanAt))
			require.JSONEq(t, standardResult, x86)
			require.JSONEq(t, standardResult, arm)
			if name == "configured-alternate" {
				require.NotNil(t, alternateX86)
				require.NotNil(t, alternateArm)
				require.JSONEq(t, alternateResult, *alternateX86)
				require.JSONEq(t, alternateResult, *alternateArm)
			} else {
				require.Nil(t, alternateX86)
				require.Nil(t, alternateArm)
			}
			require.False(t, scannedAt.Before(startedAt))
			require.WithinRange(t, nextScanAt, startedAt.Add(23*time.Hour), time.Now().UTC().Add(25*time.Hour))
			require.Greater(t, nextScanAt.Sub(scannedAt), 22*time.Hour)

			_, err = db.Pool.Exec(ctx, `UPDATE image_catalog SET is_published = false WHERE id <> $1`, catalogID)
			require.NoError(t, err)
			require.NoError(t, scan.ProcessPeriodicScans(ctx))
			var queued int
			require.NoError(t, db.Pool.QueryRow(ctx, `
				SELECT count(*) FROM work_queue WHERE channel = 'scan_catalog_image' AND completed_at IS NULL
			`).Scan(&queued))
			require.Zero(t, queued, "the scheduler must leave the completed image fresh until its next scan")
		})
	}
}
