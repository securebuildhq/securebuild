package externalimage

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
)

const (
	externalImageSBOMChannel = "external_image_sbom"

	// Syft downloads time out after 30 minutes. Keep fresh generating rows
	// deduplicated for one additional minute so the status poller can record the
	// timeout before a later submission recovers an orphaned generation.
	externalImageSBOMGeneratingStaleAfter = 31 * time.Minute
)

// EnqueueSBOMWork atomically creates pending SBOM work when the digest is not
// already queued, actively generating, or stored. The advisory lock coordinates
// all enqueue paths, while the queue's unique dedupe key is a final
// database-level guard against duplicate unfinished work.
func EnqueueSBOMWork(ctx context.Context, payload, digest string) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("failed to begin SBOM enqueue transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	lockKey := externalImageSBOMChannel + ":" + digest
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return false, fmt.Errorf("failed to lock SBOM enqueue for digest %s: %w", digest, err)
	}

	generatingCutoff := time.Now().UTC().Add(-externalImageSBOMGeneratingStaleAfter)
	var blocked bool
	if err := tx.QueryRow(ctx, `
		SELECT
			EXISTS (
				SELECT 1
				FROM work_queue
				WHERE channel = $1
				  AND completed_at IS NULL
				  AND (dedupe_key = $2 OR payload->>'digest' = $2)
			)
			OR EXISTS (
				SELECT 1
				FROM external_image_sbom_status
				WHERE digest = $2
				  AND status = $3
				  AND COALESCE(status_updated_at, updated_at, created_at) > $4
			)
			OR EXISTS (
				SELECT 1
				FROM external_image_sbom
				WHERE digest = $2
			)
	`, externalImageSBOMChannel, digest, string(SBOMStatusGenerating), generatingCutoff).Scan(&blocked); err != nil {
		return false, fmt.Errorf("failed to check existing SBOM work for digest %s: %w", digest, err)
	}
	if blocked {
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("failed to commit duplicate SBOM enqueue check: %w", err)
		}
		return false, nil
	}

	id, err := securerandom.Hex(6)
	if err != nil {
		return false, fmt.Errorf("failed to generate SBOM work id: %w", err)
	}
	now := time.Now().UTC()
	err = tx.QueryRow(ctx, `
		INSERT INTO work_queue (id, channel, payload, dedupe_key, created_at, priority)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (channel, dedupe_key) DO NOTHING
		RETURNING id
	`, id, externalImageSBOMChannel, payload, digest, now, persistence.PriorityNormal).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			if err := tx.Commit(ctx); err != nil {
				return false, fmt.Errorf("failed to commit duplicate SBOM enqueue conflict: %w", err)
			}
			return false, nil
		}
		return false, fmt.Errorf("failed to insert SBOM work for digest %s: %w", digest, err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO external_image_sbom_status
			(digest, created_at, status, status_message, updated_at, status_updated_at)
		VALUES ($1, $2, $3, NULL, $2, $2)
		ON CONFLICT (digest) DO UPDATE
		SET status = EXCLUDED.status,
		    status_message = NULL,
		    updated_at = EXCLUDED.updated_at,
		    status_updated_at = EXCLUDED.status_updated_at
	`, digest, now, string(SBOMStatusPending)); err != nil {
		return false, fmt.Errorf("failed to set pending SBOM status for digest %s: %w", digest, err)
	}

	if _, err := tx.Exec(ctx, `SELECT pg_notify($1, $2)`, externalImageSBOMChannel, id); err != nil {
		return false, fmt.Errorf("failed to notify SBOM work queue: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("failed to commit SBOM work for digest %s: %w", digest, err)
	}

	return true, nil
}
