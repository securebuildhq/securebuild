package listener

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/externalimage"
	extimgtypes "github.com/securebuildhq/securebuild/pkg/externalimage/types"
	"github.com/securebuildhq/securebuild/pkg/listener/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/sbom"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

// sbomDownloadCacheContextKey is used to pass the SbomDownloadCapacityCache to
// the external image SBOM download handler via context.
type sbomDownloadCacheContextKey struct{}

// WithSbomDownloadCapacityCache returns a context that carries the SbomDownloadCapacityCache.
func WithSbomDownloadCapacityCache(ctx context.Context, cache *sbom.SbomDownloadCapacityCache) context.Context {
	return context.WithValue(ctx, sbomDownloadCacheContextKey{}, cache)
}

// getSbomDownloadCapacityCache retrieves the SbomDownloadCapacityCache from context, or nil.
func getSbomDownloadCapacityCache(ctx context.Context) *sbom.SbomDownloadCapacityCache {
	cache, _ := ctx.Value(sbomDownloadCacheContextKey{}).(*sbom.SbomDownloadCapacityCache)
	return cache
}

// sbomDownloadPlatforms is the list of platforms that SBOM generation checks.
var sbomDownloadPlatforms = []string{"linux/amd64", "linux/arm64"}

// handleExternalImageSbomOnBuilder dispatches an external image SBOM generation
// to a builder VM. It writes download metadata and launches syft via nohup for
// each architecture, then returns immediately. The SBOM download status poller
// collects results asynchronously.
//
// The shared pre-checks (get external image, check existing SBOM, set status to
// generating, rescan check) are already done by HandleExternalImageSbom before
// calling this function.
func handleExternalImageSbomOnBuilder(ctx context.Context, p types.ExternalImageSbomPayload, externalImage *extimgtypes.ExternalImage) error {
	cache := getSbomDownloadCapacityCache(ctx)
	if cache == nil || !cache.IsReady() {
		return fmt.Errorf("SBOM download capacity cache is not ready")
	}

	dispatchErr := dispatchSbomDownloadToBuilder(ctx, cache, p.Digest, externalImage.Registry, externalImage.ImageName)
	if dispatchErr != nil {
		if errors.Is(dispatchErr, sbom.ErrNoBuilderAvailableForSbomDownload) {
			// Revert status so the scheduler can re-enqueue on the next cycle.
			if revertErr := revertSbomDownloadToPending(ctx, p.Digest); revertErr != nil {
				logger.Warn("failed to revert SBOM status after no builder available",
					zap.String("digest", p.Digest),
					zap.Error(revertErr))
			}
			logger.Info("no builder available for SBOM download, will retry on next scheduler cycle",
				zap.String("digest", p.Digest))
			return nil
		}
		recordSBOMFailure(ctx, p.Digest,
			externalimage.NewScanFailureError(externalimage.ErrFetchSBOM,
				fmt.Sprintf("failed to dispatch SBOM download: %s", dispatchErr.Error())),
			false, 1, MaxRetryAttempts)
		return dispatchErr
	}

	return nil
}

// dispatchSbomDownloadToBuilder handles builder selection, file copy, and syft
// launch. It reserves a capacity slot atomically and releases it if any step
// fails before the download is fully launched.
func dispatchSbomDownloadToBuilder(ctx context.Context, cache *sbom.SbomDownloadCapacityCache, digest, registry, imageName string) error {
	span, ctx := telemetry.StartSpan(ctx, "listener.dispatch_sbom_download_to_builder")
	defer span.Finish()

	builderVM, err := sbom.SelectBuilderForSbomDownload(ctx, cache)
	if err != nil {
		return fmt.Errorf("failed to select builder for SBOM download: %w", err)
	}

	slotReserved := true
	defer func() {
		if slotReserved {
			cache.ReleaseDownloadSlot(builderVM.ID)
		}
	}()

	workDir, err := sbom.ResolveSbomDownloadWorkDir(ctx, builderVM, digest)
	if err != nil {
		return fmt.Errorf("failed to resolve SBOM download work dir: %w", err)
	}

	runner, err := buildbackend.NewRunner(ctx, builderVM)
	if err != nil {
		return fmt.Errorf("failed to create runner for builder %s: %w", builderVM.ID, err)
	}
	defer runner.Close()

	metadata := sbom.SbomDownloadMetadata{
		Digest:    digest,
		Registry:  registry,
		ImageName: imageName,
		CreatedAt: time.Now().UTC(),
	}

	// Phase 1: Prepare all files (dirs, download.json, per-arch dirs).
	if err := prepareSbomDownloadFiles(ctx, runner, workDir, metadata); err != nil {
		cleanupSbomDownloadDir(ctx, runner, workDir)
		return fmt.Errorf("failed to prepare SBOM download files on builder %s: %w", builderVM.ID, err)
	}

	// Phase 2: Launch syft for all archs. If a launch fails after some archs
	// have already been launched, kill those processes and clean up.
	launchedPlatforms := make([]string, 0, len(sbomDownloadPlatforms))
	for _, platform := range sbomDownloadPlatforms {
		syftCmd := buildSyftLaunchCommand(workDir, platform, registry, imageName, digest)
		if _, err := runner.RunCommand(ctx, syftCmd); err != nil {
			logger.Warn("failed to launch syft, cleaning up already-launched processes",
				zap.String("digest", digest),
				zap.String("platform", platform),
				zap.Strings("launchedPlatforms", launchedPlatforms),
				zap.Error(err))
			for _, launchedPlatform := range launchedPlatforms {
				killSyftProcess(ctx, runner, workDir, launchedPlatform)
			}
			cleanupSbomDownloadDir(ctx, runner, workDir)
			return fmt.Errorf("failed to launch syft for platform %s: %w", platform, err)
		}
		launchedPlatforms = append(launchedPlatforms, platform)
		logger.Info("launched syft SBOM download on builder",
			zap.String("digest", digest),
			zap.String("platform", platform),
			zap.String("machineID", builderVM.ID),
			zap.String("workDir", workDir))
	}

	// Download successfully launched. Add to cache so the running metric
	// reflects it immediately.
	slotReserved = false
	cache.AddDownload(builderVM.ID, sbom.SbomDownloadDirInfo{
		Digest:    digest,
		WorkDir:   workDir,
		CreatedAt: metadata.CreatedAt,
	})

	logger.Info("dispatched external image SBOM download to builder",
		zap.String("digest", digest),
		zap.Int("platforms", len(launchedPlatforms)),
		zap.String("machineID", builderVM.ID))

	return nil
}

// prepareSbomDownloadFiles creates the download work directory, writes
// download.json, and creates per-arch output directories. If this function
// returns an error, no syft processes have been started.
func prepareSbomDownloadFiles(ctx context.Context, runner buildbackend.Runner, workDir string, metadata sbom.SbomDownloadMetadata) error {
	if err := runner.MkdirAll(workDir); err != nil {
		return fmt.Errorf("failed to create SBOM download work dir %s: %w", workDir, err)
	}

	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("failed to marshal download metadata: %w", err)
	}

	downloadJSONPath := filepath.Join(workDir, "download.json")
	if err := runner.WriteFile(downloadJSONPath, string(metadataJSON)); err != nil {
		return fmt.Errorf("failed to write download.json: %w", err)
	}

	for _, platform := range sbomDownloadPlatforms {
		archDir := filepath.Join(workDir, platformToArchDir(platform))
		outputDir := filepath.Join(archDir, "output")
		if err := runner.MkdirAll(outputDir); err != nil {
			return fmt.Errorf("failed to create output dir %s: %w", outputDir, err)
		}
	}

	return nil
}

// buildSyftLaunchCommand constructs the nohup shell command that runs syft in
// the background on the builder. Syft pulls the image from the registry and
// generates SBOM output:
//   - sbom.spdx.json (SPDX JSON output, stored as the SBOM)
//   - sbom.syft.json (Syft JSON output, for extracting image size and digest)
//   - output/exit_code (syft exit code: 0=success)
//   - output/syft.stderr (syft stderr)
//   - output/syft.pid (actual syft process PID)
func buildSyftLaunchCommand(workDir, platform, registry, imageName, digest string) string {
	archDir := filepath.Join(workDir, platformToArchDir(platform))
	imageRef := registry + "/" + imageName + "@" + digest
	return fmt.Sprintf(`nohup bash -c '
  cd %q
  syft --platform %s -o spdx-json=./sbom.spdx.json -o syft-json=./sbom.syft.json registry:%s > output/syft.stderr 2>&1 &
  syft_pid=$!
  echo $syft_pid > output/syft.pid
  wait $syft_pid
  echo $? > output/exit_code
' > %q 2>&1 < /dev/null &`, archDir, platform, imageRef, filepath.Join(archDir, "download.log"))
}

// platformToArchDir converts a platform string (linux/amd64) to a directory-safe
// name (linux_amd64).
func platformToArchDir(platform string) string {
	return strings.ReplaceAll(platform, "/", "_")
}

// platformToDbArch converts a platform string (linux/amd64) to the database
// architecture format (x86_64).
func platformToDbArch(platform string) string {
	switch platform {
	case "linux/amd64":
		return "x86_64"
	case "linux/arm64":
		return "aarch64"
	default:
		return strings.ReplaceAll(platform, "linux/", "")
	}
}

// storeBuilderSbomResult reads the syft output files for a single architecture,
// extracts metadata, and stores the SBOM in the database.
func storeBuilderSbomResult(ctx context.Context, digest, platform, spdxJSON, syftJSON string) error {
	arch := platformToDbArch(platform)

	var imageSizeBytes int64
	var imageDigest string

	if syftJSON != "" {
		type syftJSONMetadata struct {
			Source struct {
				Metadata struct {
					ImageSize      int64  `json:"imageSize"`
					ManifestDigest string `json:"manifestDigest"`
				} `json:"metadata"`
			} `json:"source"`
		}
		var sj syftJSONMetadata
		if err := json.Unmarshal([]byte(syftJSON), &sj); err == nil {
			imageSizeBytes = sj.Source.Metadata.ImageSize
			imageDigest = sj.Source.Metadata.ManifestDigest
		}
	}

	if err := externalimage.SetExternalImageSBOM(ctx, digest, spdxJSON, "syft", arch, imageSizeBytes, imageDigest); err != nil {
		return externalimage.NewScanFailureError(externalimage.ErrSaveScanStatus,
			fmt.Sprintf("SBOM download completed but failed to store: %s", err.Error()))
	}

	logger.Info("stored SBOM result for architecture",
		zap.String("digest", digest),
		zap.String("arch", arch))
	telemetry.Increment(telemetry.MetricExternalImageSBOMSucceeded, []string{telemetry.TagChannelExternalImageSBOM})

	return nil
}

// revertSbomDownloadToPending transitions SBOM status from 'generating' back to
// 'pending' after a failed dispatch. This allows the scheduler to re-enqueue.
func revertSbomDownloadToPending(ctx context.Context, digest string) error {
	if err := externalimage.SetSBOMStatusFailed(ctx, digest, "dispatch failed, will retry"); err != nil {
		return fmt.Errorf("failed to revert SBOM status to failed: %w", err)
	}
	return nil
}
