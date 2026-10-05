package externalimage

import (
	"context"
	"encoding/json"
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
func EnqueueSBOMWork(ctx context.Context, payload, digest, arch string) (bool, error) {
	var payloadFields map[string]any
	if err := json.Unmarshal([]byte(payload), &payloadFields); err != nil {
		return false, fmt.Errorf("failed to decode SBOM work payload: %w", err)
	}
	payloadFields["arch"] = arch
	normalizedPayload, err := json.Marshal(payloadFields)
	if err != nil {
		return false, fmt.Errorf("failed to encode SBOM work payload: %w", err)
	}
	payload = string(normalizedPayload)

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("failed to begin SBOM enqueue transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	dedupeKey := digest + ":" + arch
	lockKey := externalImageSBOMChannel + ":" + dedupeKey
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
				  AND (dedupe_key = $2 OR (payload->>'digest' = $3 AND payload->>'arch' = $4))
			)
			OR EXISTS (
				SELECT 1
				FROM external_image_sbom_platform_status
				WHERE digest = $3 AND arch = $4
				  AND status = $5
				  AND COALESCE(status_updated_at, updated_at, created_at) > $6
			)
			OR EXISTS (
				SELECT 1
				FROM external_image_sbom_status
				WHERE digest = $3
				  AND status = $5
				  AND COALESCE(status_updated_at, updated_at, created_at) > $6
			)
			OR EXISTS (
				SELECT 1
				FROM external_image_sbom
				WHERE digest = $3 AND arch = $4
			)
	`, externalImageSBOMChannel, dedupeKey, digest, arch, string(SBOMStatusGenerating), generatingCutoff).Scan(&blocked); err != nil {
		return false, fmt.Errorf("failed to check existing SBOM work for digest %s: %w", digest, err)
	}
	if blocked {
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("failed to commit duplicate SBOM enqueue check: %w", err)
		}
		return false, nil
	}

	// New workers clear the key when work completes, but an older worker may
	// complete a keyed row during a rolling deployment without doing so. Release
	// such completed keys before inserting so they cannot block this digest
	// forever through the non-partial unique index.
	if _, err := tx.Exec(ctx, `
		UPDATE work_queue
		SET dedupe_key = NULL
		WHERE channel = $1
		  AND dedupe_key = $2
		  AND completed_at IS NOT NULL
	`, externalImageSBOMChannel, dedupeKey); err != nil {
		return false, fmt.Errorf("failed to release completed SBOM dedupe key for digest %s: %w", digest, err)
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
	`, id, externalImageSBOMChannel, payload, dedupeKey, now, persistence.PriorityNormal).Scan(&id)
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
		INSERT INTO external_image_sbom_platform_status
			(digest, arch, created_at, status, status_message, updated_at, status_updated_at)
		VALUES ($1, $2, $3, $4, NULL, $3, $3)
		ON CONFLICT (digest, arch) DO UPDATE
		SET status = EXCLUDED.status,
		    status_message = NULL,
		    updated_at = EXCLUDED.updated_at,
		    status_updated_at = EXCLUDED.status_updated_at
	`, digest, arch, now, string(SBOMStatusPending)); err != nil {
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
