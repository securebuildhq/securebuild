package listener

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/externalimage"
	image "github.com/securebuildhq/securebuild/pkg/image"
	"github.com/securebuildhq/securebuild/pkg/listener/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

// scanCacheContextKey is used to pass the ScanCapacityCache to the external
// image scan handler via context.
type scanCacheContextKey struct{}

// WithScanCapacityCache returns a context that carries the ScanCapacityCache.
func WithScanCapacityCache(ctx context.Context, cache *scan.ScanCapacityCache) context.Context {
	return context.WithValue(ctx, scanCacheContextKey{}, cache)
}

// getScanCapacityCache retrieves the ScanCapacityCache from context, or nil.
func getScanCapacityCache(ctx context.Context) *scan.ScanCapacityCache {
	cache, _ := ctx.Value(scanCacheContextKey{}).(*scan.ScanCapacityCache)
	return cache
}

// expectedArchs is the list of architectures that external image scans check for.
var expectedArchs = []string{"x86_64", "aarch64"}

// externalImageScanRecencyThreshold is the minimum age of a completed scan
// before it can be claimed for another dispatch. It matches the active-image
// rescan interval used by the scheduler.
const externalImageScanRecencyThreshold = 4 * time.Hour

// HandleExternalImageScanOnBuilder dispatches an external image CVE scan to a
// builder VM. It copies the SBOM to the builder, launches grype CLI via nohup
// for each architecture, and returns immediately. The scan status poller
// collects results asynchronously.
//
// Queue message lifecycle:
//   - Handler returns nil → message completed, grype runs async on builder
//   - Handler returns NonRetryableError → message completed with error, not retried
//   - Handler returns normal error → message retried by listener (e.g. no builder)
func HandleExternalImageScanOnBuilder(ctx context.Context, payloadJSON string) error {
	p := types.ExternalImageScanPayload{}
	if err := json.Unmarshal([]byte(payloadJSON), &p); err != nil {
		return fmt.Errorf("failed to unmarshal external image scan payload: %w", err)
	}

	if p.Digest == "" {
		return fmt.Errorf("external image scan payload missing digest")
	}

	cache := getScanCapacityCache(ctx)
	if cache == nil || !cache.IsReady() {
		return fmt.Errorf("scan capacity cache is not ready")
	}

	recent, err := externalimage.WasScannedRecently(ctx, p.Digest, externalImageScanRecencyThreshold)
	if err != nil {
		logger.Warn("failed to check scan recency, proceeding with scan",
			zap.String("digest", p.Digest),
			zap.Error(err))
	} else if recent {
		logger.Info("discarding external_image_scan message: scan completed within 4 hours",
			zap.String("digest", p.Digest))
		return nil
	}

	// Idempotency: check if a scan is already running for this digest.
	// The scheduler may enqueue duplicate work items before the status changes.
	if isScanAlreadyRunning(ctx, p.Digest) {
		logger.Info("discarding external_image_scan message: scan already running for digest",
			zap.String("digest", p.Digest))
		return nil
	}

	sboms, err := externalimage.GetExternalImageSBOMs(ctx, p.Digest)
	if err != nil {
		return fmt.Errorf("failed to get SBOMs for digest %s: %w", p.Digest, err)
	}

	sbomByArch := make(map[string]string)
	for _, s := range sboms {
		sbomByArch[s.Arch] = s.SBOM
	}

	if len(sbomByArch) == 0 {
		for _, arch := range expectedArchs {
			if err := externalimage.SetExternalImageScanStatus(ctx, externalimage.SetExternalImageScanStatusParams{
				Digest:            p.Digest,
				Arch:              arch,
				Status:            externalimage.ScanStatusFailed,
				ScanStatusMessage: "no SBOM found for this digest",
			}); err != nil {
				logger.Warn("failed to set scan status to failed for missing SBOM",
					zap.String("digest", p.Digest),
					zap.String("arch", arch),
					zap.Error(err))
			}
		}
		return NewNonRetryableError(fmt.Errorf("no SBOMs found for digest %s", p.Digest))
	}

	var archsToScan []string
	for _, arch := range expectedArchs {
		if _, hasSBOM := sbomByArch[arch]; hasSBOM {
			archsToScan = append(archsToScan, arch)
		}
		// Archs without SBOMs are silently skipped — images are not required
		// to have both architectures. No scan status row is written for them.
	}

	if len(archsToScan) == 0 {
		return NewNonRetryableError(fmt.Errorf("no architectures with SBOMs to scan for digest %s", p.Digest))
	}

	// Atomically claim eligible architectures. Rows that are already running
	// or that just completed are excluded by the claim query.
	claimedArchs, claimErr := claimScanForDispatch(ctx, p.Digest, archsToScan)
	if claimErr != nil {
		// DB error during claim — return error so the listener retries.
		return fmt.Errorf("failed to claim scan for dispatch: %w", claimErr)
	}
	if len(claimedArchs) == 0 {
		logger.Info("discarding external_image_scan message: no eligible architectures to claim",
			zap.String("digest", p.Digest))
		return nil
	}

	// If dispatch fails after the claim, revert the scan status to "queued"
	// so the scheduler can re-enqueue on the next cycle. A "no builder
	// available" failure is not an error — it's a normal capacity condition
	// that happens when all builders are full. We return nil so the message
	// is cleanly completed (not retried by the listener) and the scheduler
	// re-enqueues when capacity frees up.
	dispatchErr := dispatchScanToBuilder(ctx, cache, p.Digest, sbomByArch, claimedArchs)
	if dispatchErr != nil {
		if revertErr := revertScanToQueued(ctx, p.Digest, claimedArchs); revertErr != nil {
			// Revert failed — return the revert error so the listener retries
			// the message instead of acking it. Without this, the scan row
			// stays "running" with no builder work directory until the 1-hour
			// staleness window expires.
			return fmt.Errorf("dispatch failed (%v) and revert also failed: %w", dispatchErr, revertErr)
		}
		if errors.Is(dispatchErr, scan.ErrNoBuilderAvailable) {
			logger.Info("no builder available for scan, will retry on next scheduler cycle",
				zap.String("digest", p.Digest))
			return nil
		}
		return dispatchErr
	}

	return nil
}

// dispatchScanToBuilder handles builder selection, file copy, and grype launch.
// It reserves a capacity slot atomically and releases it if any step fails
// before the scan is fully launched.
//
// The dispatch is split into two phases:
//  1. Prepare all files (dirs, scan.json, sbom.json per arch) — if any step
//     fails, no grype processes have started, so reverting is safe.
//  2. Launch grype for all archs — if any launch fails, already-launched
//     grype processes are killed before returning, preventing orphaned
//     processes that would race with a retry on a different builder.
func dispatchScanToBuilder(ctx context.Context, cache *scan.ScanCapacityCache, digest string, sbomByArch map[string]string, archsToScan []string) error {
	span, ctx := telemetry.StartSpan(ctx, "listener.dispatch_scan_to_builder")
	defer span.Finish()

	builderVM, err := scan.SelectBuilderForScan(ctx, cache)
	if err != nil {
		return fmt.Errorf("failed to select builder for scan: %w", err)
	}

	// SelectBuilderForScan reserved a capacity slot. If we fail before the
	// scan files are written to the builder, release the slot. The poller
	// will resync the cache on the next cycle anyway, but this avoids
	// temporarily over-counting.
	slotReserved := true
	defer func() {
		if slotReserved {
			cache.ReleaseScanSlot(builderVM.ID)
		}
	}()

	workDir, err := scan.ResolveScanWorkDir(ctx, builderVM, digest)
	if err != nil {
		return fmt.Errorf("failed to resolve scan work dir: %w", err)
	}

	runner, err := buildbackend.NewRunner(ctx, builderVM)
	if err != nil {
		return fmt.Errorf("failed to create runner for builder %s: %w", builderVM.ID, err)
	}
	defer runner.Close()

	metadata := scan.ScanMetadata{
		Digest:     digest,
		CreatedAt:  time.Now().UTC(),
		RetryCount: 0,
	}

	// Phase 1: Prepare all files. If any step fails here, no grype processes
	// are running, so the caller can safely revert to "queued" and retry.
	// Clean up the work directory so the poller doesn't discover a stale
	// scan.json and treat it as live work.
	if err := prepareScanFiles(ctx, runner, workDir, metadata, archsToScan, sbomByArch); err != nil {
		cleanupScanDir(ctx, runner, workDir)
		return fmt.Errorf("failed to prepare scan files on builder %s: %w", builderVM.ID, err)
	}

	// Phase 2: Launch grype for all archs. If a launch fails after some
	// archs have already been launched, kill those processes and clean up
	// the work directory so the poller doesn't discover a stale scan.json
	// and treat it as live work that races with a retry on another builder.
	launchedArchs := make([]string, 0, len(archsToScan))
	for _, arch := range archsToScan {
		grypeCmd := buildGrypeLaunchCommand(workDir, arch)
		if _, err := runner.RunCommand(ctx, grypeCmd); err != nil {
			logger.Warn("failed to launch grype, cleaning up already-launched processes",
				zap.String("digest", digest),
				zap.String("arch", arch),
				zap.Strings("launchedArchs", launchedArchs),
				zap.Error(err))
			for _, launchedArch := range launchedArchs {
				killGrypeProcess(ctx, runner, workDir, launchedArch)
			}
			cleanupScanDir(ctx, runner, workDir)
			return fmt.Errorf("failed to launch grype for arch %s: %w", arch, err)
		}
		launchedArchs = append(launchedArchs, arch)
		logger.Info("launched grype scan on builder",
			zap.String("digest", digest),
			zap.String("arch", arch),
			zap.String("machineID", builderVM.ID),
			zap.String("workDir", workDir))
	}

	// Scan successfully launched. Add the scan to the cache's scans map
	// so the running metric reflects it immediately, without waiting for
	// the poller to discover it on the filesystem. The poller's
	// SetBuilderScans call will reconcile on the next cycle.
	slotReserved = false
	cache.AddScan(builderVM.ID, scan.ScanDirInfo{
		Digest:    digest,
		WorkDir:   workDir,
		CreatedAt: metadata.CreatedAt,
	})

	logger.Info("dispatched external image scan to builder",
		zap.String("digest", digest),
		zap.Int("archs", len(archsToScan)),
		zap.String("machineID", builderVM.ID))

	return nil
}

// prepareScanFiles creates the scan work directory, writes scan.json, and
// copies SBOM files for each architecture. If this function returns an error,
// no grype processes have been started, so the caller can safely revert.
func prepareScanFiles(ctx context.Context, runner buildbackend.Runner, workDir string, metadata scan.ScanMetadata, archsToScan []string, sbomByArch map[string]string) error {
	if err := runner.MkdirAll(workDir); err != nil {
		return fmt.Errorf("failed to create scan work dir %s: %w", workDir, err)
	}

	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("failed to marshal scan metadata: %w", err)
	}

	scanJSONPath := filepath.Join(workDir, "scan.json")
	if err := runner.WriteFile(scanJSONPath, string(metadataJSON)); err != nil {
		return fmt.Errorf("failed to write scan.json: %w", err)
	}

	for _, arch := range archsToScan {
		archDir := filepath.Join(workDir, arch)
		outputDir := filepath.Join(archDir, "output")
		if err := runner.MkdirAll(outputDir); err != nil {
			return fmt.Errorf("failed to create output dir %s: %w", outputDir, err)
		}

		sbomPath := filepath.Join(archDir, "sbom.json")
		if err := runner.WriteFile(sbomPath, sbomByArch[arch]); err != nil {
			return fmt.Errorf("failed to write sbom.json for arch %s: %w", arch, err)
		}
	}

	return nil
}

// buildGrypeLaunchCommand constructs the nohup shell command that runs grype
// in the background on the builder. Grype scans the SBOM file and writes:
//   - grype-scan.json (grype JSON output)
//   - output/exit_code (grype exit code: 0=success)
//   - output/grype.stderr (grype stderr)
//   - output/grype.pid (actual grype process PID, not the bash wrapper)
//
// The command backgrounds grype as a child of the bash wrapper, captures its
// PID, then waits for it to finish and records the exit code. This ensures
// grype.pid contains the real grype PID so the timeout killer can target the
// correct process.
func buildGrypeLaunchCommand(workDir, arch string) string {
	archDir := filepath.Join(workDir, arch)
	return fmt.Sprintf(`nohup bash -c '
  cd %q
  grype sbom:./sbom.json --output json > grype-scan.json 2> output/grype.stderr &
  grype_pid=$!
  echo $grype_pid > output/grype.pid
  wait $grype_pid
  echo $? > output/exit_code
' > %q 2>&1 < /dev/null &`, archDir, filepath.Join(archDir, "scan.log"))
}

// storeBuilderScanResult parses and stores a successful scan result for a
// single architecture. Returns an error if parsing, marshalling, or DB
// storage fails. The error is wrapped in a ScanFailureError with the
// appropriate error code for the caller to pass to recordScanFailure.
func storeBuilderScanResult(ctx context.Context, digest, arch, scanResult string) error {
	parsedResults, err := image.ParseScanResultDetails(scanResult)
	if err != nil {
		return externalimage.NewScanFailureError(externalimage.ErrParseScanResult,
			fmt.Sprintf("failed to parse scan result: %s", err.Error()))
	}

	countsJSON, err := json.Marshal(parsedResults.Counts)
	if err != nil {
		return externalimage.NewScanFailureError(externalimage.ErrMarshalScanCounts,
			fmt.Sprintf("failed to marshal scan counts: %s", err.Error()))
	}

	summaryJSON, err := json.Marshal(parsedResults)
	if err != nil {
		return externalimage.NewScanFailureError(externalimage.ErrMarshalScanSummary,
			fmt.Sprintf("failed to marshal scan summary: %s", err.Error()))
	}

	if err := externalimage.SetExternalImageScanStatus(ctx, externalimage.SetExternalImageScanStatusParams{
		Digest:               digest,
		Arch:                 arch,
		Status:               externalimage.ScanStatusSucceeded,
		ParsedResults:        string(countsJSON),
		ParsedResultsDetails: string(summaryJSON),
		RawResult:            scanResult,
	}); err != nil {
		return externalimage.NewScanFailureError(externalimage.ErrSaveScanStatus,
			fmt.Sprintf("scan completed but failed to save results: %s", err.Error()))
	}

	return nil
}

// isScanAlreadyRunning checks if any external_image_scan row for the digest
// has a recent 'running' status. This prevents duplicate dispatch when the
// scheduler enqueues multiple work items before the first handler sets the
// status. Stale 'running' rows (older than scan.ScanStalenessThreshold) are
// ignored so that orphaned scans from crashed workers or disappeared builders
// can be recovered by a new dispatch.
func isScanAlreadyRunning(ctx context.Context, digest string) bool {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	staleThreshold := fmt.Sprintf("%d minutes", int(scan.ScanStalenessThreshold.Minutes()))

	var count int
	err := conn.QueryRow(ctx,
		`SELECT COUNT(*) FROM external_image_scan
		 WHERE digest = $1 AND status = 'running'
		   AND scan_status_updated_at > NOW() - interval '`+staleThreshold+`'`,
		digest).Scan(&count)
	if err != nil {
		logger.Warn("failed to check if scan is already running, proceeding",
			zap.String("digest", digest),
			zap.Error(err))
		return false
	}
	return count > 0
}

// claimScanForDispatch atomically transitions scan rows to "running" for the
// given digest and architectures. This handles:
//   - First scans: rows in "queued" status
//   - Re-scans: rows in "succeeded" or "failed" status from a previous scan
//   - Stale recovery: rows in "running" status older than ScanStalenessThreshold
//     (orphaned by crashed workers or disappeared builders)
//
// Recent "running" rows are excluded so we don't double-dispatch a scan that's
// genuinely in flight. The isScanAlreadyRunning check above provides a fast
// path to discard duplicates before reaching this query.
//
// Previous scan results (parsed_results, raw_result, scan_completed_at) are
// NOT cleared here. They remain in the row until the new scan completes and
// overwrites them. If the dispatch fails and reverts to "queued", the prior
// results are preserved so the API can still serve the last successful scan
// while waiting for the retry.
//
// Succeeded or failed rows with a recent scan_completed_at are excluded
// atomically. This closes a race with the result collector: it stores each
// architecture's result before updating last_security_scanned_at for the
// digest, so a duplicate queue handler can otherwise reclaim a just-completed
// row during that window and revert it to "queued" when no builder is
// available. Queued rows are not subject to this guard because they can retain
// an earlier scan_completed_at while waiting to retry a failed dispatch.
//
// Returns the architectures actually claimed. The caller must dispatch and,
// on failure, revert only these architectures so a partial claim cannot
// overwrite or redispatch a concurrently completed architecture.
func claimScanForDispatch(ctx context.Context, digest string, archs []string) ([]string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	staleThreshold := fmt.Sprintf("%d minutes", int(scan.ScanStalenessThreshold.Minutes()))
	recentThreshold := fmt.Sprintf("%d minutes", int(externalImageScanRecencyThreshold.Minutes()))

	rows, err := conn.Query(ctx,
		`UPDATE external_image_scan
		 SET status = 'running',
		     scan_status_updated_at = NOW(),
		     scan_status_message = NULL,
		     scan_attempted_at = COALESCE(scan_attempted_at, NOW())
		 WHERE digest = $1 AND arch = ANY($2::text[])
		   AND (status NOT IN ('succeeded', 'failed')
		        OR scan_completed_at IS NULL
		        OR scan_completed_at <= NOW() - interval '`+recentThreshold+`')
		   AND (status != 'running' OR scan_status_updated_at <= NOW() - interval '`+staleThreshold+`')
		 RETURNING arch`,
		digest, archs)
	if err != nil {
		return nil, fmt.Errorf("failed to claim scan rows: %w", err)
	}
	defer rows.Close()

	claimedArchs := make([]string, 0, len(archs))
	for rows.Next() {
		var arch string
		if err := rows.Scan(&arch); err != nil {
			return nil, fmt.Errorf("failed to read claimed scan architecture: %w", err)
		}
		claimedArchs = append(claimedArchs, arch)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed while reading claimed scan architectures: %w", err)
	}

	return claimedArchs, nil
}

// revertScanToQueued transitions scan rows from "running" back to "queued"
// after a failed dispatch. This allows the listener retry to re-dispatch
// the scan to a different builder. Without this, the scan would stay
// "running" forever with no builder work directory for the poller to find.
func revertScanToQueued(ctx context.Context, digest string, archs []string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	_, err := conn.Exec(ctx,
		`UPDATE external_image_scan
		 SET status = 'queued', scan_status_updated_at = NOW(), scan_status_message = NULL
		 WHERE digest = $1 AND arch = ANY($2::text[]) AND status = 'running'`,
		digest, archs)
	if err != nil {
		return fmt.Errorf("failed to revert scan status to queued: %w", err)
	}
	return nil
}
