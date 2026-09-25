package externalimage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

const (
	scanCandidateCleanupInterval        = time.Minute
	scanCandidateCleanupMetricsInterval = 5 * time.Minute
	scanCandidateCleanupRunBudget       = 45 * time.Second
	scanCandidateCleanupLease           = 5 * time.Minute
	scanCandidateCleanupBatchSize       = 500
)

type scanCandidateIdentity struct {
	generationID string
	digest       string
	arch         string
}

type scanCandidateDeletion struct {
	scanCandidateIdentity
	rawKey     string
	detailsKey string
}

type scanCandidateCleanupStats struct {
	examined  int64
	deleted   int64
	protected int64
	failed    int64
}

// StartScanCandidateCleanup continuously drains failed, abandoned, and
// superseded scan generations after their grace period. It runs immediately
// for restart recovery, then once per minute. Each pass uses bounded batches
// and a time budget so cleanup cannot monopolize the worker.
func StartScanCandidateCleanup(ctx context.Context) {
	runCleanup := func() {
		stats, err := drainExternalImageScanCandidates(ctx, scanCandidateCleanupBatchSize, scanCandidateCleanupRunBudget)
		telemetry.Count(telemetry.MetricExternalImageScanCleanupDeleted, stats.deleted, nil)
		telemetry.Count(telemetry.MetricExternalImageScanCleanupFailed, stats.failed, nil)
		if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			logger.Warn("failed to clean up external image scan candidates", zap.Error(err))
		}
	}
	reportMetrics := func() {
		if err := reportScanCandidateCleanupMetrics(ctx); err != nil && !errors.Is(err, context.Canceled) {
			logger.Warn("failed to report external image scan cleanup metrics", zap.Error(err))
		}
	}

	runCleanup()
	reportMetrics()

	cleanupTicker := time.NewTicker(scanCandidateCleanupInterval)
	metricsTicker := time.NewTicker(scanCandidateCleanupMetricsInterval)
	defer cleanupTicker.Stop()
	defer metricsTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-cleanupTicker.C:
			runCleanup()
		case <-metricsTicker.C:
			reportMetrics()
		}
	}
}

func drainExternalImageScanCandidates(ctx context.Context, batchSize int, budget time.Duration) (scanCandidateCleanupStats, error) {
	if batchSize <= 0 {
		batchSize = scanCandidateCleanupBatchSize
	}
	if budget <= 0 {
		budget = scanCandidateCleanupRunBudget
	}

	drainCtx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()

	var total scanCandidateCleanupStats
	for {
		stats, err := cleanupExternalImageScanCandidateBatch(drainCtx, batchSize)
		total.examined += stats.examined
		total.deleted += stats.deleted
		total.protected += stats.protected
		total.failed += stats.failed
		if err != nil {
			return total, err
		}
		if stats.examined < int64(batchSize) {
			return total, nil
		}
		if err := drainCtx.Err(); err != nil {
			return total, err
		}
	}
}

// CleanupExternalImageScanCandidates drains expired candidates in batches of
// limit until it catches up or reaches the same bounded time budget used by the
// background worker. It is exported for integration tests and administrative
// cleanup jobs.
func CleanupExternalImageScanCandidates(ctx context.Context, limit int) error {
	_, err := drainExternalImageScanCandidates(ctx, limit, scanCandidateCleanupRunBudget)
	return err
}

func cleanupExternalImageScanCandidateBatch(ctx context.Context, limit int) (scanCandidateCleanupStats, error) {
	if limit <= 0 {
		limit = scanCandidateCleanupBatchSize
	}

	candidates, err := listExpiredScanCandidates(ctx, limit)
	stats := scanCandidateCleanupStats{examined: int64(len(candidates))}
	if err != nil || len(candidates) == 0 {
		return stats, err
	}

	deletions := make([]scanCandidateDeletion, 0, len(candidates))
	for _, candidate := range candidates {
		deletion, protected, err := claimExternalImageScanCandidateDeletion(ctx, candidate)
		if err != nil {
			stats.failed++
			logger.Warn("failed to claim external image scan candidate for cleanup",
				zap.String("generation_id", candidate.generationID),
				zap.String("digest", candidate.digest),
				zap.String("arch", candidate.arch),
				zap.Error(err))
			continue
		}
		if protected {
			stats.protected++
			continue
		}
		if deletion != nil {
			deletions = append(deletions, *deletion)
		}
	}
	if len(deletions) == 0 {
		return stats, nil
	}

	store, err := getScanObjectStore(ctx)
	if err != nil {
		stats.failed += int64(len(deletions))
		return stats, err
	}
	keys := make([]string, 0, len(deletions)*2)
	for _, deletion := range deletions {
		keys = append(keys, deletion.rawKey, deletion.detailsKey)
	}
	if err := store.deleteMany(ctx, keys); err != nil {
		stats.failed += int64(len(deletions))
		return stats, fmt.Errorf("failed to bulk-delete scan candidate objects: %w", err)
	}

	deleted, err := deleteScanCandidateMetadata(ctx, deletions)
	stats.deleted += deleted
	if err != nil {
		stats.failed += int64(len(deletions)) - deleted
	}
	return stats, err
}

func listExpiredScanCandidates(ctx context.Context, limit int) ([]scanCandidateIdentity, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	rows, err := conn.Query(ctx, `
		SELECT generation_id, digest, arch
		FROM external_image_scan_generation
		WHERE cleanup_after IS NOT NULL
		  AND cleanup_after <= NOW()
		  AND state != 'selected'
		ORDER BY cleanup_after
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list scan candidates for cleanup: %w", err)
	}
	defer rows.Close()

	var candidates []scanCandidateIdentity
	for rows.Next() {
		var candidate scanCandidateIdentity
		if err := rows.Scan(&candidate.generationID, &candidate.digest, &candidate.arch); err != nil {
			return nil, fmt.Errorf("failed to scan cleanup candidate: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed while listing scan candidates for cleanup: %w", err)
	}
	return candidates, nil
}

func claimExternalImageScanCandidateDeletion(ctx context.Context, candidate scanCandidateIdentity) (*scanCandidateDeletion, bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx)

	var currentGeneration, selectedGeneration sql.NullString
	err = tx.QueryRow(ctx, `
		SELECT current_scan_generation_id, selected_scan_generation_id
		FROM external_image_scan
		WHERE digest = $1 AND arch = $2
		FOR UPDATE
	`, candidate.digest, candidate.arch).Scan(&currentGeneration, &selectedGeneration)
	if err != nil && err != pgx.ErrNoRows {
		return nil, false, fmt.Errorf("failed to lock scan row during candidate cleanup: %w", err)
	}

	var rawKey, detailsKey, state string
	var cleanupAfter sql.NullTime
	err = tx.QueryRow(ctx, `
		SELECT raw_object_key, details_object_key, state, cleanup_after
		FROM external_image_scan_generation
		WHERE generation_id = $1 AND digest = $2 AND arch = $3
		FOR UPDATE
	`, candidate.generationID, candidate.digest, candidate.arch).Scan(&rawKey, &detailsKey, &state, &cleanupAfter)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("failed to lock scan candidate during cleanup: %w", err)
	}
	if selectedGeneration.Valid && selectedGeneration.String == candidate.generationID {
		_, err = tx.Exec(ctx, `
			UPDATE external_image_scan_generation
			SET state = 'selected', cleanup_after = NULL
			WHERE generation_id = $1 AND digest = $2 AND arch = $3
		`, candidate.generationID, candidate.digest, candidate.arch)
		if err != nil {
			return nil, false, err
		}
		return nil, true, tx.Commit(ctx)
	}
	if currentGeneration.Valid && currentGeneration.String == candidate.generationID {
		_, err = tx.Exec(ctx, `
			UPDATE external_image_scan_generation
			SET cleanup_after = $4
			WHERE generation_id = $1 AND digest = $2 AND arch = $3
		`, candidate.generationID, candidate.digest, candidate.arch, time.Now().Add(scanCandidateCleanupDelay))
		if err != nil {
			return nil, false, err
		}
		return nil, true, tx.Commit(ctx)
	}

	now := time.Now()
	if state == "deleting" && cleanupAfter.Valid && cleanupAfter.Time.After(now) {
		return nil, false, tx.Commit(ctx)
	}
	_, err = tx.Exec(ctx, `
		UPDATE external_image_scan_generation
		SET state = 'deleting', cleanup_after = $4
		WHERE generation_id = $1 AND digest = $2 AND arch = $3
	`, candidate.generationID, candidate.digest, candidate.arch, now.Add(scanCandidateCleanupLease))
	if err != nil {
		return nil, false, fmt.Errorf("failed to mark scan candidate deleting: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, fmt.Errorf("failed to commit scan candidate deletion claim: %w", err)
	}
	return &scanCandidateDeletion{
		scanCandidateIdentity: candidate,
		rawKey:                rawKey,
		detailsKey:            detailsKey,
	}, false, nil
}

func deleteScanCandidateMetadata(ctx context.Context, candidates []scanCandidateDeletion) (int64, error) {
	if len(candidates) == 0 {
		return 0, nil
	}

	generationIDs := make([]string, len(candidates))
	digests := make([]string, len(candidates))
	architectures := make([]string, len(candidates))
	for i, candidate := range candidates {
		generationIDs[i] = candidate.generationID
		digests[i] = candidate.digest
		architectures[i] = candidate.arch
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	result, err := conn.Exec(ctx, `
		DELETE FROM external_image_scan_generation generation
		USING unnest($1::text[], $2::text[], $3::text[]) AS candidate(generation_id, digest, arch)
		WHERE generation.generation_id = candidate.generation_id
		  AND generation.digest = candidate.digest
		  AND generation.arch = candidate.arch
		  AND generation.state = 'deleting'
		  AND NOT EXISTS (
			SELECT 1
			FROM external_image_scan scan
			WHERE scan.digest = generation.digest
			  AND scan.arch = generation.arch
			  AND (
			    scan.current_scan_generation_id = generation.generation_id
			    OR scan.selected_scan_generation_id = generation.generation_id
			  )
		  )
	`, generationIDs, digests, architectures)
	if err != nil {
		return 0, fmt.Errorf("failed to delete scan candidate metadata: %w", err)
	}
	if result.RowsAffected() != int64(len(candidates)) {
		return result.RowsAffected(), fmt.Errorf(
			"deleted metadata for %d of %d scan candidates after object cleanup",
			result.RowsAffected(),
			len(candidates),
		)
	}
	return result.RowsAffected(), nil
}

func reportScanCandidateCleanupMetrics(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var pending, pendingBytes, overdue int64
	var oldestOverdueSeconds float64
	err := conn.QueryRow(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(raw_size_bytes + details_size_bytes), 0),
		       COUNT(*) FILTER (WHERE cleanup_after <= NOW()),
		       COALESCE(EXTRACT(EPOCH FROM NOW() - MIN(cleanup_after) FILTER (WHERE cleanup_after <= NOW())), 0)
		FROM external_image_scan_generation
		WHERE cleanup_after IS NOT NULL
		  AND state != 'selected'
	`).Scan(&pending, &pendingBytes, &overdue, &oldestOverdueSeconds)
	if err != nil {
		return fmt.Errorf("failed to query scan candidate cleanup backlog: %w", err)
	}

	telemetry.Gauge(telemetry.MetricExternalImageScanCleanupPending, float64(pending), nil)
	telemetry.Gauge(telemetry.MetricExternalImageScanCleanupPendingBytes, float64(pendingBytes), nil)
	telemetry.Gauge(telemetry.MetricExternalImageScanCleanupOverdue, float64(overdue), nil)
	telemetry.Gauge(telemetry.MetricExternalImageScanCleanupOldestSeconds, oldestOverdueSeconds, nil)
	return nil
}
