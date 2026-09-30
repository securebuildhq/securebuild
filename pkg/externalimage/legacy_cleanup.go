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

const legacyScanCleanupBatchSize = 500

type legacyScanCleanupCandidate struct {
	digest, arch, generationID string
	rawKey, detailsKey, state  string
	lease                      time.Time
}

type legacyScanObjectStore interface {
	deleteMany(context.Context, []string) error
}

// Publication validates both uploaded objects before selecting a generation.
// Cleanup trusts that invariant and checks its identity in PostgreSQL only.
func validateLegacyReplacement(candidate legacyScanCleanupCandidate) error {
	if candidate.generationID == "" || candidate.state != "selected" ||
		candidate.rawKey != generationRawResultKey(candidate.digest, candidate.arch, candidate.generationID) ||
		candidate.detailsKey != generationParsedResultsDetailsKey(candidate.digest, candidate.arch, candidate.generationID) {
		return fmt.Errorf("invalid selected generation metadata for %s/%s", candidate.digest, candidate.arch)
	}
	return nil
}

// CleanupLegacyExternalImageScans retires legacy raw/detail objects for images
// with a selected replacement. Missing legacy keys are successful deletions.
func CleanupLegacyExternalImageScans(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, scanCandidateCleanupRunBudget)
	defer cancel()
	var store *blobStore
	for {
		claimCtx, cancelClaim := scanCleanupClaimContext(ctx)
		candidates, err := claimLegacyScanCleanupBatch(claimCtx)
		cancelClaim()
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
		if err := deleteLegacyScanBatch(ctx, store, candidates, completeLegacyScanCleanup); err != nil {
			return err
		}
		if len(candidates) < legacyScanCleanupBatchSize {
			return nil
		}
	}
}

// Bound and lock the scan page before joining generation metadata. Joining
// first can make PostgreSQL scan both entire tables for every small batch.
// Order only by the indexed deadline: tie-breaking on digest would sort the
// whole due cohort when many rows share a deadline.
// Leases survive restarts; no transaction is held during storage IO.
func claimLegacyScanCleanupBatch(ctx context.Context) ([]legacyScanCleanupCandidate, error) {
	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, `
		WITH page AS MATERIALIZED (
		  SELECT digest, arch FROM external_image_scan
		  WHERE legacy_cleanup_after <= NOW() AND legacy_cleaned_at IS NULL
		    AND selected_scan_generation_id IS NOT NULL
		  ORDER BY legacy_cleanup_after
		  LIMIT $1 FOR UPDATE SKIP LOCKED
		), claimed AS (
		  UPDATE external_image_scan scan
		  SET legacy_cleanup_after = NOW() + INTERVAL '5 minutes'
		  FROM page WHERE scan.digest = page.digest AND scan.arch = page.arch
		  RETURNING scan.digest, scan.arch, scan.selected_scan_generation_id, scan.legacy_cleanup_after
		)
		SELECT claimed.digest, claimed.arch, claimed.selected_scan_generation_id,
		COALESCE(generation.raw_object_key, ''), COALESCE(generation.details_object_key, ''),
		COALESCE(generation.state, ''), claimed.legacy_cleanup_after
		FROM claimed LEFT JOIN external_image_scan_generation generation
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
		dest := []any{&candidate.digest, &candidate.arch, &candidate.generationID, &candidate.rawKey, &candidate.detailsKey, &candidate.state}
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

func deleteLegacyScanBatch(ctx context.Context, store legacyScanObjectStore, candidates []legacyScanCleanupCandidate, complete func(context.Context, []legacyScanCleanupCandidate) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	var firstFailure error
	var ready []legacyScanCleanupCandidate
	var keys []string
	for _, candidate := range candidates {
		if err := validateLegacyReplacement(candidate); err != nil {
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
	// Partial failure checkpoints nothing. Retrying the exact keys is safe even
	// when one or both were deleted by a previous pass.
	if err := store.deleteMany(ctx, keys); err != nil {
		return errors.Join(firstFailure, err)
	}
	return errors.Join(firstFailure, complete(ctx, ready))
}

func completeLegacyScanCleanup(ctx context.Context, candidates []legacyScanCleanupCandidate) error {
	digests, architectures, _ := legacyCandidateArrays(candidates)
	leases := make([]time.Time, len(candidates))
	for i, c := range candidates {
		leases[i] = c.lease
	}
	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	result, err := conn.Exec(ctx, `
		UPDATE external_image_scan scan SET legacy_cleaned_at = NOW(), legacy_cleanup_after = NULL
		FROM unnest($1::text[], $2::text[], $3::timestamptz[]) AS candidate(digest, arch, lease)
		WHERE scan.digest = candidate.digest AND scan.arch = candidate.arch
		  AND scan.legacy_cleanup_after = candidate.lease
		  AND scan.legacy_cleaned_at IS NULL AND scan.selected_scan_generation_id IS NOT NULL
	`, digests, architectures, leases)
	if err != nil {
		return err
	}
	if result.RowsAffected() != int64(len(candidates)) {
		return fmt.Errorf("completed %d of %d legacy scan cleanup leases", result.RowsAffected(), len(candidates))
	}
	return nil
}

// Scheduling never deletes objects; the background worker honors a new 24h grace.
type LegacyScanCleanupOptions struct {
	DryRun    bool
	BatchSize int
}
type LegacyScanCleanupResult struct {
	Candidates, WouldSchedule, Scheduled, SkippedConcurrent, Failed int
	// IntendedKeys counts keys to attempt, including keys that may already be absent.
	IntendedKeys int64
}

// ScheduleLegacyExternalImageScanCleanup uses PostgreSQL only. Neither dry-run
// nor scheduling needs storage credentials, existence checks, or byte accounting.
func ScheduleLegacyExternalImageScanCleanup(ctx context.Context, options LegacyScanCleanupOptions) (LegacyScanCleanupResult, error) {
	var result LegacyScanCleanupResult
	if options.BatchSize == 0 {
		options.BatchSize = 1000
	}
	if options.BatchSize < 1 || options.BatchSize > 5000 {
		return result, fmt.Errorf("batch size must be between 1 and 5000")
	}
	var afterDigest, afterArch string
	var firstFailure error
	for {
		page, err := listUnscheduledLegacyScans(ctx, afterDigest, afterArch, options.BatchSize)
		if err != nil {
			return result, err
		}
		if len(page) == 0 {
			break
		}
		var candidates []legacyScanCleanupCandidate
		for _, c := range page {
			result.Candidates++
			if err := validateLegacyReplacement(c); err != nil {
				result.Failed++
				if firstFailure == nil {
					firstFailure = err
				}
				continue
			}
			candidates = append(candidates, c)
		}
		if options.DryRun {
			result.WouldSchedule += len(candidates)
			result.IntendedKeys += int64(2 * len(candidates))
		} else if len(candidates) > 0 {
			scheduled, err := scheduleLegacyScanCleanup(ctx, candidates)
			if err != nil {
				return result, err
			}
			result.Scheduled += int(scheduled)
			result.SkippedConcurrent += len(candidates) - int(scheduled)
			result.IntendedKeys += 2 * scheduled
		}
		// Advance using the scan page even if none has valid generation metadata.
		last := page[len(page)-1]
		afterDigest, afterArch = last.digest, last.arch
	}
	if firstFailure != nil {
		return result, fmt.Errorf("invalid generation metadata for %d rows: %w", result.Failed, firstFailure)
	}
	if result.SkippedConcurrent > 0 {
		return result, fmt.Errorf("%d rows changed concurrently; rerun scheduling", result.SkippedConcurrent)
	}
	return result, nil
}

func listUnscheduledLegacyScans(ctx context.Context, afterDigest, afterArch string, limit int) ([]legacyScanCleanupCandidate, error) {
	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, `
		WITH page AS MATERIALIZED (
		  SELECT digest, arch, selected_scan_generation_id FROM external_image_scan
		  WHERE legacy_cleanup_after IS NULL AND legacy_cleaned_at IS NULL
		    AND selected_scan_generation_id IS NOT NULL AND (digest, arch) > ($1, $2)
		  ORDER BY digest, arch LIMIT $3
		)
		SELECT page.digest, page.arch, page.selected_scan_generation_id,
		COALESCE(generation.raw_object_key, ''), COALESCE(generation.details_object_key, ''), COALESCE(generation.state, '')
		FROM page LEFT JOIN external_image_scan_generation generation
		  ON generation.generation_id = page.selected_scan_generation_id
		  AND generation.digest = page.digest AND generation.arch = page.arch
		ORDER BY page.digest, page.arch
	`, afterDigest, afterArch, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLegacyCandidates(rows, false)
}

func legacyCandidateArrays(candidates []legacyScanCleanupCandidate) ([]string, []string, []string) {
	digests, architectures, generations := make([]string, len(candidates)), make([]string, len(candidates)), make([]string, len(candidates))
	for i, c := range candidates {
		digests[i], architectures[i], generations[i] = c.digest, c.arch, c.generationID
	}
	return digests, architectures, generations
}

func scheduleLegacyScanCleanup(ctx context.Context, candidates []legacyScanCleanupCandidate) (int64, error) {
	digests, architectures, generations := legacyCandidateArrays(candidates)
	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return 0, err
	}
	defer conn.Release()
	result, err := conn.Exec(ctx, `
		UPDATE external_image_scan scan SET legacy_cleanup_after = NOW() + INTERVAL '24 hours'
		FROM unnest($1::text[], $2::text[], $3::text[]) AS candidate(digest, arch, generation_id)
		WHERE scan.digest = candidate.digest AND scan.arch = candidate.arch
		  AND scan.selected_scan_generation_id = candidate.generation_id
		  AND scan.legacy_cleanup_after IS NULL AND scan.legacy_cleaned_at IS NULL
	`, digests, architectures, generations)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}
