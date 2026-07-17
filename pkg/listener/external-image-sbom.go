package listener

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/securebuildhq/securebuild/pkg/externalimage"
	extimgtypes "github.com/securebuildhq/securebuild/pkg/externalimage/types"
	image "github.com/securebuildhq/securebuild/pkg/image"
	"github.com/securebuildhq/securebuild/pkg/listener/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/sbom"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

// contextKey is an unexported type for context keys in this package.
type contextKey string

const (
	fetchSBOMFuncKey         contextKey = "fetchSBOMFunc"
	scanExternalImageFuncKey contextKey = "scanExternalImageFunc"
)

// WithMockFetchSBOM returns a context that carries a mock SBOM fetch function.
// Each caller gets its own isolated mock, making parallel tests safe.
func WithMockFetchSBOM(ctx context.Context, mock func(context.Context, string, string, string) ([]sbom.SBOMResult, error)) context.Context {
	return context.WithValue(ctx, fetchSBOMFuncKey, mock)
}

// WithMockScanExternalImage returns a context that carries a mock scan function.
// Each caller gets its own isolated mock, making parallel tests safe.
func WithMockScanExternalImage(ctx context.Context, mock func(context.Context, string) (map[string]string, error)) context.Context {
	return context.WithValue(ctx, scanExternalImageFuncKey, mock)
}

// getFetchSBOMFunc returns the SBOM fetch function from the context if injected,
// otherwise falls back to the real implementation.
func getFetchSBOMFunc(ctx context.Context) func(context.Context, string, string, string) ([]sbom.SBOMResult, error) {
	if f, ok := ctx.Value(fetchSBOMFuncKey).(func(context.Context, string, string, string) ([]sbom.SBOMResult, error)); ok {
		return f
	}
	return sbom.FetchSBOM
}

// getScanExternalImageFunc returns the scan function from the context if injected,
// otherwise falls back to the real implementation.
func getScanExternalImageFunc(ctx context.Context) func(context.Context, string) (map[string]string, error) {
	if f, ok := ctx.Value(scanExternalImageFuncKey).(func(context.Context, string) (map[string]string, error)); ok {
		return f
	}
	return scan.ScanExternalImage
}

// HandleExternalImageSbom processes an external image SBOM generation request.
// Exported for integration testing.
func HandleExternalImageSbom(ctx context.Context, p types.ExternalImageSbomPayload) error {
	attempt, maxAttempts := GetAttemptInfo(ctx)
	logger.Info("HandleExternalImageSbom", zap.String("digest", p.Digest), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts))

	externalImage, err := externalimage.GetExternalImageForDigest(ctx, p.Digest)
	if err != nil {
		// If the digest no longer exists in external_image_tag, this is a
		// stale digest.
		// Mark as non-retryable since the digest will never be found again.
		if errors.Is(err, externalimage.ErrExternalImageNotFound) {
			telemetry.Increment(telemetry.MetricExternalImageSBOMFailed, []string{telemetry.TagChannelExternalImageSBOM, externalimage.ReasonForDatadogMetric(err)})
			return NewNonRetryableError(err)
		}
		return fmt.Errorf("failed to get external image: %w", err)
	}

	// Check if we already have SBOM data for this digest (GetExternalImageSBOM returns *string).
	// No span here: GetExternalImageSBOM is SQL and already traced by the client.
	var currentSBOM *string
	currentSBOM, err = externalimage.GetExternalImageSBOM(ctx, p.Digest)
	if err != nil {
		return fmt.Errorf("failed to get external image sbom: %w", err)
	}
	if currentSBOM != nil && !p.EnqueueRescanAfter {
		// SBOM exists and this is not a rescan request - nothing to do
		logger.Debug("SBOM already exists for digest and not a rescan request, skipping", zap.String("digest", p.Digest))
		return nil
	}

	// Initialize SBOM status if it doesn't exist yet (handles UI-triggered scans)
	// Uses ON CONFLICT DO NOTHING, so won't overwrite existing status from monitor
	if err := externalimage.InitializeSBOMStatusPending(ctx, p.Digest); err != nil {
		logger.Warnf("failed to initialize SBOM status for digest %s: %s", p.Digest, err.Error())
		// Continue anyway - this is just a status update
	}

	// Update SBOM status to 'generating' to indicate SBOM generation has started.
	// This is done AFTER the early-return check to avoid resetting status on duplicate jobs.
	if err := externalimage.SetSBOMStatusGenerating(ctx, p.Digest); err != nil {
		logger.Warnf("failed to set SBOM status to generating for digest %s: %s", p.Digest, err.Error())
		// Continue anyway - this is just a status update
	}

	// For rescan requests (EnqueueRescanAfter=true), check if we need to regenerate SBOMs
	// to populate missing image_digest metadata. No span around GetExternalImageSBOMs: SQL is already traced.
	if currentSBOM != nil && p.EnqueueRescanAfter {
		storedSBOMs, sbomErr := externalimage.GetExternalImageSBOMs(ctx, p.Digest)
		if sbomErr != nil {
			return fmt.Errorf("failed to get SBOMs for rescan check: %w", sbomErr)
		}
		needsRegeneration := false
		for _, s := range storedSBOMs {
			if s.ImageDigest == "" {
				needsRegeneration = true
				break
			}
		}
		if !needsRegeneration {
			// SBOM exists with image_digest populated, just run scan
			logger.Info("SBOM already exists with image_digest, running scan only",
				zap.String("digest", p.Digest), zap.Bool("rescan_request", p.EnqueueRescanAfter), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts))

			// Mark SBOM status as succeeded since we know the SBOM exists and is valid
			if err := externalimage.SetSBOMStatusSucceeded(ctx, p.Digest); err != nil {
				logger.Warn("failed to set SBOM status to succeeded for digest", zap.String("digest", p.Digest), zap.Error(err), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts), zap.Bool("retryable", true))
				// Continue anyway - the SBOM exists and we can run the scan
			} else {
				logger.Info("SBOM succeeded", zap.String("digest", p.Digest), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts))
				telemetry.Increment(telemetry.MetricExternalImageSBOMSucceeded, []string{telemetry.TagChannelExternalImageSBOM})
			}

			return RunScanForDigest(ctx, p.Digest)
		}
		logger.Info("SBOM exists but missing image_digest, regenerating",
			zap.String("digest", p.Digest), zap.Bool("rescan_request", p.EnqueueRescanAfter), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts))
	}

	sbomResults, err := getFetchSBOMFunc(ctx)(ctx, externalImage.Registry, externalImage.ImageName, p.Digest)
	if err != nil {
		// Mark SBOM status as failed so the UI shows failure. Return error so listener retries (up to 5x);
		// a later attempt may succeed (e.g. rate limit, timeout) and we'll set status to succeeded then.
		recordSBOMFailure(ctx, p.Digest, externalimage.NewScanFailureError(externalimage.ErrFetchSBOM, fmt.Sprintf("failed to fetch SBOM: %s", err.Error())), true, attempt, maxAttempts)
		return fmt.Errorf("failed to fetch sbom: %w", err)
	}

	if len(sbomResults) == 0 {
		recordSBOMFailure(ctx, p.Digest, externalimage.NewScanFailureError(externalimage.ErrNoSBOMDataAvailable, "empty SBOM results"), false, attempt, maxAttempts)

		// If this was a rescan request, also record scan failures on the existing architecture rows
		// so the UI shows the failure instead of being stuck on "queued"
		if p.EnqueueRescanAfter {
			logger.Warn("no SBOM data available for rescan request", zap.String("digest", p.Digest), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts), zap.Bool("retryable", false))
			// Get existing SBOMs to know which architectures to mark as failed
			storedSBOMs, sbomErr := externalimage.GetExternalImageSBOMs(ctx, p.Digest)
			if sbomErr != nil {
				logger.Warn("failed to get SBOMs for recording failure", zap.String("digest", p.Digest), zap.Error(sbomErr), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts), zap.Bool("retryable", false))
			} else if len(storedSBOMs) > 0 {
				for _, s := range storedSBOMs {
					if recordErr := externalimage.SetExternalImageScanStatus(ctx, externalimage.SetExternalImageScanStatusParams{
						Digest:            p.Digest,
						Arch:              s.Arch,
						Status:            externalimage.ScanStatusFailed,
						ScanStatusMessage: "no SBOM data available from registry",
					}); recordErr != nil {
						logger.Warn("failed to record scan failure for empty SBOM", zap.String("digest", p.Digest), zap.String("arch", s.Arch), zap.Error(recordErr), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts), zap.Bool("retryable", false))
					}
				}
			}
		}

		return NewNonRetryableError(externalimage.ErrNoSBOMDataAvailable)
	}

	// Store SBOMs for all available architectures (each SetExternalImageSBOM is traced inside that function)
	var foundArchs []string
	for _, result := range sbomResults {
		arch := extractArchFromPlatform(result.Architecture)
		foundArchs = append(foundArchs, arch)
		if err := externalimage.SetExternalImageSBOM(ctx, p.Digest, result.SBOM, result.Source, arch, result.ImageSizeBytes, result.ImageDigest); err != nil {
			return fmt.Errorf("failed to set external image sbom for arch %s: %w", arch, err)
		}
	}

	// Mark SBOM status as succeeded (single status for all architectures)
	if err := externalimage.SetSBOMStatusSucceeded(ctx, p.Digest); err != nil {
		logger.Warn("failed to set SBOM status to succeeded for digest", zap.String("digest", p.Digest), zap.Error(err), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts), zap.Bool("retryable", true))
		// Continue anyway - the SBOM data was stored successfully
	} else {
		logger.Info("SBOM succeeded", zap.String("digest", p.Digest), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts))
		telemetry.Increment(telemetry.MetricExternalImageSBOMSucceeded, []string{telemetry.TagChannelExternalImageSBOM})
	}

	// Initialize scan status to 'queued' for all architectures
	// This ensures the UI shows "Queued" instead of "Not attempted" while waiting for scan
	for _, arch := range foundArchs {
		if err := externalimage.InitializeScanStatusQueued(ctx, p.Digest, arch); err != nil {
			logger.Warn("failed to initialize scan status to queued for digest", zap.String("digest", p.Digest), zap.String("arch", arch), zap.Error(err), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts), zap.Bool("retryable", true))
			// Continue with remaining architectures - this is a non-critical status update
		}
	}

	// Run scan if EnqueueRescanAfter is set (rescan request with missing SBOM)
	if p.EnqueueRescanAfter {
		logger.Info("running scan after SBOM fetch",
			zap.String("digest", p.Digest), zap.Bool("rescan_request", p.EnqueueRescanAfter), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts))
		return RunScanForDigest(ctx, p.Digest)
	}

	return nil
}

// extractArchFromPlatform converts platform format (linux/amd64) to arch format (x86_64)
func extractArchFromPlatform(platform string) string {
	// Remove "linux/" prefix if present
	arch := platform
	if strings.HasPrefix(platform, "linux/") {
		arch = strings.TrimPrefix(platform, "linux/")
	}

	// Convert common architecture names to database format
	switch arch {
	case "amd64":
		return "x86_64"
	case "arm64":
		return "aarch64"
	default:
		return arch
	}
}

// storeScanResults parses and stores scan results per architecture.
// The span is started inside this function so the traced operation is the function itself.
// Returns the list of architectures that were successfully stored.
func storeScanResults(ctx context.Context, digest string, scanResults map[string]string, attempt, maxAttempts int) (successArchs []string, err error) {
	span, ctx := telemetry.StartSpan(ctx, "listener.external_image_scan.store_results")
	defer func() {
		if err != nil {
			span.SetTag("error", err)
		}
		span.Finish()
	}()

	for arch, scanResult := range scanResults {
		parsedResults, parseErr := image.ParseScanResultDetails(scanResult)
		if parseErr != nil {
			recordScanFailure(ctx, digest, arch, externalimage.NewScanFailureError(externalimage.ErrParseScanResult, fmt.Sprintf("failed to parse scan result: %s", parseErr.Error())), false, attempt, maxAttempts)
			continue
		}

		countsJSON, marshalErr := json.Marshal(parsedResults.Counts)
		if marshalErr != nil {
			recordScanFailure(ctx, digest, arch, externalimage.NewScanFailureError(externalimage.ErrMarshalScanCounts, fmt.Sprintf("failed to marshal scan counts: %s", marshalErr.Error())), false, attempt, maxAttempts)
			continue
		}

		summaryJSON, marshalErr := json.Marshal(parsedResults)
		if marshalErr != nil {
			recordScanFailure(ctx, digest, arch, externalimage.NewScanFailureError(externalimage.ErrMarshalScanSummary, fmt.Sprintf("failed to marshal scan summary: %s", marshalErr.Error())), false, attempt, maxAttempts)
			continue
		}

		if setErr := externalimage.SetExternalImageScanStatus(ctx, externalimage.SetExternalImageScanStatusParams{
			Digest:               digest,
			Arch:                 arch,
			Status:               externalimage.ScanStatusSucceeded,
			ParsedResults:        string(countsJSON),
			ParsedResultsDetails: string(summaryJSON),
			RawResult:            scanResult,
		}); setErr != nil {
			recordScanFailure(ctx, digest, arch, externalimage.NewScanFailureError(externalimage.ErrSaveScanStatus, fmt.Sprintf("scan completed but failed to save results: %s", setErr.Error())), false, attempt, maxAttempts)
			continue
		}

		successArchs = append(successArchs, arch)
		logger.Info("stored scan result for architecture",
			zap.String("digest", digest),
			zap.String("arch", arch),
			zap.Int("attempt", attempt),
			zap.Int("max_attempts", maxAttempts))
	}
	if len(scanResults) > 0 && len(successArchs) == 0 {
		err = fmt.Errorf("failed to store scan results for any of %d architecture(s)", len(scanResults))
		return nil, err
	}
	return successArchs, nil
}

// HandleExternalImageScan processes an on-demand external image scan request
// from the external_image_scan work queue channel. It performs an idempotency
// check (discard if scanned within 4 hours) and then delegates to RunScanForDigest.
// Exported for integration testing.
func HandleExternalImageScan(ctx context.Context, payloadJSON string) error {
	p := types.ExternalImageScanPayload{}
	if err := json.Unmarshal([]byte(payloadJSON), &p); err != nil {
		return fmt.Errorf("failed to unmarshal external image scan payload: %w", err)
	}

	if p.Digest == "" {
		return fmt.Errorf("external image scan payload missing digest")
	}

	recent, err := externalimage.WasScannedRecently(ctx, p.Digest, 4*time.Hour)
	if err != nil {
		logger.Warn("failed to check scan recency, proceeding with scan",
			zap.String("digest", p.Digest),
			zap.Error(err))
	} else if recent {
		logger.Info("discarding external_image_scan message: scan completed within 4 hours",
			zap.String("digest", p.Digest))
		return nil
	}

	return RunScanForDigest(ctx, p.Digest)
}

// RunScanForDigest runs a security scan for a digest that already has SBOM data.
//
// In production, it enqueues an external_image_scan work item for builder-based
// dispatch. The work item is processed by HandleExternalImageScanOnBuilder which
// dispatches the scan to a builder VM, and the poller collects results.
//
// When a mock scan function is injected via WithMockScanExternalImage (used by
// integration tests), it falls back to the in-process scan path: sets status to
// running, calls the scan function, and stores results or failures synchronously.
// This allows integration tests to verify scan state transitions without builders.
//
// Exported for integration testing.
func RunScanForDigest(ctx context.Context, digest string) error {
	attempt, maxAttempts := GetAttemptInfo(ctx)

	// If a mock scan function is injected, use the in-process scan path.
	// This is used by integration tests that don't have builder VMs.
	if _, hasMock := ctx.Value(scanExternalImageFuncKey).(func(context.Context, string) (map[string]string, error)); hasMock {
		return runScanForDigestInProcess(ctx, digest, attempt, maxAttempts)
	}

	// Production: enqueue work item for builder-based dispatch.
	payload, err := json.Marshal(types.ExternalImageScanPayload{Digest: digest})
	if err != nil {
		return fmt.Errorf("failed to marshal scan payload: %w", err)
	}

	if err := persistence.EnqueueWork(ctx, "external_image_scan", string(payload)); err != nil {
		return fmt.Errorf("failed to enqueue external image scan: %w", err)
	}

	logger.Info("enqueued external image scan for digest",
		zap.String("digest", digest))

	return nil
}

// runScanForDigestInProcess runs the scan synchronously in-process using the
// scan function from context (real or mocked). This is the legacy path used
// by integration tests that inject mock scan functions.
func runScanForDigestInProcess(ctx context.Context, digest string, attempt, maxAttempts int) error {
	var storedSBOMs []extimgtypes.ExternalImageSBOM
	storedSBOMs, err := externalimage.GetExternalImageSBOMs(ctx, digest)
	if err != nil {
		return fmt.Errorf("failed to get SBOMs: %w", err)
	}
	if len(storedSBOMs) == 0 {
		return NewNonRetryableError(fmt.Errorf("RunScanForDigest called but no SBOMs found for digest %s", digest))
	}

	for _, s := range storedSBOMs {
		if err := externalimage.SetScanStatusRunning(ctx, digest, s.Arch); err != nil {
			logger.Warn("failed to set scan status to running", zap.String("digest", digest), zap.String("arch", s.Arch), zap.Error(err), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts), zap.Bool("retryable", true))
		}
	}

	scanResults, err := getScanExternalImageFunc(ctx)(ctx, digest)
	if err != nil {
		storedSBOMsForFail, sbomErr := externalimage.GetExternalImageSBOMs(ctx, digest)
		if sbomErr != nil {
			return fmt.Errorf("failed to get SBOMs for recording scan failure: %w", sbomErr)
		}
		scanErr := externalimage.NewScanFailureError(externalimage.ErrScanExecutionFailed, err.Error())
		for _, s := range storedSBOMsForFail {
			recordScanFailure(ctx, digest, s.Arch, scanErr, false, attempt, maxAttempts)
		}
		return nil
	}

	successArchs, err := storeScanResults(ctx, digest, scanResults, attempt, maxAttempts)
	if err != nil {
		logger.Warn("all architectures failed to store scan results; failures recorded, not retrying",
			zap.String("digest", digest),
			zap.Int("architectures", len(scanResults)),
			zap.Error(err),
			zap.Int("attempt", attempt),
			zap.Int("max_attempts", maxAttempts))
		return nil
	}

	allExpectedArchsGotScanResults := true
	for _, sbom := range storedSBOMs {
		if _, hasResult := scanResults[sbom.Arch]; !hasResult {
			recordScanFailure(ctx, digest, sbom.Arch, externalimage.NewScanFailureError(externalimage.ErrNoScanResultForArch, fmt.Sprintf("scan did not return results for this architecture: %s", sbom.Arch)), false, attempt, maxAttempts)
			allExpectedArchsGotScanResults = false
		}
	}

	logger.Info("successfully completed scan",
		zap.String("digest", digest),
		zap.Int("architectures_scanned", len(scanResults)),
		zap.Int("attempt", attempt),
		zap.Int("max_attempts", maxAttempts))
	if len(storedSBOMs) > 0 && allExpectedArchsGotScanResults && len(successArchs) == len(scanResults) {
		telemetry.Increment(telemetry.MetricExternalImageScanSucceeded, []string{telemetry.TagChannelExternalImageScan})
	}

	if err := scan.UpdateLastSecurityScanned(ctx, digest, successArchs, time.Now().UTC()); err != nil {
		logger.Warn("failed to update last_security_scanned_at",
			zap.String("digest", digest),
			zap.Error(err))
	}

	return nil
}

// recordSBOMFailure records SBOM failure in the DB and increments the failed metric only for non-retryable failures.
func recordSBOMFailure(ctx context.Context, digest string, reason error, retryable bool, attempt, maxAttempts int) {
	if recordErr := externalimage.SetSBOMStatusFailed(ctx, digest, reason.Error()); recordErr != nil {
		logger.Warn("failed to record SBOM failure for digest", zap.String("digest", digest), zap.Error(recordErr), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts), zap.Bool("retryable", retryable))
	}
	if !retryable {
		telemetry.Increment(telemetry.MetricExternalImageSBOMFailed, []string{telemetry.TagChannelExternalImageSBOM, externalimage.ReasonForDatadogMetric(reason)})
	}
}

// recordScanFailure records scan failure in the DB and increments the failed metric only for non-retryable failures.
func recordScanFailure(ctx context.Context, digest, arch string, reason error, retryable bool, attempt, maxAttempts int) {
	logger.Warn("scan failed", zap.String("digest", digest), zap.String("arch", arch), zap.Error(reason), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts), zap.Bool("retryable", retryable))
	if recordErr := externalimage.SetExternalImageScanStatus(ctx, externalimage.SetExternalImageScanStatusParams{
		Digest:            digest,
		Arch:              arch,
		Status:            externalimage.ScanStatusFailed,
		ScanStatusMessage: reason.Error(),
	}); recordErr != nil {
		logger.Warn("failed to record scan failure", zap.String("digest", digest), zap.String("arch", arch), zap.Error(recordErr), zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts), zap.Bool("retryable", retryable))
	}
	if !retryable {
		telemetry.Increment(telemetry.MetricExternalImageScanFailed, []string{telemetry.TagChannelExternalImageScan, externalimage.ReasonForDatadogMetric(reason)})
	}
}
