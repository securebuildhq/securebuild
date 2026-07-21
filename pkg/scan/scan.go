package scan

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	syftpkg "github.com/anchore/syft/syft/pkg"
	"github.com/securebuildhq/securebuild/pkg/anchore"
	"github.com/securebuildhq/securebuild/pkg/externalimage"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/security"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"github.com/securebuildhq/securebuild/pkg/util"
	"go.uber.org/zap"
)

func ScanExternalImage(ctx context.Context, digest string) (results map[string]string, err error) {
	span, ctx := telemetry.StartSpan(ctx, "scan.ScanExternalImage")
	defer func() {
		if err != nil {
			span.SetTag("error", err)
		}
		span.Finish()
	}()

	// Get all stored SBOMs for this digest
	sboms, err := externalimage.GetExternalImageSBOMs(ctx, digest)
	if err != nil {
		return nil, fmt.Errorf("failed to get external image SBOMs: %w", err)
	}

	if len(sboms) == 0 {
		return nil, fmt.Errorf("no SBOMs found for digest %s", digest)
	}

	// Create Grype scanner with default database (not custom DB for external images)
	scanner, err := anchore.NewGrypeScanner(ctx, false)
	if err != nil {
		return nil, fmt.Errorf("failed to create Grype scanner: %w", err)
	}
	defer scanner.Close()

	results = make(map[string]string)

	for _, sbom := range sboms {
		startTime := time.Now()

		// Parse the SBOM to extract packages
		sbomObj, err := anchore.ParseSBOM(sbom.SBOM)
		if err != nil {
			logger.Warn("failed to parse SBOM",
				zap.String("digest", digest),
				zap.String("arch", sbom.Arch),
				zap.Error(err))
			continue
		}

		// Scan the SBOM using Grype library and get official JSON
		grypeJSON, err := scanner.ScanSBOMForCVEs(ctx, sbom.SBOM)
		duration := time.Since(startTime)

		if err != nil {
			logger.Warn("grype scan failed for SBOM",
				zap.String("digest", digest),
				zap.String("arch", sbom.Arch),
				zap.String("duration", duration.String()),
				zap.Error(err))
			continue
		}

		results[sbom.Arch] = grypeJSON

		// Update package fixed versions for APK packages in this SBOM
		// This helps us discover which package versions contain fixed artifact versions
		for pkg := range sbomObj.Artifacts.Packages.Enumerate() {
			// Only process APK packages (OS packages), not language dependencies
			if pkg.Type != syftpkg.ApkPkg {
				continue
			}

			err := security.UpdatePackageFixVersions(ctx, sbomObj, pkg)
			if err != nil {
				logger.Warn("failed to update package fix versions",
					zap.String("digest", digest),
					zap.String("arch", sbom.Arch),
					zap.String("package", pkg.Name),
					zap.String("version", pkg.Version),
					zap.Error(err))
				// Continue processing other packages even if one fails
			}
		}

		logger.Debug("successfully scanned SBOM",
			zap.String("digest", digest),
			zap.String("arch", sbom.Arch),
			zap.String("duration", duration.String()))
	}

	if len(results) == 0 {
		return nil, fmt.Errorf("failed to scan any SBOMs for digest %s", digest)
	}

	return results, nil
}

// ScanCatalogImageSBOMsStandard scans SBOMs using standard Grype database
// Includes: NVD, GitHub, and SecureOS provider (which consumes our secdb feed)
// Use for: WWW security page display to show vulnerabilities with SecureBuild fixes
func ScanCatalogImageSBOMsStandard(ctx context.Context, sbomX86, sbomAarch64 string) (map[string]string, error) {
	return scanCatalogImageSBOMs(ctx, sbomX86, sbomAarch64, false)
}

// ScanCatalogImageSBOMsCustom scans SBOMs using custom database (built by Vunnel)
// Includes: NVD and GitHub only (NO SecureOS provider)
// Use for: SecDB feed generation (to avoid circular dependency)
func ScanCatalogImageSBOMsCustom(ctx context.Context, sbomX86, sbomAarch64 string) (map[string]string, error) {
	return scanCatalogImageSBOMs(ctx, sbomX86, sbomAarch64, true)
}

// scanCatalogImageSBOMs is the internal implementation that scans SBOMs using Grype
func scanCatalogImageSBOMs(ctx context.Context, sbomX86, sbomAarch64 string, useCustomDB bool) (map[string]string, error) {
	results := make(map[string]string)
	var mu sync.Mutex
	var wg sync.WaitGroup

	// Define SBOM data with architecture labels
	sboms := []struct {
		arch    string
		content string
	}{}

	if sbomX86 != "" {
		sboms = append(sboms, struct{ arch, content string }{"x86_64", sbomX86})
	}
	if sbomAarch64 != "" {
		sboms = append(sboms, struct{ arch, content string }{"aarch64", sbomAarch64})
	}

	// Scan SBOMs in parallel with goroutines
	for _, sbom := range sboms {
		wg.Add(1)
		go func(arch, content string) {
			defer wg.Done()

			result, err := runGrypeOnCatalogSBOM(ctx, content, arch, useCustomDB)
			if err != nil {
				logger.Warn("Failed to scan SBOM",
					zap.String("arch", arch),
					zap.Bool("useCustomDB", useCustomDB),
					zap.Error(err))
				return
			}

			mu.Lock()
			results[arch] = result
			mu.Unlock()
		}(sbom.arch, sbom.content)
	}

	// Wait for all goroutines to complete
	wg.Wait()

	if len(results) == 0 {
		return nil, fmt.Errorf("failed to scan any SBOMs")
	}

	return results, nil
}

// runGrypeOnCatalogSBOM runs Grype on a single SBOM content string and returns official Grype JSON
func runGrypeOnCatalogSBOM(ctx context.Context, sbomContent, arch string, useCustomDB bool) (string, error) {
	// Create Grype scanner with specified database type
	// useCustomDB=true: Custom database (NVD + GitHub only) for feed generation
	// useCustomDB=false: Standard database (NVD + GitHub + SecureOS) for WWW display
	scanner, err := anchore.NewGrypeScanner(ctx, useCustomDB)
	if err != nil {
		return "", fmt.Errorf("failed to create Grype scanner: %w", err)
	}
	defer scanner.Close()

	// Scan the SBOM using Grype library and get official JSON
	startTime := time.Now()
	grypeJSON, err := scanner.ScanSBOMForCVEs(ctx, sbomContent)
	if err != nil {
		return "", fmt.Errorf("grype scan failed for arch %s: %w", arch, err)
	}

	duration := time.Since(startTime)

	dbType := "custom"
	if !useCustomDB {
		dbType = "standard"
	}

	logger.Debug("successfully scanned catalog SBOM",
		zap.String("arch", arch),
		zap.String("database", dbType),
		zap.String("duration", duration.String()))

	return grypeJSON, nil
}

func getRegistryHostname(imageURL string) (string, error) {
	parts := strings.Split(imageURL, "/")
	if len(parts) < 2 {
		return "index.docker.io", nil
	}

	return parts[0], nil
}

// scanTier defines a back-off tier for rescan scheduling.
// Each tier has a last_submitted_at window and a rescan interval.
// Tiers are queried in priority order; higher tiers are filled before
// lower tiers contribute digests. Images submitted >90 days ago (tier 5)
// are excluded from the scheduler entirely (on-demand only).
//
// submittedAfter is the minimum age (e.g. "7 days" means submitted more than 7 days ago).
// submittedBefore is the maximum age (e.g. "0 days" means submitted less than 0 days ago = now).
// The tier window is: ref - submittedBefore < last_submitted_at <= ref - submittedAfter
// For active: submitted 0-7 days ago → last_submitted > ref-7d AND last_submitted <= ref-0d
type scanTier struct {
	name            string
	submittedAfter  string // minimum age: last_submitted_at > ref - interval
	submittedBefore string // maximum age: last_submitted_at <= ref - interval
	rescanInterval  string // rescan threshold: last_security_scanned_at < ref - interval
}

var scanTiers = []scanTier{
	{name: "active", submittedAfter: "7 days", submittedBefore: "0 days", rescanInterval: "4 hours"},
	{name: "recent", submittedAfter: "30 days", submittedBefore: "7 days", rescanInterval: "24 hours"},
	{name: "stale", submittedAfter: "90 days", submittedBefore: "30 days", rescanInterval: "7 days"},
}

// ScanStalenessThreshold is how old a 'queued' or 'running' scan row must be
// before the scheduler considers it stale and re-selects the digest. This
// handles rows orphaned by lost queue messages, worker crashes, or builder
// disappearances. Must be longer than ScanTimeout (10 min) + poller interval
// (10 s) to avoid re-enqueueing scans that are still legitimately in flight.
const ScanStalenessThreshold = 1 * time.Hour

// SelectExternalImageDigestsToScan returns a prioritized list of external image digests to scan.
//
// Priority order:
//  1. Never scanned: digests with SBOMs but no scans yet
//  2. Active tier:  last_submitted < 7 days,    rescan if older than 4 hours
//  3. Recent tier:  last_submitted 7-30 days,   rescan if older than 24 hours
//  4. Stale tier:   last_submitted 30-90 days,  rescan if older than 7 days
//  5. Excluded:     last_submitted > 90 days    — not scanned by scheduler
//
// Each tier uses ORDER BY random() for fair distribution within the tier.
// After each query, remaining capacity is evaluated; if 0, lower tiers are skipped.
// A seen map prevents duplicate digests across tiers.
func SelectExternalImageDigestsToScan(ctx context.Context, maxToProcess int) ([]string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	if maxToProcess <= 0 {
		maxToProcess = 25
	}

	referenceTime := util.GetNowFunc(ctx)()

	selectedDigests := make([]string, 0, maxToProcess)
	seen := map[string]struct{}{}

	// Tier 1: Digests with SBOMs but no scans yet (first scan, highest priority).
	// Exclude digests that have a recent scan in 'running' status so the
	// scheduler doesn't re-enqueue scans that are already in flight.
	// 'queued' rows are NOT excluded — when no builder is available, the
	// handler discards the message without claiming, leaving the row as
	// 'queued'. The scheduler must be able to re-select these so the scan
	// is retried when a builder frees up. Duplicate work items are handled
	// by claimScanForDispatch (first handler wins) and isScanAlreadyRunning.
	// Stale 'running' rows (older than ScanStalenessThreshold) are ignored
	// so that orphaned scans from crashed workers can be recovered.
	staleThreshold := fmt.Sprintf("%d minutes", int(ScanStalenessThreshold.Minutes()))
	rows, err := conn.Query(ctx, `
		SELECT s.digest
		FROM external_image_sbom s
		WHERE s.last_security_scanned_at IS NULL
		  AND NOT EXISTS (
		    SELECT 1 FROM external_image_scan sc
		    WHERE sc.digest = s.digest
		      AND sc.status = 'running'
		      AND sc.scan_status_updated_at > NOW() - interval '`+staleThreshold+`'
		  )
		GROUP BY s.digest
		ORDER BY random()
		LIMIT $1
	`, maxToProcess)
	if err != nil {
		return nil, fmt.Errorf("failed to query digests missing scans: %w", err)
	}
	for rows.Next() {
		var digest string
		if err := rows.Scan(&digest); err != nil {
			logger.Warn("failed to scan row for missing-scan digest", zap.Error(err))
			continue
		}
		selectedDigests = append(selectedDigests, digest)
		seen[digest] = struct{}{}
	}
	rows.Close()

	remaining := maxToProcess - len(selectedDigests)

	// Tiers 2-4: Back-off tiers based on last_submitted_at
	for _, tier := range scanTiers {
		if remaining <= 0 {
			break
		}

		query := fmt.Sprintf(`
			WITH tier_tags AS (
				SELECT digest
				FROM external_image_tag
				WHERE last_submitted_at > $2::timestamptz - interval '%s'
				  AND last_submitted_at <= $2::timestamptz - interval '%s'
				GROUP BY digest
			)
			SELECT s.digest
			FROM external_image_sbom s
			JOIN tier_tags t ON t.digest = s.digest
			WHERE s.last_security_scanned_at IS NOT NULL
			  AND s.last_security_scanned_at < $2::timestamptz - interval '%s'
			  AND NOT EXISTS (
			    SELECT 1 FROM external_image_scan sc
			    WHERE sc.digest = s.digest
			      AND sc.status = 'running'
			      AND sc.scan_status_updated_at > NOW() - interval '%s'
			  )
			GROUP BY s.digest
			ORDER BY random()
			LIMIT $1
		`, tier.submittedAfter, tier.submittedBefore, tier.rescanInterval, staleThreshold)

		rows, err := conn.Query(ctx, query, remaining, referenceTime)
		if err != nil {
			return nil, fmt.Errorf("failed to query %s tier digests: %w", tier.name, err)
		}
		for rows.Next() {
			var digest string
			if err := rows.Scan(&digest); err != nil {
				logger.Warn("failed to scan row for tier digest", zap.String("tier", tier.name), zap.Error(err))
				continue
			}
			if _, ok := seen[digest]; ok {
				continue
			}
			selectedDigests = append(selectedDigests, digest)
			seen[digest] = struct{}{}
			remaining--
		}
		rows.Close()
	}

	return selectedDigests, nil
}

// UpdateLastSecurityScanned updates the last_security_scanned_at timestamp
// for the specified architectures of a digest. If archs is empty, no update
// is performed.
func UpdateLastSecurityScanned(ctx context.Context, digest string, archs []string, t time.Time) error {
	if len(archs) == 0 {
		return nil
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	if _, err := conn.Exec(ctx, `UPDATE external_image_sbom SET last_security_scanned_at = $3 WHERE digest = $1 AND arch = ANY($2)`, digest, archs, t); err != nil {
		return err
	}
	return nil
}

// processExternalImageScans selects external image SBOMs to scan and enqueues
// them as external_image_scan work items for builder-based dispatch.
// Selection uses tiered back-off based on last_submitted_at (see SelectExternalImageDigestsToScan).
// Scheduler backpressure: only enqueues if the total in-memory scan count is below
// PoolSize * 2 * MaxScansPerBuilder (×2 for the two architecture pools).
// returns true if there are no more digests to scan
func processExternalImageScans(ctx context.Context, maxToProcess int, cache *ScanCapacityCache) (bool, error) {
	if cache != nil {
		maxConcurrent := param.GetParam(ctx).PoolSize * 2 * param.GetParam(ctx).MaxScansPerBuilder
		activeScans := cache.GetTotalScanCount()
		if activeScans >= maxConcurrent {
			logger.Info("scan scheduler at capacity, pausing enqueue",
				zap.Int("active_scans", activeScans),
				zap.Int("max_concurrent", maxConcurrent))
			return false, nil
		}
	}

	selectedDigests, err := SelectExternalImageDigestsToScan(ctx, maxToProcess)
	if err != nil {
		return false, err
	}

	if len(selectedDigests) == 0 {
		return true, nil
	}

	logger.Info("enqueuing external image scans", zap.Int("count", len(selectedDigests)))

	for _, digest := range selectedDigests {
		payload, err := json.Marshal(map[string]string{"digest": digest})
		if err != nil {
			logger.Warn("failed to marshal scan payload",
				zap.String("digest", digest),
				zap.Error(err))
			continue
		}

		if err := persistence.EnqueueWork(ctx, "external_image_scan", string(payload)); err != nil {
			logger.Warn("failed to enqueue external image scan",
				zap.String("digest", digest),
				zap.Error(err))
			continue
		}
	}

	return false, nil
}

// ReportScanMetrics sends gauge metrics for the scan backlog and running scans.
//
// For each tier (including never-scanned), it counts digests that have not been
// scanned within their respective rescan interval — i.e., digests that are
// eligible for scanning right now. It also counts how many scans are currently
// in the 'running' status.
//
// Gauges sent:
//   - securebuild.external_image.scan.backlog  (tag: tier=<never_scanned|active|recent|stale>)
//   - securebuild.external_image.scan.running
func ReportScanMetrics(ctx context.Context) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	referenceTime := util.GetNowFunc(ctx)()

	// Never scanned: digests with SBOMs where last_security_scanned_at IS NULL
	var neverScannedCount int
	if err := conn.QueryRow(ctx, `
		SELECT COUNT(DISTINCT s.digest)
		FROM external_image_sbom s
		WHERE s.last_security_scanned_at IS NULL
	`).Scan(&neverScannedCount); err != nil {
		logger.Warn("failed to count never-scanned digests", zap.Error(err))
	} else {
		telemetry.Gauge(telemetry.MetricExternalImageScanBacklog, float64(neverScannedCount),
			[]string{telemetry.TagScanTier + ":never_scanned"})
	}

	// Per-tier backlog: digests whose last_security_scanned_at is older than
	// the tier's rescan interval, within the tier's last_submitted_at window.
	for _, tier := range scanTiers {
		var count int
		query := fmt.Sprintf(`
			WITH tier_tags AS (
				SELECT digest
				FROM external_image_tag
				WHERE last_submitted_at > $1::timestamptz - interval '%s'
				  AND last_submitted_at <= $1::timestamptz - interval '%s'
				GROUP BY digest
			)
			SELECT COUNT(DISTINCT s.digest)
			FROM external_image_sbom s
			JOIN tier_tags t ON t.digest = s.digest
			WHERE s.last_security_scanned_at IS NOT NULL
			  AND s.last_security_scanned_at < $1::timestamptz - interval '%s'
		`, tier.submittedAfter, tier.submittedBefore, tier.rescanInterval)

		if err := conn.QueryRow(ctx, query, referenceTime).Scan(&count); err != nil {
			logger.Warn("failed to count tier backlog", zap.String("tier", tier.name), zap.Error(err))
			continue
		}

		telemetry.Gauge(telemetry.MetricExternalImageScanBacklog, float64(count),
			[]string{telemetry.TagScanTier + ":" + tier.name})
	}

	// Running scans: count of external_image_scan rows with status = 'running'
	var runningCount int
	if err := conn.QueryRow(ctx, `
		SELECT COUNT(*) FROM external_image_scan WHERE status = 'running'
	`).Scan(&runningCount); err != nil {
		logger.Warn("failed to count running scans", zap.Error(err))
	} else {
		telemetry.Gauge(telemetry.MetricExternalImageScansRunning, float64(runningCount), nil)
	}
}
