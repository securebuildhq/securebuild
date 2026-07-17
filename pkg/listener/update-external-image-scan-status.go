package listener

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/externalimage"
	"github.com/securebuildhq/securebuild/pkg/listener/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

// StartExternalImageScanStatusChecker runs the scan status poller loop.
// Every ScanPollerInterval (10s), it checks all running builders for
// completed scans, collects results, updates the DB, and cleans up.
// It also detects builders that have been deleted and re-enqueues their scans.
func StartExternalImageScanStatusChecker(ctx context.Context, cache *scan.ScanCapacityCache) error {
	logger.Info("Starting external image scan status checker")

	for {
		select {
		case <-ctx.Done():
			logger.Info("External image scan status checker shutting down")
			return nil
		default:
		}

		if err := pollScanStatus(ctx, cache); err != nil {
			logger.Error(fmt.Errorf("failed to poll scan status: %w", err))
		}

		time.Sleep(scan.ScanPollerInterval)
	}
}

// pollScanStatus performs one poll cycle: checks all running builders for
// completed scans and handles builders that have disappeared.
func pollScanStatus(ctx context.Context, cache *scan.ScanCapacityCache) error {
	span, ctx := telemetry.StartSpan(ctx, "listener.poll_scan_status")
	defer span.Finish()

	builders, err := scan.GetRunningBuilders(ctx)
	if err != nil {
		return fmt.Errorf("failed to query running builders: %w", err)
	}

	runningBuilderIDs := make(map[string]bool)
	for _, b := range builders {
		runningBuilderIDs[b.ID] = true
	}

	for _, b := range builders {
		processBuilderScans(ctx, cache, b)
	}

	for _, machineID := range cache.GetBuilderIDs() {
		if !runningBuilderIDs[machineID] {
			handleMissingBuilder(ctx, cache, machineID)
		}
	}

	return nil
}

// processBuilderScans checks all scan directories on a single builder,
// collects results for completed scans, and cleans up finished scan dirs.
func processBuilderScans(ctx context.Context, cache *scan.ScanCapacityCache, vm buildertypes.BuilderVM) {
	baseDir, err := scan.ResolveScanBaseDir(ctx, vm)
	if err != nil {
		logger.Warn("failed to resolve scan base dir for builder, skipping",
			zap.String("machineID", vm.ID),
			zap.Error(err))
		return
	}

	runner, err := buildbackend.NewRunner(ctx, vm)
	if err != nil {
		logger.Warn("failed to create runner for builder, skipping this cycle",
			zap.String("machineID", vm.ID),
			zap.Error(err))
		return
	}
	defer runner.Close()

	scanDirs, err := scan.ListScanDirsWithRunner(ctx, runner, baseDir)
	if err != nil {
		logger.Warn("failed to list scan dirs on builder, skipping this cycle",
			zap.String("machineID", vm.ID),
			zap.Error(err))
		return
	}

	// Reconcile cache with discovered scan dirs. If a scan dir is still
	// running (not all archs done) but not tracked in the cache (e.g. it
	// was missed during InitScanCapacityCache because the builder was
	// unreachable at startup), add it so capacity tracking is accurate
	// and missing-builder recovery can re-enqueue it if the VM disappears.
	cachedDigests := make(map[string]bool)
	for _, info := range cache.GetScansForBuilder(vm.ID) {
		cachedDigests[info.Digest] = true
	}
	for _, sd := range scanDirs {
		if sd.Metadata.Digest != "" && !sd.AllArchsDone && !cachedDigests[sd.Metadata.Digest] {
			cache.AddScanWithCount(vm.ID, scan.ScanDirInfo{
				Digest:    sd.Metadata.Digest,
				WorkDir:   sd.WorkDir,
				CreatedAt: sd.Metadata.CreatedAt,
			})
			logger.Info("added discovered scan to cache during poll",
				zap.String("digest", sd.Metadata.Digest),
				zap.String("machineID", vm.ID))
		}
	}

	for _, sd := range scanDirs {
		processScanDir(ctx, cache, vm, runner, sd)
	}
}

// processScanDir processes a single scan directory on a builder.
// For each architecture, it checks if grype has completed and collects results.
// When all architectures are complete, it cleans up the scan directory.
func processScanDir(ctx context.Context, cache *scan.ScanCapacityCache, vm buildertypes.BuilderVM, runner buildbackend.Runner, sd scan.ScanDirStatus) {
	digest := sd.Metadata.Digest
	if digest == "" {
		logger.Warn("scan dir has no digest in metadata, cleaning up",
			zap.String("workDir", sd.WorkDir))
		cleanupScanDir(ctx, runner, sd.WorkDir)
		return
	}

	now := time.Now().UTC()
	successArchs := make([]string, 0)
	allDone := len(sd.ArchStatuses) > 0

	for arch, status := range sd.ArchStatuses {
		if status.Done {
			allDone = allDone && true
			exitCode, parseErr := strconv.Atoi(strings.TrimSpace(status.ExitCode))
			if parseErr != nil {
				logger.Warn("failed to parse exit code, treating as failure",
					zap.String("digest", digest),
					zap.String("arch", arch),
					zap.String("exitCode", status.ExitCode),
					zap.Error(parseErr))
				exitCode = 1
			}

			if exitCode == 0 {
				if handled := handleSuccessfulScan(ctx, runner, sd.WorkDir, digest, arch); handled {
					successArchs = append(successArchs, arch)
				}
			} else {
				handleFailedScan(ctx, runner, sd.WorkDir, digest, arch, exitCode)
			}
		} else {
			age := now.Sub(sd.Metadata.CreatedAt)
			if age > scan.ScanTimeout {
				logger.Warn("scan timed out, killing grype process",
					zap.String("digest", digest),
					zap.String("arch", arch),
					zap.Duration("age", age),
					zap.Duration("timeout", scan.ScanTimeout))
				killGrypeProcess(ctx, runner, sd.WorkDir, arch)
				writeExitCode(ctx, runner, sd.WorkDir, arch, 124)
				handleFailedScan(ctx, runner, sd.WorkDir, digest, arch, 124)
				status.Done = true
				status.ExitCode = "124"
			} else {
				allDone = false
			}
		}
	}

	if allDone && len(sd.ArchStatuses) > 0 {
		scannedArchs := make([]string, 0, len(sd.ArchStatuses))
		for arch := range sd.ArchStatuses {
			scannedArchs = append(scannedArchs, arch)
		}
		if err := scan.UpdateLastSecurityScanned(ctx, digest, scannedArchs, now); err != nil {
			logger.Warn("failed to update last_security_scanned_at",
				zap.String("digest", digest),
				zap.Error(err))
		}

		cleanupScanDir(ctx, runner, sd.WorkDir)
		cache.RemoveScan(vm.ID, digest)

		logger.Info("completed scan collection for digest",
			zap.String("digest", digest),
			zap.Int("archs", len(sd.ArchStatuses)),
			zap.Int("succeeded", len(successArchs)),
			zap.String("machineID", vm.ID))
	}
}

// handleSuccessfulScan reads the grype JSON result, stores it in the DB,
// and updates package fix versions for APK packages.
// Returns true if the result was stored successfully.
func handleSuccessfulScan(ctx context.Context, runner buildbackend.Runner, workDir, digest, arch string) bool {
	grypeJSONPath := filepath.Join(workDir, arch, "grype-scan.json")
	grypeJSON, err := runner.ReadFile(grypeJSONPath)
	if err != nil {
		logger.Warn("failed to read grype JSON result, marking as failed",
			zap.String("digest", digest),
			zap.String("arch", arch),
			zap.Error(err))
		recordScanFailure(ctx, digest, arch,
			externalimage.NewScanFailureError(externalimage.ErrParseScanResult,
				fmt.Sprintf("grype JSON result missing or unreadable: %s", err.Error())),
			false, 0, 0)
		return false
	}

	if strings.TrimSpace(grypeJSON) == "" {
		logger.Warn("grype JSON result is empty, marking as failed",
			zap.String("digest", digest),
			zap.String("arch", arch))
		recordScanFailure(ctx, digest, arch,
			externalimage.NewScanFailureError(externalimage.ErrParseScanResult,
				"grype JSON result is empty"),
			false, 0, 0)
		return false
	}

	stored := storeBuilderScanResult(ctx, digest, arch, grypeJSON)
	if stored {
		sboms, sbomErr := externalimage.GetExternalImageSBOMs(ctx, digest)
		if sbomErr == nil {
			for _, s := range sboms {
				if s.Arch == arch {
					updatePackageFixVersionsForSBOM(ctx, s.SBOM)
					break
				}
			}
		}
		logger.Info("stored scan result",
			zap.String("digest", digest),
			zap.String("arch", arch))
	}
	return stored
}

// handleFailedScan reads the grype stderr and records the scan failure.
// Grype failures are non-retryable (same SBOM gives same result).
func handleFailedScan(ctx context.Context, runner buildbackend.Runner, workDir, digest, arch string, exitCode int) {
	stderrPath := filepath.Join(workDir, arch, "output", "grype.stderr")
	stderr := ""
	if content, err := runner.ReadFileTail(stderrPath, 10240); err == nil {
		stderr = strings.TrimRight(content, "\n\r")
	}

	msg := fmt.Sprintf("grype exited with code %d", exitCode)
	if stderr != "" {
		msg = fmt.Sprintf("grype exited with code %d: %s", exitCode, stderr)
	}

	recordScanFailure(ctx, digest, arch,
		externalimage.NewScanFailureError(externalimage.ErrScanExecutionFailed, msg),
		false, 0, 0)

	logger.Warn("scan failed",
		zap.String("digest", digest),
		zap.String("arch", arch),
		zap.Int("exitCode", exitCode))
}

// killGrypeProcess reads the grype PID file and kills the grype process.
// The PID file contains the actual grype process PID (not the bash wrapper).
//
// RunCommand returns immediately after the outer nohup detaches, but the
// inner shell may not have written grype.pid yet. This function polls for
// the PID file to appear (up to 10s) before reading it, closing the race
// where a launch failure triggers a kill before the PID file exists.
//
// Before sending any signal, the function verifies that the PID still belongs
// to a grype process. This prevents killing an unrelated process if grype
// exited between poll cycles and the OS reused its PID for a build or other
// process running on the same shared builder VM.
func killGrypeProcess(ctx context.Context, runner buildbackend.Runner, workDir, arch string) {
	pidPath := filepath.Join(workDir, arch, "output", "grype.pid")

	// Wait for the PID file to appear. RunCommand returns after the outer
	// nohup detaches, but the inner shell may not have written grype.pid yet.
	var pidContent string
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		content, err := runner.ReadFile(pidPath)
		if err == nil && strings.TrimSpace(content) != "" {
			pidContent = content
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	if pidContent == "" {
		logger.Warn("grype PID file did not appear within timeout, cannot kill process",
			zap.String("workDir", workDir),
			zap.String("arch", arch))
		return
	}

	pid := strings.TrimSpace(pidContent)
	if pid == "" {
		return
	}

	// Verify the PID is still a grype process before killing. If grype
	// already exited and the PID was reused by another process, skip the
	// kill to avoid terminating an unrelated process (e.g. a build).
	cmd := fmt.Sprintf(`ps -p %s -o comm= 2>/dev/null | grep -q grype && kill %s; sleep 5; ps -p %s -o comm= 2>/dev/null | grep -q grype && kill -9 %s; true`, pid, pid, pid, pid)
	if _, err := runner.RunCommand(ctx, cmd); err != nil {
		logger.Warn("failed to kill grype process",
			zap.String("pid", pid),
			zap.Error(err))
	}
}

// writeExitCode writes an exit code file for a timed-out scan so the poller
// doesn't re-check it on the next cycle.
func writeExitCode(ctx context.Context, runner buildbackend.Runner, workDir, arch string, code int) {
	exitCodePath := filepath.Join(workDir, arch, "output", "exit_code")
	if err := runner.WriteFile(exitCodePath, strconv.Itoa(code)); err != nil {
		logger.Warn("failed to write exit code for timed-out scan",
			zap.String("workDir", workDir),
			zap.String("arch", arch),
			zap.Error(err))
	}
}

// cleanupScanDir removes the scan work directory from the builder.
func cleanupScanDir(ctx context.Context, runner buildbackend.Runner, workDir string) {
	cmd := fmt.Sprintf("rm -rf %q", workDir)
	if _, err := runner.RunCommand(ctx, cmd); err != nil {
		logger.Warn("failed to clean up scan dir on builder",
			zap.String("workDir", workDir),
			zap.Error(err))
	}
}

// handleMissingBuilder handles the case where a builder that had active scans
// is no longer in machine_pool (deleted, expired, etc.). The scans on that
// builder are lost, so the affected digests are re-enqueued for scanning on
// a different builder. The retry_count is effectively reset to 0 since
// scan.json is lost with the VM.
func handleMissingBuilder(ctx context.Context, cache *scan.ScanCapacityCache, machineID string) {
	scans := cache.GetScansForBuilder(machineID)
	if len(scans) == 0 {
		cache.RemoveBuilder(machineID)
		return
	}

	logger.Warn("builder no longer in machine_pool, re-enqueuing scans",
		zap.String("machineID", machineID),
		zap.Int("scanCount", len(scans)))

	for _, s := range scans {
		for _, arch := range expectedArchs {
			if err := externalimage.SetExternalImageScanStatus(ctx, externalimage.SetExternalImageScanStatusParams{
				Digest:            s.Digest,
				Arch:              arch,
				Status:            externalimage.ScanStatusQueued,
				ScanStatusMessage: "builder VM no longer exists",
			}); err != nil {
				logger.Warn("failed to set scan status to queued for missing builder",
					zap.String("digest", s.Digest),
					zap.String("arch", arch),
					zap.Error(err))
			}
		}

		reenqueueScan(ctx, s.Digest)
	}

	cache.RemoveBuilder(machineID)
}

// reenqueueScan enqueues a new external_image_scan work item for a digest.
func reenqueueScan(ctx context.Context, digest string) {
	payload, err := json.Marshal(types.ExternalImageScanPayload{Digest: digest})
	if err != nil {
		logger.Error(fmt.Errorf("failed to marshal re-enqueue payload: %w", err))
		return
	}

	if err := persistence.EnqueueWork(ctx, "external_image_scan", string(payload)); err != nil {
		logger.Error(fmt.Errorf("failed to re-enqueue external image scan: %w", err))
		return
	}

	logger.Info("re-enqueued external image scan",
		zap.String("digest", digest))
}
