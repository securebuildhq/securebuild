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
	listenertypes "github.com/securebuildhq/securebuild/pkg/listener/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/sbom"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

// StartExternalImageSbomDownloadStatusChecker runs the SBOM download status
// poller loop. Every SbomDownloadPollerInterval (10s), it checks all running
// builders for completed downloads, collects results, updates the DB, and
// cleans up. It also detects builders that have been deleted and re-enqueues
// their downloads.
func StartExternalImageSbomDownloadStatusChecker(ctx context.Context, cache *sbom.SbomDownloadCapacityCache) error {
	logger.Info("Starting external image SBOM download status checker")

	for {
		select {
		case <-ctx.Done():
			logger.Info("External image SBOM download status checker shutting down")
			return nil
		default:
		}

		if err := pollSbomDownloadStatus(ctx, cache); err != nil {
			logger.Error(fmt.Errorf("failed to poll SBOM download status: %w", err))
		}

		time.Sleep(sbom.SbomDownloadPollerInterval)
	}
}

// pollSbomDownloadStatus performs one poll cycle.
func pollSbomDownloadStatus(ctx context.Context, cache *sbom.SbomDownloadCapacityCache) error {
	span, ctx := telemetry.StartSpan(ctx, "listener.poll_sbom_download_status")
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
			processBuilderSbomDownloads(ctx, cache, b)
		}(b)
	}
	wg.Wait()

	for _, machineID := range cache.GetBuilderIDs() {
		if !runningBuilderIDs[machineID] {
			handleMissingBuilderForSbomDownload(ctx, cache, machineID)
		}
	}

	return nil
}

// processBuilderSbomDownloads checks all SBOM download directories on a single
// builder, collects results for completed downloads, and cleans up.
func processBuilderSbomDownloads(ctx context.Context, cache *sbom.SbomDownloadCapacityCache, vm buildertypes.BuilderVM) {
	span, ctx := telemetry.StartSpan(ctx, "listener.process_builder_sbom_downloads")
	defer span.Finish()

	baseDir, err := sbom.ResolveSbomDownloadBaseDir(ctx, vm)
	if err != nil {
		logger.Warn("failed to resolve SBOM download base dir for builder, skipping",
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

	downloadDirs, err := sbom.ListSbomDownloadDirsWithRunner(ctx, runner, baseDir)
	if err != nil {
		logger.Warn("failed to list SBOM download dirs on builder, skipping this cycle",
			zap.String("machineID", vm.ID),
			zap.Error(err))
		return
	}

	// Resync the cache for this builder with what's actually on the filesystem.
	activeDownloads := make([]sbom.SbomDownloadDirInfo, 0)
	for _, dd := range downloadDirs {
		if dd.Metadata.Digest != "" && !dd.AllArchsDone {
			activeDownloads = append(activeDownloads, sbom.SbomDownloadDirInfo{
				TeamID:    dd.Metadata.TeamID,
				Digest:    dd.Metadata.Digest,
				WorkDir:   dd.WorkDir,
				CreatedAt: dd.Metadata.CreatedAt,
			})
		}
	}
	cache.SetBuilderDownloads(vm.ID, activeDownloads)

	// Partition into completed (batch via tar) and in-progress.
	var completedDirs []sbom.SbomDownloadDirStatus
	var inProgressDirs []sbom.SbomDownloadDirStatus
	for _, dd := range downloadDirs {
		if dd.AllArchsDone && len(dd.ArchStatuses) > 0 {
			completedDirs = append(completedDirs, dd)
		} else {
			inProgressDirs = append(inProgressDirs, dd)
		}
	}

	// Handle in-progress downloads individually (timeout detection, kill).
	for _, dd := range inProgressDirs {
		processSbomDownloadDir(ctx, cache, vm, runner, dd)
	}

	// Batch-collect completed downloads via a single tar transfer.
	if len(completedDirs) > 0 {
		processCompletedSbomDownloadsBatch(ctx, cache, vm, runner, baseDir, completedDirs)
	}
}

// processCompletedSbomDownloadsBatch transfers all completed SBOM download
// results from the builder in a single tar archive, processes them locally,
// and cleans up all completed download dirs with a single rm -rf command.
func processCompletedSbomDownloadsBatch(ctx context.Context, cache *sbom.SbomDownloadCapacityCache, vm buildertypes.BuilderVM, runner buildbackend.Runner, baseDir string, completedDirs []sbom.SbomDownloadDirStatus) {
	span, ctx := telemetry.StartSpan(ctx, "listener.process_completed_sbom_downloads_batch")
	defer span.Finish()

	type archResult struct {
		digest    string
		platform  string
		exitCode  int
		spdxRel   string
		syftRel   string
		stderrRel string
	}
	var results []archResult
	var tarRelPaths []string

	for _, dd := range completedDirs {
		if dd.Metadata.Digest == "" {
			continue
		}
		relDir, err := filepath.Rel(baseDir, dd.WorkDir)
		if err != nil {
			continue
		}
		for platform, status := range dd.ArchStatuses {
			if !status.Done {
				continue
			}
			exitCode, parseErr := strconv.Atoi(strings.TrimSpace(status.ExitCode))
			if parseErr != nil {
				exitCode = 1
			}
			archDirName := platformToArchDir(platform)
			spdxRel := filepath.Join(relDir, archDirName, "sbom.spdx.json")
			syftRel := filepath.Join(relDir, archDirName, "sbom.syft.json")
			stderrRel := filepath.Join(relDir, archDirName, "output", "syft.stderr")
			tarRelPaths = append(tarRelPaths, spdxRel, syftRel, stderrRel)
			results = append(results, archResult{
				digest:    dd.Metadata.Digest,
				platform:  platform,
				exitCode:  exitCode,
				spdxRel:   spdxRel,
				syftRel:   syftRel,
				stderrRel: stderrRel,
			})
		}
	}

	if len(tarRelPaths) == 0 {
		return
	}

	localDir, err := os.MkdirTemp("", "sbom-results-*")
	if err != nil {
		logger.Warn("failed to create temp dir for SBOM results, falling back to per-dir processing",
			zap.String("machineID", vm.ID),
			zap.Error(err))
		for _, dd := range completedDirs {
			processSbomDownloadDir(ctx, cache, vm, runner, dd)
		}
		return
	}
	defer os.RemoveAll(localDir)

	if err := tarSbomResultsFromBuilder(ctx, runner, baseDir, localDir, tarRelPaths); err != nil {
		if errors.Is(err, builder.ErrSSH) {
			logger.Warn("transient SSH error during batch tar transfer, will retry next cycle",
				zap.String("machineID", vm.ID),
				zap.Error(err))
			return
		}
		logger.Warn("failed to batch transfer SBOM results, falling back to per-dir processing",
			zap.String("machineID", vm.ID),
			zap.Error(err))
		for _, dd := range completedDirs {
			processSbomDownloadDir(ctx, cache, vm, runner, dd)
		}
		return
	}

	// Process results locally from the extracted tar.
	var dirsToCleanup []string
	successByDigest := make(map[string]bool)

	for _, r := range results {
		spdxJSON := ""
		spdxLocalPath := filepath.Join(localDir, r.spdxRel)
		if data, err := os.ReadFile(spdxLocalPath); err == nil {
			spdxJSON = string(data)
		}

		syftJSON := ""
		syftLocalPath := filepath.Join(localDir, r.syftRel)
		if data, err := os.ReadFile(syftLocalPath); err == nil {
			syftJSON = string(data)
		}

		if r.exitCode == 0 {
			if strings.TrimSpace(spdxJSON) == "" {
				recordSBOMFailure(ctx, r.digest,
					externalimage.NewScanFailureError(externalimage.ErrNoSBOMDataAvailable, "syft produced empty SBOM output"),
					false, 1, MaxRetryAttempts)
				logger.Warn("syft SBOM output is empty",
					zap.String("digest", r.digest),
					zap.String("platform", r.platform))
			} else if err := storeBuilderSbomResult(ctx, r.digest, r.platform, spdxJSON, syftJSON); err != nil {
				logger.Warn("failed to store SBOM result",
					zap.String("digest", r.digest),
					zap.String("platform", r.platform),
					zap.Error(err))
				recordSBOMFailure(ctx, r.digest, err, false, 1, MaxRetryAttempts)
			} else {
				successByDigest[r.digest] = true
			}
		} else {
			stderr := ""
			stderrLocalPath := filepath.Join(localDir, r.stderrRel)
			if data, err := os.ReadFile(stderrLocalPath); err == nil {
				stderr = strings.TrimRight(string(data), "\n\r")
			}
			msg := fmt.Sprintf("syft exited with code %d", r.exitCode)
			if stderr != "" {
				msg = fmt.Sprintf("syft exited with code %d: %s", r.exitCode, stderr)
			}
			recordSBOMFailure(ctx, r.digest,
				externalimage.NewScanFailureError(externalimage.ErrFetchSBOM, msg),
				false, 1, MaxRetryAttempts)
			logger.Warn("SBOM download failed",
				zap.String("digest", r.digest),
				zap.String("platform", r.platform),
				zap.Int("exitCode", r.exitCode))
		}
	}

	// Mark SBOM status as succeeded and enqueue scan for digests that had at
	// least one successful architecture. Collect dirs for batch cleanup.
	for _, dd := range completedDirs {
		if dd.Metadata.Digest == "" {
			continue
		}
		if successByDigest[dd.Metadata.Digest] {
			if err := externalimage.SetSBOMStatusSucceeded(ctx, dd.Metadata.Digest); err != nil {
				logger.Warn("failed to set SBOM status to succeeded",
					zap.String("digest", dd.Metadata.Digest),
					zap.Error(err))
			}

			storedSBOMs, sbomErr := externalimage.GetExternalImageSBOMs(ctx, dd.Metadata.Digest)
			if sbomErr != nil {
				logger.Warn("failed to get stored SBOMs for scan initialization",
					zap.String("digest", dd.Metadata.Digest),
					zap.Error(sbomErr))
			} else {
				for _, s := range storedSBOMs {
					if err := externalimage.InitializeScanStatusQueued(ctx, dd.Metadata.Digest, s.Arch); err != nil {
						logger.Warn("failed to initialize scan status to queued",
							zap.String("digest", dd.Metadata.Digest),
							zap.String("arch", s.Arch),
							zap.Error(err))
					}
				}
			}
		}

		cache.RemoveDownload(vm.ID, dd.Metadata.Digest)
		dirsToCleanup = append(dirsToCleanup, dd.WorkDir)

		logger.Info("completed SBOM download collection for digest",
			zap.String("digest", dd.Metadata.Digest),
			zap.Int("archs", len(dd.ArchStatuses)),
			zap.String("machineID", vm.ID))
	}

	// Batch cleanup: single rm -rf for all completed download dirs.
	if len(dirsToCleanup) > 0 {
		cleanupSbomDownloadDirsBatch(ctx, runner, dirsToCleanup)
	}
}

// tarSbomResultsFromBuilder creates a tar.gz on the VM containing the given
// relative paths, transfers it locally, and extracts it into localDir.
func tarSbomResultsFromBuilder(ctx context.Context, runner buildbackend.Runner, baseDir, localDir string, relPaths []string) error {
	listContent := strings.Join(relPaths, "\x00") + "\x00"

	remoteListPath := fmt.Sprintf("/tmp/sbom-tar-list-%d.txt", time.Now().UnixNano())
	remoteTarPath := fmt.Sprintf("/tmp/sbom-tar-%d.tar.gz", time.Now().UnixNano())

	if err := runner.WriteFile(remoteListPath, listContent); err != nil {
		return fmt.Errorf("failed to write file list to VM: %w", err)
	}

	tarCmd := fmt.Sprintf("cd %q && tar -czf %q --null -T %q && rm -f %q",
		baseDir, remoteTarPath, remoteListPath, remoteListPath)
	if _, err := runner.RunCommand(ctx, tarCmd); err != nil {
		_, _ = runner.RunCommand(ctx, fmt.Sprintf("rm -f %q %q", remoteListPath, remoteTarPath))
		return fmt.Errorf("failed to create tar on VM: %w", err)
	}

	tmpFile, err := os.CreateTemp("", "sbom-tar-*.tar.gz")
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

	_, _ = runner.RunCommand(ctx, fmt.Sprintf("rm -f %q", remoteTarPath))

	extractCmd := exec.CommandContext(ctx, "tar", "-xzf", tmpPath, "-C", localDir)
	var stderr bytes.Buffer
	extractCmd.Stderr = &stderr
	if err := extractCmd.Run(); err != nil {
		return fmt.Errorf("failed to extract tar: %w (stderr: %s)", err, stderr.String())
	}

	return nil
}

// cleanupSbomDownloadDirsBatch removes multiple SBOM download directories in a
// single SSH command.
func cleanupSbomDownloadDirsBatch(ctx context.Context, runner buildbackend.Runner, workDirs []string) {
	span, _ := telemetry.StartSpan(ctx, "listener.cleanup_sbom_download_dirs_batch")
	defer span.Finish()

	quoted := make([]string, len(workDirs))
	for i, d := range workDirs {
		quoted[i] = fmt.Sprintf("%q", d)
	}
	cmd := "rm -rf " + strings.Join(quoted, " ")
	if _, err := runner.RunCommand(ctx, cmd); err != nil {
		logger.Warn("failed to batch clean up SBOM download dirs on builder",
			zap.Strings("workDirs", workDirs),
			zap.Error(err))
	}
}

// processSbomDownloadDir processes a single SBOM download directory on a builder.
// For each architecture, it checks if syft has completed and collects results.
func processSbomDownloadDir(ctx context.Context, cache *sbom.SbomDownloadCapacityCache, vm buildertypes.BuilderVM, runner buildbackend.Runner, dd sbom.SbomDownloadDirStatus) {
	digest := dd.Metadata.Digest
	if digest == "" {
		logger.Warn("SBOM download dir has no digest in metadata, cleaning up",
			zap.String("workDir", dd.WorkDir))
		cleanupSbomDownloadDir(ctx, runner, dd.WorkDir)
		return
	}

	allDone := len(dd.ArchStatuses) > 0
	successCount := 0

	for platform, status := range dd.ArchStatuses {
		if status.Done {
			exitCode, parseErr := strconv.Atoi(strings.TrimSpace(status.ExitCode))
			if parseErr != nil {
				exitCode = 1
			}

			if exitCode == 0 {
				err := handleSuccessfulSbomDownload(ctx, runner, dd.WorkDir, digest, platform)
				if err != nil {
					if errors.Is(err, builder.ErrSSH) {
						logger.Warn("transient SSH error reading syft result, will retry next cycle",
							zap.String("digest", digest),
							zap.String("platform", platform),
							zap.Error(err))
						allDone = false
					} else {
						logger.Warn("failed to handle successful SBOM download",
							zap.String("digest", digest),
							zap.String("platform", platform),
							zap.Error(err))
						recordSBOMFailure(ctx, digest, err, false, 1, MaxRetryAttempts)
					}
				} else {
					successCount++
				}
			} else {
				handleFailedSbomDownload(ctx, runner, dd.WorkDir, digest, platform, exitCode)
			}
		} else {
			age := time.Since(dd.Metadata.CreatedAt)
			if age > sbom.SbomDownloadTimeout {
				logger.Warn("SBOM download timed out, killing syft process",
					zap.String("digest", digest),
					zap.String("platform", platform),
					zap.Duration("age", age),
					zap.Duration("timeout", sbom.SbomDownloadTimeout))
				killSyftProcess(ctx, runner, dd.WorkDir, platform)
				writeSbomExitCode(ctx, runner, dd.WorkDir, platform, 124)
				handleFailedSbomDownload(ctx, runner, dd.WorkDir, digest, platform, 124)
				status.Done = true
				status.ExitCode = "124"
			} else {
				allDone = false
			}
		}
	}

	if allDone && len(dd.ArchStatuses) > 0 {
		if successCount > 0 {
			if err := externalimage.SetSBOMStatusSucceeded(ctx, digest); err != nil {
				logger.Warn("failed to set SBOM status to succeeded",
					zap.String("digest", digest),
					zap.Error(err))
			}

			// Initialize scan status to 'queued' for architectures with SBOMs.
			storedSBOMs, sbomErr := externalimage.GetExternalImageSBOMs(ctx, digest)
			if sbomErr != nil {
				logger.Warn("failed to get stored SBOMs for scan initialization",
					zap.String("digest", digest),
					zap.Error(sbomErr))
			} else {
				for _, s := range storedSBOMs {
					if err := externalimage.InitializeScanStatusQueued(ctx, digest, s.Arch); err != nil {
						logger.Warn("failed to initialize scan status to queued",
							zap.String("digest", digest),
							zap.String("arch", s.Arch),
							zap.Error(err))
					}
				}
			}
		}

		cleanupSbomDownloadDir(ctx, runner, dd.WorkDir)
		cache.RemoveDownload(vm.ID, digest)

		logger.Info("completed SBOM download collection for digest",
			zap.String("digest", digest),
			zap.Int("archs", len(dd.ArchStatuses)),
			zap.Int("succeeded", successCount),
			zap.String("machineID", vm.ID))
	}
}

// handleSuccessfulSbomDownload reads the syft output files and stores the SBOM.
func handleSuccessfulSbomDownload(ctx context.Context, runner buildbackend.Runner, workDir, digest, platform string) error {
	span, ctx := telemetry.StartSpan(ctx, "listener.handle_successful_sbom_download")
	defer span.Finish()

	archDir := filepath.Join(workDir, platformToArchDir(platform))
	spdxPath := filepath.Join(archDir, "sbom.spdx.json")
	spdxJSON, err := runner.ReadFile(spdxPath)
	if err != nil {
		return err
	}

	if strings.TrimSpace(spdxJSON) == "" {
		return externalimage.NewScanFailureError(externalimage.ErrNoSBOMDataAvailable, "syft produced empty SBOM output")
	}

	syftPath := filepath.Join(archDir, "sbom.syft.json")
	syftJSON := ""
	if content, err := runner.ReadFile(syftPath); err == nil {
		syftJSON = content
	}

	return storeBuilderSbomResult(ctx, digest, platform, spdxJSON, syftJSON)
}

// handleFailedSbomDownload reads the syft stderr and records the failure.
func handleFailedSbomDownload(ctx context.Context, runner buildbackend.Runner, workDir, digest, platform string, exitCode int) {
	span, ctx := telemetry.StartSpan(ctx, "listener.handle_failed_sbom_download")
	defer span.Finish()

	stderrPath := filepath.Join(workDir, platformToArchDir(platform), "output", "syft.stderr")
	stderr := ""
	if content, err := runner.ReadFileTail(stderrPath, 10240); err == nil {
		stderr = strings.TrimRight(content, "\n\r")
	}

	msg := fmt.Sprintf("syft exited with code %d", exitCode)
	if stderr != "" {
		msg = fmt.Sprintf("syft exited with code %d: %s", exitCode, stderr)
	}

	recordSBOMFailure(ctx, digest,
		externalimage.NewScanFailureError(externalimage.ErrFetchSBOM, msg),
		false, 1, MaxRetryAttempts)

	logger.Warn("SBOM download failed",
		zap.String("digest", digest),
		zap.String("platform", platform),
		zap.Int("exitCode", exitCode))
}

// killSyftProcess reads the syft PID file and kills the syft process.
// Mirrors killGrypeProcess but targets syft instead.
func killSyftProcess(ctx context.Context, runner buildbackend.Runner, workDir, platform string) {
	pidPath := filepath.Join(workDir, platformToArchDir(platform), "output", "syft.pid")

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
		logger.Warn("syft PID file did not appear within timeout, cannot kill process",
			zap.String("workDir", workDir),
			zap.String("platform", platform))
		return
	}

	pid := strings.TrimSpace(pidContent)
	if pid == "" {
		return
	}

	cmd := fmt.Sprintf(`ps -p %s -o comm= 2>/dev/null | grep -q syft && kill %s; sleep 5; ps -p %s -o comm= 2>/dev/null | grep -q syft && kill -9 %s; true`, pid, pid, pid, pid)
	if _, err := runner.RunCommand(ctx, cmd); err != nil {
		logger.Warn("failed to kill syft process",
			zap.String("pid", pid),
			zap.Error(err))
	}
}

// writeSbomExitCode writes an exit code file for a timed-out download.
func writeSbomExitCode(ctx context.Context, runner buildbackend.Runner, workDir, platform string, code int) {
	exitCodePath := filepath.Join(workDir, platformToArchDir(platform), "output", "exit_code")
	if err := runner.WriteFile(exitCodePath, strconv.Itoa(code)); err != nil {
		logger.Warn("failed to write exit code for timed-out SBOM download",
			zap.String("workDir", workDir),
			zap.String("platform", platform),
			zap.Error(err))
	}
}

// cleanupSbomDownloadDir removes the SBOM download work directory from the builder.
func cleanupSbomDownloadDir(ctx context.Context, runner buildbackend.Runner, workDir string) {
	span, _ := telemetry.StartSpan(ctx, "listener.cleanup_sbom_download_dir")
	defer span.Finish()

	cmd := fmt.Sprintf("rm -rf %q", workDir)
	if _, err := runner.RunCommand(ctx, cmd); err != nil {
		logger.Warn("failed to clean up SBOM download dir on builder",
			zap.String("workDir", workDir),
			zap.Error(err))
	}
}

// handleMissingBuilderForSbomDownload handles the case where a builder that had
// active SBOM downloads is no longer in machine_pool. The downloads on that
// builder are lost, so the affected digests are re-enqueued.
func handleMissingBuilderForSbomDownload(ctx context.Context, cache *sbom.SbomDownloadCapacityCache, machineID string) {
	downloads := cache.GetDownloadsForBuilder(machineID)
	if len(downloads) == 0 {
		cache.RemoveBuilder(machineID)
		return
	}

	logger.Warn("builder no longer in machine_pool, re-enqueuing SBOM downloads",
		zap.String("machineID", machineID),
		zap.Int("downloadCount", len(downloads)))

	for _, d := range downloads {
		if err := externalimage.SetSBOMStatusFailed(ctx, d.Digest, "builder VM no longer exists"); err != nil {
			logger.Warn("failed to set SBOM status to failed for missing builder",
				zap.String("digest", d.Digest),
				zap.Error(err))
		}
		reenqueueSbomDownload(ctx, d.TeamID, d.Digest)
	}

	cache.RemoveBuilder(machineID)
}

// reenqueueSbomDownload enqueues a new external_image_sbom work item for a digest.
func reenqueueSbomDownload(ctx context.Context, teamID, digest string) {
	payloadBytes, err := json.Marshal(listenertypes.ExternalImageSbomPayload{Digest: digest, TeamID: teamID})
	if err != nil {
		logger.Error(fmt.Errorf("failed to marshal re-enqueue SBOM payload: %w", err))
		return
	}

	if err := persistence.EnqueueWork(ctx, "external_image_sbom", string(payloadBytes)); err != nil {
		logger.Error(fmt.Errorf("failed to re-enqueue external image SBOM download: %w", err))
		return
	}

	logger.Info("re-enqueued external image SBOM download",
		zap.String("digest", digest))
}
