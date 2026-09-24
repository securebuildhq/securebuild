package externalimage

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

const scanCandidateCleanupInterval = time.Hour

type scanCandidateIdentity struct {
	generationID string
	digest       string
	arch         string
}

// StartScanCandidateCleanup removes failed, abandoned, and superseded scan
// generations after their grace period. Selected generations are protected by
// the same scan-row lock used during selection.
func StartScanCandidateCleanup(ctx context.Context) {
	ticker := time.NewTicker(scanCandidateCleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := CleanupExternalImageScanCandidates(ctx, 100); err != nil {
				logger.Warn("failed to clean up external image scan candidates", zap.Error(err))
			}
		}
	}
}

// CleanupExternalImageScanCandidates deletes up to limit expired candidates.
// It is exported so integration tests and administrative jobs can run a bounded
// cleanup pass directly.
func CleanupExternalImageScanCandidates(ctx context.Context, limit int) error {
	if limit <= 0 {
		limit = 100
	}
	conn := persistence.MustGetPooledPostgresSession(ctx)
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
		conn.Release()
		return fmt.Errorf("failed to list scan candidates for cleanup: %w", err)
	}
	var candidates []scanCandidateIdentity
	for rows.Next() {
		var candidate scanCandidateIdentity
		if err := rows.Scan(&candidate.generationID, &candidate.digest, &candidate.arch); err != nil {
			rows.Close()
			conn.Release()
			return fmt.Errorf("failed to scan cleanup candidate: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	err = rows.Err()
	rows.Close()
	conn.Release()
	if err != nil {
		return fmt.Errorf("failed while listing scan candidates for cleanup: %w", err)
	}

	for _, candidate := range candidates {
		if err := cleanupExternalImageScanCandidate(ctx, candidate); err != nil {
			logger.Warn("failed to clean up external image scan candidate",
				zap.String("generation_id", candidate.generationID),
				zap.String("digest", candidate.digest),
				zap.String("arch", candidate.arch),
				zap.Error(err))
		}
	}
	return nil
}

func cleanupExternalImageScanCandidate(ctx context.Context, candidate scanCandidateIdentity) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var selectedGeneration sql.NullString
	err = tx.QueryRow(ctx, `
		SELECT selected_scan_generation_id
		FROM external_image_scan
		WHERE digest = $1 AND arch = $2
		FOR UPDATE
	`, candidate.digest, candidate.arch).Scan(&selectedGeneration)
	if err != nil && err != pgx.ErrNoRows {
		return fmt.Errorf("failed to lock scan row during candidate cleanup: %w", err)
	}

	var rawKey, detailsKey, state string
	err = tx.QueryRow(ctx, `
		SELECT raw_object_key, details_object_key, state
		FROM external_image_scan_generation
		WHERE generation_id = $1 AND digest = $2 AND arch = $3
		FOR UPDATE
	`, candidate.generationID, candidate.digest, candidate.arch).Scan(&rawKey, &detailsKey, &state)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return fmt.Errorf("failed to lock scan candidate during cleanup: %w", err)
	}
	if selectedGeneration.Valid && selectedGeneration.String == candidate.generationID {
		_, err = tx.Exec(ctx, `
			UPDATE external_image_scan_generation
			SET state = 'selected', cleanup_after = NULL
			WHERE generation_id = $1 AND digest = $2 AND arch = $3
		`, candidate.generationID, candidate.digest, candidate.arch)
		if err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	_, err = tx.Exec(ctx, `
		UPDATE external_image_scan_generation
		SET state = 'deleting'
		WHERE generation_id = $1 AND digest = $2 AND arch = $3
	`, candidate.generationID, candidate.digest, candidate.arch)
	if err != nil {
		return fmt.Errorf("failed to mark scan candidate deleting: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit scan candidate deletion claim: %w", err)
	}

	store, err := getScanObjectStore(ctx)
	if err != nil {
		return err
	}
	if err := store.delete(ctx, rawKey); err != nil {
		return fmt.Errorf("failed to delete raw scan candidate: %w", err)
	}
	if err := store.delete(ctx, detailsKey); err != nil {
		return fmt.Errorf("failed to delete detailed scan candidate: %w", err)
	}

	result, err := conn.Exec(ctx, `
		DELETE FROM external_image_scan_generation generation
		WHERE generation_id = $1 AND digest = $2 AND arch = $3
		  AND state = 'deleting'
		  AND NOT EXISTS (
			SELECT 1
			FROM external_image_scan scan
			WHERE scan.digest = generation.digest
			  AND scan.arch = generation.arch
			  AND scan.selected_scan_generation_id = generation.generation_id
		  )
	`, candidate.generationID, candidate.digest, candidate.arch)
	if err != nil {
		return fmt.Errorf("failed to delete scan candidate metadata: %w", err)
	}
	if result.RowsAffected() != 1 {
		return fmt.Errorf("scan candidate %s became protected before metadata deletion", candidate.generationID)
	}
	return nil
}
