package externalimage

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

const (
	legacyScanCleanupBatchSize     = 100
	legacyScanCleanupDeleteReserve = 5 * time.Second
)

type legacyScanCleanupCandidate struct {
	digest, arch, generationID string
	rawKey, detailsKey         string
	rawSize, detailsSize       int64
	lease                      time.Time
}

type legacyScanObjectStore interface {
	objectSize(context.Context, string) (int64, bool, error)
	deleteMany(context.Context, []string) error
}

// validateLegacyReplacement deliberately accepts only generation-specific keys.
// Legacy results must never be removed while they are still the published result.
func validateLegacyReplacement(ctx context.Context, store legacyScanObjectStore, candidate legacyScanCleanupCandidate) error {
	if candidate.generationID == "" ||
		candidate.rawKey != generationRawResultKey(candidate.digest, candidate.arch, candidate.generationID) ||
		candidate.detailsKey != generationParsedResultsDetailsKey(candidate.digest, candidate.arch, candidate.generationID) {
		return fmt.Errorf("invalid selected generation object keys for %s/%s", candidate.digest, candidate.arch)
	}
	for _, artifact := range []struct {
		key  string
		size int64
	}{{candidate.rawKey, candidate.rawSize}, {candidate.detailsKey, candidate.detailsSize}} {
		size, exists, err := store.objectSize(ctx, artifact.key)
		if err != nil {
			return err
		}
		if !exists || size != artifact.size || size <= 0 {
			return fmt.Errorf("selected object %q is missing or has unexpected size", artifact.key)
		}
	}
	return nil
}

// CleanupLegacyExternalImageScans retires legacy raw/detail objects for images
// with a selected replacement. It uses a separate bounded budget so generation
// cleanup cannot starve legacy retirement (or vice versa).
func CleanupLegacyExternalImageScans(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, scanCandidateCleanupRunBudget)
	defer cancel()
	var store *blobStore
	for {
		candidates, err := claimLegacyScanCleanupBatch(ctx)
		if err != nil {
			return err
		}
		if len(candidates) == 0 {
			return nil
		}
		if store == nil {
			store, err = newBlobStore(ctx)
			if err != nil {
				return err
			}
		}
		err = deleteLegacyScanBatch(ctx, store, candidates, completeLegacyScanCleanup)
		if err != nil {
			return err
		}
		if len(candidates) < legacyScanCleanupBatchSize {
			return nil
		}
	}
}

// Leases survive worker restarts. No database transaction is held during R2 IO.
// Publication never resets a selected generation to legacy storage, and never
// rewrites legacy keys. New publishers must preserve that invariant.
func claimLegacyScanCleanupBatch(ctx context.Context) ([]legacyScanCleanupCandidate, error) {
	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, `
		WITH candidates AS (
		  SELECT scan.digest, scan.arch
		  FROM external_image_scan scan
		  JOIN external_image_scan_generation generation
		    ON generation.generation_id = scan.selected_scan_generation_id
		    AND generation.digest = scan.digest AND generation.arch = scan.arch
		  WHERE scan.legacy_cleanup_after <= NOW() AND scan.legacy_cleaned_at IS NULL
		    AND generation.state = 'selected'
		  ORDER BY scan.legacy_cleanup_after, scan.digest, scan.arch
		  LIMIT $1 FOR UPDATE OF scan SKIP LOCKED
		), claimed AS (
		  UPDATE external_image_scan scan
		  SET legacy_cleanup_after = NOW() + INTERVAL '5 minutes'
		  FROM candidates
		  WHERE scan.digest = candidates.digest AND scan.arch = candidates.arch
		  RETURNING scan.digest, scan.arch, scan.selected_scan_generation_id, scan.legacy_cleanup_after
		)
		SELECT claimed.digest, claimed.arch, claimed.selected_scan_generation_id,
		  generation.raw_object_key, generation.details_object_key,
		  generation.raw_size_bytes, generation.details_size_bytes, claimed.legacy_cleanup_after
		FROM claimed JOIN external_image_scan_generation generation
		  ON generation.generation_id = claimed.selected_scan_generation_id
		  AND generation.digest = claimed.digest AND generation.arch = claimed.arch
	`, legacyScanCleanupBatchSize)
	if err != nil {
		return nil, fmt.Errorf("claim legacy scan cleanup: %w", err)
	}
	defer rows.Close()
	return scanLegacyCandidates(rows, true)
}

func scanLegacyCandidates(rows pgx.Rows, leased bool) ([]legacyScanCleanupCandidate, error) {
	var candidates []legacyScanCleanupCandidate
	for rows.Next() {
		var candidate legacyScanCleanupCandidate
		dest := []any{&candidate.digest, &candidate.arch, &candidate.generationID, &candidate.rawKey, &candidate.detailsKey, &candidate.rawSize, &candidate.detailsSize}
		if leased {
			dest = append(dest, &candidate.lease)
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		candidates = append(candidates, candidate)
	}
	return candidates, rows.Err()
}

func deleteLegacyScanBatch(ctx context.Context, store legacyScanObjectStore, candidates []legacyScanCleanupCandidate, complete func(context.Context, legacyScanCleanupCandidate) error) error {
	// Stop HEAD requests before the pass deadline, leaving time to delete and
	// checkpoint already validated rows. Slow HEAD requests must not discard
	// every batch forever without making progress.
	validationCtx, cancel := context.WithCancel(ctx)
	if deadline, ok := ctx.Deadline(); ok {
		cancel()
		validationCtx, cancel = context.WithDeadline(ctx, deadline.Add(-legacyScanCleanupDeleteReserve))
	}
	defer cancel()
	var firstFailure error
	var ready []legacyScanCleanupCandidate
	var keys []string
	for _, candidate := range candidates {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := validateLegacyReplacement(validationCtx, store, candidate); err != nil {
			if validationCtx.Err() != nil {
				firstFailure = validationCtx.Err()
				break
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			logger.Warn("legacy scan replacement validation failed", zap.String("digest", candidate.digest), zap.String("arch", candidate.arch), zap.Error(err))
			if firstFailure == nil {
				firstFailure = err
			}
			continue
		}
		ready = append(ready, candidate)
		keys = append(keys, rawResultKey(candidate.digest, candidate.arch), parsedResultsDetailsKey(candidate.digest, candidate.arch))
	}
	if len(ready) == 0 {
		return firstFailure
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// A partial R2 failure must not mark any row completed. Retrying both exact
	// keys is safe, including when one or both were deleted by a previous pass.
	if err := store.deleteMany(ctx, keys); err != nil {
		return errors.Join(firstFailure, err)
	}
	for _, candidate := range ready {
		if err := complete(ctx, candidate); err != nil {
			return errors.Join(firstFailure, err)
		}
	}
	return firstFailure
}

func completeLegacyScanCleanup(ctx context.Context, candidate legacyScanCleanupCandidate) error {
	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	result, err := conn.Exec(ctx, `
		UPDATE external_image_scan SET legacy_cleaned_at = NOW(), legacy_cleanup_after = NULL
		WHERE digest = $1 AND arch = $2 AND legacy_cleanup_after = $3
		  AND legacy_cleaned_at IS NULL AND selected_scan_generation_id IS NOT NULL
	`, candidate.digest, candidate.arch, candidate.lease)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return fmt.Errorf("lost legacy scan cleanup lease for %s/%s", candidate.digest, candidate.arch)
	}
	return nil
}

// LegacyScanCleanupOptions controls scheduling of existing migrated images.
// Scheduling never deletes objects; the background worker honors a new 24h grace.
type LegacyScanCleanupOptions struct {
	DryRun    bool
	BatchSize int
}
type LegacyScanCleanupResult struct {
	Candidates, WouldSchedule, Scheduled, SkippedConcurrent, Failed int
	Objects, Bytes                                                  int64
}

// ScheduleLegacyExternalImageScanCleanup inventories redundant legacy objects
// and schedules retirement for migrated rows that predate automatic scheduling.
func ScheduleLegacyExternalImageScanCleanup(ctx context.Context, options LegacyScanCleanupOptions) (LegacyScanCleanupResult, error) {
	var result LegacyScanCleanupResult
	if options.BatchSize == 0 {
		options.BatchSize = legacyScanCleanupBatchSize
	}
	if options.BatchSize < 1 || options.BatchSize > 500 {
		return result, fmt.Errorf("batch size must be between 1 and 500")
	}
	store, err := newBlobStore(ctx)
	if err != nil {
		return result, err
	}
	var afterDigest, afterArch string
	var firstFailure error
	for {
		candidates, err := listUnscheduledLegacyScans(ctx, afterDigest, afterArch, options.BatchSize)
		if err != nil {
			return result, err
		}
		if len(candidates) == 0 {
			break
		}
		for _, candidate := range candidates {
			if err := ctx.Err(); err != nil {
				return result, err
			}
			result.Candidates++
			objects, bytes, err := inspectLegacyScanObjects(ctx, store, candidate)
			if err == nil && !options.DryRun {
				var scheduled bool
				scheduled, err = scheduleLegacyScanCleanup(ctx, candidate)
				if err == nil {
					if scheduled {
						result.Scheduled++
					} else {
						result.SkippedConcurrent++
					}
				}
			} else if err == nil {
				result.WouldSchedule++
			}
			if err != nil {
				if ctx.Err() != nil {
					return result, ctx.Err()
				}
				result.Failed++
				if firstFailure == nil {
					firstFailure = err
				}
				continue
			}
			result.Objects += objects
			result.Bytes += bytes
		}
		last := candidates[len(candidates)-1]
		afterDigest, afterArch = last.digest, last.arch
	}
	if firstFailure != nil {
		return result, fmt.Errorf("legacy scan inventory failed for %d rows: %w", result.Failed, firstFailure)
	}
	if result.SkippedConcurrent > 0 {
		return result, fmt.Errorf("%d rows changed concurrently; rerun scheduling", result.SkippedConcurrent)
	}
	return result, nil
}

func inspectLegacyScanObjects(ctx context.Context, store legacyScanObjectStore, candidate legacyScanCleanupCandidate) (int64, int64, error) {
	if err := validateLegacyReplacement(ctx, store, candidate); err != nil {
		return 0, 0, err
	}
	var objects, bytes int64
	for _, key := range []string{rawResultKey(candidate.digest, candidate.arch), parsedResultsDetailsKey(candidate.digest, candidate.arch)} {
		size, exists, err := store.objectSize(ctx, key)
		if err != nil {
			return 0, 0, err
		}
		if exists {
			objects++
			bytes += size
		}
	}
	return objects, bytes, nil
}

func listUnscheduledLegacyScans(ctx context.Context, afterDigest, afterArch string, limit int) ([]legacyScanCleanupCandidate, error) {
	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, `
		SELECT scan.digest, scan.arch, scan.selected_scan_generation_id,
		  generation.raw_object_key, generation.details_object_key,
		  generation.raw_size_bytes, generation.details_size_bytes
		FROM external_image_scan scan JOIN external_image_scan_generation generation
		  ON generation.generation_id = scan.selected_scan_generation_id
		  AND generation.digest = scan.digest AND generation.arch = scan.arch
		WHERE scan.legacy_cleanup_after IS NULL AND scan.legacy_cleaned_at IS NULL
		  AND generation.state = 'selected' AND (scan.digest, scan.arch) > ($1, $2)
		ORDER BY scan.digest, scan.arch LIMIT $3
	`, afterDigest, afterArch, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLegacyCandidates(rows, false)
}

func scheduleLegacyScanCleanup(ctx context.Context, candidate legacyScanCleanupCandidate) (bool, error) {
	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return false, err
	}
	defer conn.Release()
	result, err := conn.Exec(ctx, `
		UPDATE external_image_scan SET legacy_cleanup_after = NOW() + INTERVAL '24 hours'
		WHERE digest = $1 AND arch = $2 AND selected_scan_generation_id = $3
		  AND legacy_cleanup_after IS NULL AND legacy_cleaned_at IS NULL
	`, candidate.digest, candidate.arch, candidate.generationID)
	if err != nil {
		return false, err
	}
	return result.RowsAffected() == 1, nil
}
