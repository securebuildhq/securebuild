package listener

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/builder"
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

	var wg sync.WaitGroup
	for _, b := range builders {
		wg.Add(1)
		go func(b buildertypes.BuilderVM) {
			defer wg.Done()
			processBuilderScans(ctx, cache, b)
		}(b)
	}
	wg.Wait()

	for _, machineID := range cache.GetBuilderIDs() {
		if !runningBuilderIDs[machineID] {
			handleMissingBuilder(ctx, cache, machineID)
		}
	}

	return nil
}

// processBuilderScans checks all scan directories on a single builder,
// collects results for completed scans, and cleans up finished scan dirs.
//
// Completed scans are batched: a single tar is created on the VM containing
// all grype-scan.json and grype.stderr files, transferred in one SSH session,
// and processed locally. This avoids opening dozens of individual SSH
// sessions (one per file) that exhaust the SSH server's MaxSessions limit.
// Scan dirs that are still in-progress or have timed-out archs are handled
// individually since they require interactive SSH commands (kill, write).
func processBuilderScans(ctx context.Context, cache *scan.ScanCapacityCache, vm buildertypes.BuilderVM) {
	span, ctx := telemetry.StartSpan(ctx, "listener.process_builder_scans")
	defer span.Finish()

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

	// Resync the cache for this builder with what's actually on the
	// filesystem. This replaces all entries (including leaked placeholders
	// and stale scans) with the current set of active scan dirs. Only
	// scans that are still in progress (not all archs done) are counted
	// toward capacity.
	activeScans := make([]scan.ScanDirInfo, 0)
	for _, sd := range scanDirs {
		if sd.Metadata.Digest != "" && !sd.AllArchsDone {
			activeScans = append(activeScans, scan.ScanDirInfo{
				Digest:    sd.Metadata.Digest,
				WorkDir:   sd.WorkDir,
				CreatedAt: sd.Metadata.CreatedAt,
			})
		}
	}
	cache.SetBuilderScans(vm.ID, activeScans)

	// Partition scan dirs into completed (batch via tar) and in-progress
	// (handle individually for timeout/kill).
	var completedDirs []scan.ScanDirStatus
	var inProgressDirs []scan.ScanDirStatus
	for _, sd := range scanDirs {
		if sd.AllArchsDone && len(sd.ArchStatuses) > 0 {
			completedDirs = append(completedDirs, sd)
		} else {
			inProgressDirs = append(inProgressDirs, sd)
		}
	}

	// Handle in-progress scans individually (timeout detection, kill).
	for _, sd := range inProgressDirs {
		processScanDir(ctx, cache, vm, runner, sd)
	}

	// Batch-collect completed scans via a single tar transfer.
	if len(completedDirs) > 0 {
		processCompletedScansBatch(ctx, cache, vm, runner, baseDir, completedDirs)
	}
}

// processCompletedScansBatch transfers all completed scan results from the
// builder in a single tar archive, processes them locally, and cleans up
// all completed scan dirs with a single rm -rf command. This replaces the
// per-scan-dir SSH ReadFile + cleanup approach that opened dozens of SSH
// sessions.
func processCompletedScansBatch(ctx context.Context, cache *scan.ScanCapacityCache, vm buildertypes.BuilderVM, runner buildbackend.Runner, baseDir string, completedDirs []scan.ScanDirStatus) {
	span, ctx := telemetry.StartSpan(ctx, "listener.process_completed_scans_batch")
	defer span.Finish()

	// Build a list of relative paths to include in the tar. For each
	// completed scan dir, include grype-scan.json and grype.stderr for
	// every arch that has an exit_code file (i.e., grype finished).
	type archResult struct {
		digest    string
		arch      string
		exitCode  int
		grypePath string
		stderrRel string
	}
	var results []archResult
	var tarRelPaths []string

	for _, sd := range completedDirs {
		if sd.Metadata.Digest == "" {
			continue
		}
		relDir, err := filepath.Rel(baseDir, sd.WorkDir)
		if err != nil {
			continue
		}
		for arch, status := range sd.ArchStatuses {
			if !status.Done {
				continue
			}
			exitCode, parseErr := strconv.Atoi(strings.TrimSpace(status.ExitCode))
			if parseErr != nil {
				exitCode = 1
			}
			grypeRel := filepath.Join(relDir, arch, "grype-scan.json")
			stderrRel := filepath.Join(relDir, arch, "output", "grype.stderr")
			tarRelPaths = append(tarRelPaths, grypeRel, stderrRel)
			results = append(results, archResult{
				digest:    sd.Metadata.Digest,
				arch:      arch,
				exitCode:  exitCode,
				grypePath: grypeRel,
				stderrRel: stderrRel,
			})
		}
	}

	if len(tarRelPaths) == 0 {
		return
	}

	// Create tar on the VM containing all result files. Use --null -T -
	// with a null-delimited file list to handle paths with colons (digests).
	localDir, err := os.MkdirTemp("", "scan-results-*")
	if err != nil {
		logger.Warn("failed to create temp dir for scan results, falling back to per-dir processing",
			zap.String("machineID", vm.ID),
			zap.Error(err))
		for _, sd := range completedDirs {
			processScanDir(ctx, cache, vm, runner, sd)
		}
		return
	}
	defer os.RemoveAll(localDir)

	if err := tarScanResultsFromBuilder(ctx, runner, baseDir, localDir, tarRelPaths); err != nil {
		if errors.Is(err, builder.ErrSSH) {
			logger.Warn("transient SSH error during batch tar transfer, will retry next cycle",
				zap.String("machineID", vm.ID),
				zap.Error(err))
			return
		}
		logger.Warn("failed to batch transfer scan results, falling back to per-dir processing",
			zap.String("machineID", vm.ID),
			zap.Error(err))
		for _, sd := range completedDirs {
			processScanDir(ctx, cache, vm, runner, sd)
		}
		return
	}

	// Process results locally from the extracted tar.
	now := time.Now().UTC()
	var dirsToCleanup []string
	successByDigest := make(map[string][]string)

	for _, r := range results {
		grypeJSON := ""
		grypeLocalPath := filepath.Join(localDir, r.grypePath)
		if data, err := os.ReadFile(grypeLocalPath); err == nil {
			grypeJSON = string(data)
		}

		if r.exitCode == 0 {
			if strings.TrimSpace(grypeJSON) == "" {
				recordScanFailure(ctx, r.digest, r.arch,
					externalimage.NewScanFailureError(externalimage.ErrParseScanResult,
						"grype JSON result is empty"),
					false, 0, 0)
				logger.Warn("grype JSON result is empty",
					zap.String("digest", r.digest),
					zap.String("arch", r.arch))
			} else if err := storeBuilderScanResult(ctx, r.digest, r.arch, grypeJSON); err != nil {
				logger.Warn("failed to store scan result",
					zap.String("digest", r.digest),
					zap.String("arch", r.arch),
					zap.Error(err))
				recordScanFailure(ctx, r.digest, r.arch, err, false, 0, 0)
			} else {
				logger.Info("stored scan result",
					zap.String("digest", r.digest),
					zap.String("arch", r.arch))
				successByDigest[r.digest] = append(successByDigest[r.digest], r.arch)
			}
		} else {
			stderr := ""
			stderrLocalPath := filepath.Join(localDir, r.stderrRel)
			if data, err := os.ReadFile(stderrLocalPath); err == nil {
				stderr = strings.TrimRight(string(data), "\n\r")
			}
			msg := fmt.Sprintf("grype exited with code %d", r.exitCode)
			if stderr != "" {
				msg = fmt.Sprintf("grype exited with code %d: %s", r.exitCode, stderr)
			}
			recordScanFailure(ctx, r.digest, r.arch,
				externalimage.NewScanFailureError(externalimage.ErrScanExecutionFailed, msg),
				false, 0, 0)
			logger.Warn("scan failed",
				zap.String("digest", r.digest),
				zap.String("arch", r.arch),
				zap.Int("exitCode", r.exitCode))
		}
	}

	// Update last_security_scanned and collect dirs for batch cleanup.
	for _, sd := range completedDirs {
		if sd.Metadata.Digest == "" {
			continue
		}
		scannedArchs := make([]string, 0, len(sd.ArchStatuses))
		for arch := range sd.ArchStatuses {
			scannedArchs = append(scannedArchs, arch)
		}
		if err := scan.UpdateLastSecurityScanned(ctx, sd.Metadata.Digest, scannedArchs, now); err != nil {
			logger.Warn("failed to update last_security_scanned_at",
				zap.String("digest", sd.Metadata.Digest),
				zap.Error(err))
		}
		cache.RemoveScan(vm.ID, sd.Metadata.Digest)
		dirsToCleanup = append(dirsToCleanup, sd.WorkDir)

		logger.Info("completed scan collection for digest",
			zap.String("digest", sd.Metadata.Digest),
			zap.Int("archs", len(sd.ArchStatuses)),
			zap.Int("succeeded", len(successByDigest[sd.Metadata.Digest])),
			zap.String("machineID", vm.ID))
	}

	// Batch cleanup: single rm -rf for all completed scan dirs.
	if len(dirsToCleanup) > 0 {
		cleanupScanDirsBatch(ctx, runner, dirsToCleanup)
	}
}

// tarScanResultsFromBuilder creates a tar.gz on the VM containing the given
// relative paths (relative to baseDir), transfers it locally, and extracts
// it into localDir.
func tarScanResultsFromBuilder(ctx context.Context, runner buildbackend.Runner, baseDir, localDir string, relPaths []string) error {
	// Write the file list to a temp file on the VM, then tar from it.
	// Using --null -T - with null-delimited input handles paths with
	// colons (digests like sha256:abc...) safely.
	listContent := strings.Join(relPaths, "\x00") + "\x00"

	remoteListPath := fmt.Sprintf("/tmp/scan-tar-list-%d.txt", time.Now().UnixNano())
	remoteTarPath := fmt.Sprintf("/tmp/scan-tar-%d.tar.gz", time.Now().UnixNano())

	if err := runner.WriteFile(remoteListPath, listContent); err != nil {
		return fmt.Errorf("failed to write file list to VM: %w", err)
	}

	tarCmd := fmt.Sprintf("cd %q && tar -czf %q --null -T %q && rm -f %q",
		baseDir, remoteTarPath, remoteListPath, remoteListPath)
	if _, err := runner.RunCommand(ctx, tarCmd); err != nil {
		_, _ = runner.RunCommand(ctx, fmt.Sprintf("rm -f %q %q", remoteListPath, remoteTarPath))
		return fmt.Errorf("failed to create tar on VM: %w", err)
	}

	// Copy tar to local temp file and extract.
	tmpFile, err := os.CreateTemp("", "scan-tar-*.tar.gz")
	if err != nil {
		_, _ = runner.RunCommand(ctx, fmt.Sprintf("rm -f %q", remoteTarPath))
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	if err := runner.CopyToLocal(remoteTarPath, tmpPath); err != nil {
		_, _ = runner.RunCommand(ctx, fmt.Sprintf("rm -f %q", remoteTarPath))
		return fmt.Errorf("failed to copy tar from VM: %w", err)
	}

	// Clean up remote tar.
	_, _ = runner.RunCommand(ctx, fmt.Sprintf("rm -f %q", remoteTarPath))

	// Extract locally.
	extractCmd := exec.CommandContext(ctx, "tar", "-xzf", tmpPath, "-C", localDir)
	var stderr bytes.Buffer
	extractCmd.Stderr = &stderr
	if err := extractCmd.Run(); err != nil {
		return fmt.Errorf("failed to extract tar: %w (stderr: %s)", err, stderr.String())
	}

	return nil
}

// cleanupScanDirsBatch removes multiple scan directories in a single SSH
// command.
func cleanupScanDirsBatch(ctx context.Context, runner buildbackend.Runner, workDirs []string) {
	span, _ := telemetry.StartSpan(ctx, "listener.cleanup_scan_dirs_batch")
	defer span.Finish()

	quoted := make([]string, len(workDirs))
	for i, d := range workDirs {
		quoted[i] = fmt.Sprintf("%q", d)
	}
	cmd := "rm -rf " + strings.Join(quoted, " ")
	if _, err := runner.RunCommand(ctx, cmd); err != nil {
		logger.Warn("failed to batch clean up scan dirs on builder",
			zap.Strings("workDirs", workDirs),
			zap.Error(err))
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
				err := handleSuccessfulScan(ctx, runner, sd.WorkDir, digest, arch)
				if err != nil {
					if errors.Is(err, builder.ErrSSH) {
						logger.Warn("transient SSH error reading grype result, will retry next cycle",
							zap.String("digest", digest),
							zap.String("arch", arch),
							zap.Error(err))
						allDone = false
					} else {
						logger.Warn("failed to handle successful scan",
							zap.String("digest", digest),
							zap.String("arch", arch),
							zap.Error(err))
						recordScanFailure(ctx, digest, arch, err, false, 0, 0)
					}
				} else {
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

// handleSuccessfulScan reads the grype JSON result and stores it in the DB.
// Returns nil on success. On failure, returns an error:
//   - SSH errors (transient): the caller should retry on the next poll cycle
//     without marking the scan as failed or cleaning up the scan dir.
//   - All other errors (permanent): the caller should call recordScanFailure
//     and clean up the scan dir.
func handleSuccessfulScan(ctx context.Context, runner buildbackend.Runner, workDir, digest, arch string) error {
	span, ctx := telemetry.StartSpan(ctx, "listener.handle_successful_scan")
	defer span.Finish()

	grypeJSONPath := filepath.Join(workDir, arch, "grype-scan.json")
	grypeJSON, err := runner.ReadFile(grypeJSONPath)
	if err != nil {
		return err
	}

	if strings.TrimSpace(grypeJSON) == "" {
		return externalimage.NewScanFailureError(externalimage.ErrParseScanResult,
			"grype JSON result is empty")
	}

	if err := storeBuilderScanResult(ctx, digest, arch, grypeJSON); err != nil {
		return err
	}

	logger.Info("stored scan result",
		zap.String("digest", digest),
		zap.String("arch", arch))
	return nil
}

// handleFailedScan reads the grype stderr and records the scan failure.
// Grype failures are non-retryable (same SBOM gives same result).
func handleFailedScan(ctx context.Context, runner buildbackend.Runner, workDir, digest, arch string, exitCode int) {
	span, ctx := telemetry.StartSpan(ctx, "listener.handle_failed_scan")
	defer span.Finish()

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
	span, _ := telemetry.StartSpan(ctx, "listener.cleanup_scan_dir")
	defer span.Finish()

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
