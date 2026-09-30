package externalimage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
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
	scanCandidateCleanupAcquireTimeout  = 5 * time.Second
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
	lease      time.Time
}

type scanCandidateCleanupStats struct {
	examined  int64
	deleted   int64
	protected int64
	failed    int64
}

func acquireScanCandidateCleanupConnection(ctx context.Context) (*pgxpool.Conn, error) {
	conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, scanCandidateCleanupAcquireTimeout)
	if err != nil {
		return nil, fmt.Errorf("failed to acquire database connection for scan candidate cleanup: %w", err)
	}
	return conn, nil
}

// StartScanCandidateCleanup continuously drains failed, abandoned, and
// superseded scan generations after their grace period. It runs immediately
// for restart recovery, then once per minute. Each pass uses bounded batches
// and a time budget so cleanup cannot monopolize the worker.
func StartScanCandidateCleanup(ctx context.Context) {
	// Legacy retirement has its own cadence and budget. Wait for it on shutdown.
	legacyDone := make(chan struct{})
	go func() {
		defer close(legacyDone)
		ticker := time.NewTicker(scanCandidateCleanupInterval)
		defer ticker.Stop()
		for {
			if err := CleanupLegacyExternalImageScans(ctx); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
				logger.Warn("failed to clean up legacy external image scans", zap.Error(err))
			}

			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	defer func() { <-legacyDone }()
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
	if batchSize <= 0 || batchSize > scanCandidateCleanupBatchSize {
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
		if stats.examined < int64(batchSize) || stats.deleted == 0 {
			return total, nil
		}
		if err := drainCtx.Err(); err != nil {
			return total, err
		}
	}
}

// CleanupExternalImageScanCandidates drains expired candidates in batches of
// up to limit (capped at 500) until it catches up or reaches the time budget used by the
// background worker. It is exported for integration tests and administrative
// cleanup jobs.
func CleanupExternalImageScanCandidates(ctx context.Context, limit int) error {
	_, err := drainExternalImageScanCandidates(ctx, limit, scanCandidateCleanupRunBudget)
	return err
}

func cleanupExternalImageScanCandidateBatch(ctx context.Context, limit int) (scanCandidateCleanupStats, error) {
	if limit <= 0 || limit > scanCandidateCleanupBatchSize {
		limit = scanCandidateCleanupBatchSize
	}

	claimCtx, cancelClaim := scanCleanupClaimContext(ctx)
	defer cancelClaim()
	candidates, err := listExpiredScanCandidates(claimCtx, limit)
	stats := scanCandidateCleanupStats{examined: int64(len(candidates))}
	if err != nil || len(candidates) == 0 {
		return stats, err
	}
	deletions, protected, err := claimExternalImageScanCandidateDeletions(claimCtx, candidates)
	cancelClaim()
	stats.protected = protected
	if err != nil {
		stats.failed = int64(len(candidates))
		return stats, err
	}
	if len(deletions) == 0 {
		return stats, nil
	}
	if err := ctx.Err(); err != nil {
		return stats, err
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
	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return nil, err
	}
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

// Claim a batch in one transaction, locking scan rows before generation rows
// just like publication. SKIP LOCKED lets other work progress past busy rows.
func claimExternalImageScanCandidateDeletions(ctx context.Context, candidates []scanCandidateIdentity) ([]scanCandidateDeletion, int64, error) {
	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return nil, 0, err
	}
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback(ctx)

	ids, digests, arches := scanCandidateArrays(candidates)
	rows, err := tx.Query(ctx, `
		WITH pairs AS MATERIALIZED (
		  SELECT DISTINCT digest, arch FROM unnest($1::text[], $2::text[]) AS c(digest, arch)
		), locked AS MATERIALIZED (
		  SELECT scan.digest, scan.arch, scan.current_scan_generation_id, scan.selected_scan_generation_id
		  FROM external_image_scan scan JOIN pairs USING (digest, arch)
		  ORDER BY scan.digest, scan.arch FOR UPDATE OF scan SKIP LOCKED
		)
		SELECT pairs.digest, pairs.arch, locked.current_scan_generation_id, locked.selected_scan_generation_id,
		locked.digest IS NOT NULL OR NOT EXISTS (
		  SELECT 1 FROM external_image_scan scan WHERE scan.digest = pairs.digest AND scan.arch = pairs.arch
		) AS claimable
		FROM pairs LEFT JOIN locked USING (digest, arch)
	`, digests, arches)
	if err != nil {
		return nil, 0, fmt.Errorf("lock scan cleanup batch: %w", err)
	}
	type scanKey struct{ digest, arch string }
	type ownership struct{ current, selected sql.NullString }
	owners := make(map[scanKey]ownership)
	for rows.Next() {
		var key scanKey
		var owner ownership
		var claimable bool
		if err := rows.Scan(&key.digest, &key.arch, &owner.current, &owner.selected, &claimable); err != nil {
			rows.Close()
			return nil, 0, err
		}
		// A locked existing scan must not be confused with an absent scan.
		if claimable {
			owners[key] = owner
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var claimable []scanCandidateIdentity
	for _, c := range candidates {
		if _, ok := owners[scanKey{c.digest, c.arch}]; ok {
			claimable = append(claimable, c)
		}
	}
	if len(claimable) == 0 {
		return nil, 0, nil
	}
	ids, digests, arches = scanCandidateArrays(claimable)
	rows, err = tx.Query(ctx, `
		SELECT generation.generation_id, generation.digest, generation.arch,
		generation.raw_object_key, generation.details_object_key, generation.state, generation.cleanup_after
		FROM external_image_scan_generation generation
		JOIN unnest($1::text[], $2::text[], $3::text[]) AS c(generation_id, digest, arch)
		  ON generation.generation_id = c.generation_id AND generation.digest = c.digest AND generation.arch = c.arch
		ORDER BY generation.generation_id, generation.digest, generation.arch
		FOR UPDATE OF generation SKIP LOCKED
	`, ids, digests, arches)
	if err != nil {
		return nil, 0, fmt.Errorf("lock generation cleanup batch: %w", err)
	}
	var deletions []scanCandidateDeletion
	var selected, revoke []scanCandidateIdentity
	var protected int64
	now := time.Now()
	lease := now.Add(scanCandidateCleanupLease).UTC().Truncate(time.Microsecond)
	for rows.Next() {
		var c scanCandidateDeletion
		var state string
		var cleanupAfter sql.NullTime
		if err := rows.Scan(&c.generationID, &c.digest, &c.arch, &c.rawKey, &c.detailsKey, &state, &cleanupAfter); err != nil {
			rows.Close()
			return nil, 0, err
		}
		owner := owners[scanKey{c.digest, c.arch}]
		if owner.selected.Valid && owner.selected.String == c.generationID {
			selected = append(selected, c.scanCandidateIdentity)
			protected++
			continue
		}
		// Recheck publication leases under the generation lock. A publisher may
		// have renewed one after the initial list query.
		if state == "selected" || !cleanupAfter.Valid || cleanupAfter.Time.After(now) {
			protected++
			continue
		}
		c.lease = lease
		deletions = append(deletions, c)
		if owner.current.Valid && owner.current.String == c.generationID {
			revoke = append(revoke, c.scanCandidateIdentity)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if len(selected) > 0 {
		ids, digests, arches = scanCandidateArrays(selected)
		_, err = tx.Exec(ctx, `
			UPDATE external_image_scan_generation generation SET state = 'selected', cleanup_after = NULL
			FROM unnest($1::text[], $2::text[], $3::text[]) AS c(generation_id, digest, arch)
			WHERE generation.generation_id = c.generation_id AND generation.digest = c.digest AND generation.arch = c.arch
		`, ids, digests, arches)
		if err != nil {
			return nil, 0, err
		}
	}
	// Revoke only ownership observed under a scan lock. An absent scan may
	// have been inserted meanwhile; do not acquire its lock after generation locks.
	if len(revoke) > 0 {
		ids, digests, arches = scanCandidateArrays(revoke)
		_, err = tx.Exec(ctx, `
			UPDATE external_image_scan scan SET current_scan_generation_id = NULL
			FROM unnest($1::text[], $2::text[], $3::text[]) AS c(generation_id, digest, arch)
			WHERE scan.digest = c.digest AND scan.arch = c.arch AND scan.current_scan_generation_id = c.generation_id
		`, ids, digests, arches)
		if err != nil {
			return nil, 0, fmt.Errorf("revoke expired scan batch ownership: %w", err)
		}
	}
	if len(deletions) > 0 {
		identities := make([]scanCandidateIdentity, len(deletions))
		for i, c := range deletions {
			identities[i] = c.scanCandidateIdentity
		}
		ids, digests, arches = scanCandidateArrays(identities)
		_, err = tx.Exec(ctx, `
			UPDATE external_image_scan_generation generation SET state = 'deleting', cleanup_after = $4
			FROM unnest($1::text[], $2::text[], $3::text[]) AS c(generation_id, digest, arch)
			WHERE generation.generation_id = c.generation_id AND generation.digest = c.digest AND generation.arch = c.arch
		`, ids, digests, arches, lease)
		if err != nil {
			return nil, 0, fmt.Errorf("mark scan batch deleting: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, 0, fmt.Errorf("commit scan batch deletion claim: %w", err)
	}
	return deletions, protected, nil
}

func scanCandidateArrays(candidates []scanCandidateIdentity) ([]string, []string, []string) {
	ids, digests, arches := make([]string, len(candidates)), make([]string, len(candidates)), make([]string, len(candidates))
	for i, c := range candidates {
		ids[i], digests[i], arches[i] = c.generationID, c.digest, c.arch
	}
	return ids, digests, arches
}

// Leave time for deletion and checkpointing. A short caller deadline keeps half
// its remaining budget; the normal 45s pass reserves the final five seconds.
func scanCleanupClaimContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		reserve := min(5*time.Second, remaining/2)
		return context.WithDeadline(ctx, deadline.Add(-reserve))
	}
	return context.WithCancel(ctx)
}

func deleteScanCandidateMetadata(ctx context.Context, candidates []scanCandidateDeletion) (int64, error) {
	if len(candidates) == 0 {
		return 0, nil
	}

	generationIDs := make([]string, len(candidates))
	digests := make([]string, len(candidates))
	architectures := make([]string, len(candidates))
	leases := make([]time.Time, len(candidates))
	for i, candidate := range candidates {
		generationIDs[i] = candidate.generationID
		digests[i] = candidate.digest
		architectures[i] = candidate.arch
		leases[i] = candidate.lease
	}

	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return 0, err
	}
	defer conn.Release()
	result, err := conn.Exec(ctx, `
		DELETE FROM external_image_scan_generation generation
		USING unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[]) AS candidate(generation_id, digest, arch, lease)
		WHERE generation.generation_id = candidate.generation_id
		  AND generation.digest = candidate.digest
		  AND generation.arch = candidate.arch
		  AND generation.state = 'deleting'
		  AND generation.cleanup_after = candidate.lease
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
	`, generationIDs, digests, architectures, leases)
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
	conn, err := acquireScanCandidateCleanupConnection(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	var pending, pendingBytes, overdue int64
	var oldestOverdueSeconds float64
	err = conn.QueryRow(ctx, `
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
