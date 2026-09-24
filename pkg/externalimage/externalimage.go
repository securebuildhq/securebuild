package externalimage

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/externalimage/types"
	"github.com/securebuildhq/securebuild/pkg/image"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/util"
)

// SBOMStatus represents the status of SBOM generation for an external image.
//
// Status progression:
//  1. pending: SBOM generation requested but not yet started
//  2. generating: SBOM generation in progress (downloading from registry)
//  3. succeeded: SBOM successfully generated and stored
//  4. failed: SBOM generation failed (see status_message for details)
type SBOMStatus string

const (
	SBOMStatusPending    SBOMStatus = "pending"
	SBOMStatusGenerating SBOMStatus = "generating"
	SBOMStatusSucceeded  SBOMStatus = "succeeded"
	SBOMStatusFailed     SBOMStatus = "failed"
)

// ScanStatus represents the status of a vulnerability scan for an external image.
//
// Status progression:
//  1. queued: SBOM generated, waiting for vulnerability scan to start
//  2. running: Vulnerability scan actively executing
//  3. succeeded: Scan completed successfully with results
//  4. failed: Scan failed with error (see scan_status_message for details)
//
// Note: Scan status is only created after SBOM generation succeeds.
type ScanStatus string

const (
	ScanStatusUnknown   ScanStatus = "unknown"
	ScanStatusQueued    ScanStatus = "queued"
	ScanStatusRunning   ScanStatus = "running"
	ScanStatusSucceeded ScanStatus = "succeeded"
	ScanStatusFailed    ScanStatus = "failed"
)

func ListExternalImageTags(ctx context.Context, registry string, imageName string) ([]string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		select image_tag
		from external_image_tag
		where registry = $1 and image_name = $2
	`

	rows, err := conn.Query(ctx, query, registry, imageName)
	if err != nil {
		return nil, fmt.Errorf("failed to query external image tags for %s/%s: %w", registry, imageName, err)
	}
	defer rows.Close()

	var tags []string
	for rows.Next() {
		var tag string
		err := rows.Scan(&tag)
		if err != nil {
			return nil, fmt.Errorf("failed to scan external image tag row: %w", err)
		}
		tags = append(tags, tag)
	}

	return tags, nil
}

func GetExternalImageForDigest(ctx context.Context, digest string) (*types.ExternalImage, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		select digest, registry, image_name, image_tag, created_at
		from external_image_tag
		where digest = $1
		order by digest, registry, image_name
	`

	rows, err := conn.Query(ctx, query, digest)
	if err != nil {
		return nil, fmt.Errorf("failed to query external image for digest %s: %w", digest, err)
	}
	defer rows.Close()

	var externalImage *types.ExternalImage

	for rows.Next() {
		var rowDigest, registry, imageName, imageTag string
		var createdAt time.Time

		err := rows.Scan(&rowDigest, &registry, &imageName, &imageTag, &createdAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan external image row: %w", err)
		}

		// Check if we need to create a new ExternalImage object
		// (when digest, registry, or image_name changes)
		if externalImage == nil ||
			externalImage.Digest != rowDigest ||
			externalImage.Registry != registry ||
			externalImage.ImageName != imageName {

			// Create new ExternalImage object
			externalImage = &types.ExternalImage{
				Digest:    rowDigest,
				Registry:  registry,
				ImageName: imageName,
				Tags:      []string{imageTag},
				CreatedAt: createdAt,
			}
		} else {
			// Same digest, registry, and image_name - add tag to current image
			externalImage.Tags = append(externalImage.Tags, imageTag)
		}
	}

	if externalImage == nil {
		return nil, ErrExternalImageNotFound
	}

	return externalImage, nil
}

// SetExternalImageScanStatusParams contains parameters for setting scan status
type SetExternalImageScanStatusParams struct {
	Digest               string
	Arch                 string
	ScanGenerationID     string // Claimed scan generation (required for worker results)
	Status               ScanStatus
	ParsedResults        string // JSON with vulnerability counts (for success)
	ParsedResultsDetails string // JSON with vulnerability details (for success)
	RawResult            string // Raw scan output (for success)
	ScanStatusMessage    string // Error message (for failure)
}

// SetScanStatusRunning marks a scan as running for a specific digest and architecture.
// This should be called immediately before starting the actual scan.
// Sets scan_attempted_at to the current time (both on insert and update).
func SetScanStatusRunning(ctx context.Context, digest, arch, generationID string) error {
	if generationID == "" {
		return fmt.Errorf("scan generation ID is required when marking a scan running")
	}
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now()

	query := `
		INSERT INTO external_image_scan (digest, arch, created_at, status, updated_at, scan_attempted_at, scan_status_updated_at, current_scan_generation_id)
		VALUES ($1, $2, $3, $4, $3, $3, $3, $5)
		ON CONFLICT (digest, arch) DO UPDATE
		SET status = $4,
		    updated_at = $3,
		    scan_attempted_at = $3,
		    scan_status_updated_at = $3,
		    current_scan_generation_id = $5
	`

	_, err := conn.Exec(ctx, query, digest, arch, now, string(ScanStatusRunning), generationID)
	if err != nil {
		return fmt.Errorf("failed to set scan status to running for digest %s, arch %s: %w", digest, arch, err)
	}

	return nil
}

// ClaimScanGeneration atomically claims every requested architecture for one
// scan generation. Missing scan rows are created in the same transaction. A
// partial claim is rolled back so callers never dispatch architectures that do
// not all carry the same generation fence.
func ClaimScanGeneration(ctx context.Context, digest string, archs []string, generationID string, staleThreshold time.Duration) (bool, error) {
	archs = uniqueArchitectures(archs)
	if digest == "" || generationID == "" || len(archs) == 0 {
		return false, fmt.Errorf("digest, generation ID, and at least one architecture are required")
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("failed to begin scan claim transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	now := time.Now()
	_, err = tx.Exec(ctx, `
		INSERT INTO external_image_scan (
			digest, arch, created_at, status, updated_at, scan_status_updated_at
		)
		SELECT $1, requested_arch, $3, 'queued', $3, $3
		FROM unnest($2::text[]) AS requested_arch
		ON CONFLICT (digest, arch) DO NOTHING
	`, digest, archs, now)
	if err != nil {
		return false, fmt.Errorf("failed to ensure scan rows before claim: %w", err)
	}

	result, err := tx.Exec(ctx, `
		UPDATE external_image_scan
		SET status = 'running',
		    scan_status_updated_at = $4,
		    scan_status_message = NULL,
		    scan_attempted_at = COALESCE(scan_attempted_at, $4),
		    current_scan_generation_id = $3
		WHERE digest = $1
		  AND arch = ANY($2::text[])
		  AND (
		    status != 'running'
		    OR COALESCE(scan_status_updated_at, created_at) <= $5
		  )
	`, digest, archs, generationID, now, now.Add(-staleThreshold))
	if err != nil {
		return false, fmt.Errorf("failed to claim scan rows: %w", err)
	}
	if result.RowsAffected() != int64(len(archs)) {
		return false, nil
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("failed to commit scan claim: %w", err)
	}
	return true, nil
}

// AdoptLegacyScanGeneration assigns a stable generation fence to a builder
// scan created before generation IDs were written to scan.json. Adoption only
// succeeds while every requested row is still running and either unclaimed or
// already assigned to the same derived generation.
func AdoptLegacyScanGeneration(ctx context.Context, digest string, archs []string, generationID string) error {
	archs = uniqueArchitectures(archs)
	if digest == "" || generationID == "" || len(archs) == 0 {
		return fmt.Errorf("digest, generation ID, and at least one architecture are required")
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin legacy scan adoption transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	result, err := tx.Exec(ctx, `
		UPDATE external_image_scan
		SET current_scan_generation_id = $3
		WHERE digest = $1
		  AND arch = ANY($2::text[])
		  AND status = 'running'
		  AND (current_scan_generation_id IS NULL OR current_scan_generation_id = $3)
	`, digest, archs, generationID)
	if err != nil {
		return fmt.Errorf("failed to adopt legacy scan generation: %w", err)
	}
	if result.RowsAffected() != int64(len(archs)) {
		return fmt.Errorf("%w: legacy scan %s is no longer current for every architecture", ErrStaleScanGeneration, generationID)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit legacy scan adoption: %w", err)
	}
	return nil
}

// RequeueScanGeneration requeues only rows still owned by the missing
// builder's generation. An empty generation ID is reserved for pre-rollout
// scans and can only update rows that still have a NULL generation fence.
func RequeueScanGeneration(ctx context.Context, digest string, archs []string, generationID, message string) (int64, error) {
	archs = uniqueArchitectures(archs)
	if digest == "" || len(archs) == 0 {
		return 0, fmt.Errorf("digest and at least one architecture are required")
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	generationPredicate := "current_scan_generation_id = $5"
	args := []any{digest, archs, time.Now(), message, generationID}
	if generationID == "" {
		generationPredicate = "current_scan_generation_id IS NULL"
		args = args[:4]
	}

	result, err := conn.Exec(ctx, `
		UPDATE external_image_scan
		SET status = 'queued',
		    scan_status_updated_at = $3,
		    scan_status_message = $4,
		    updated_at = $3,
		    current_scan_generation_id = NULL
		WHERE digest = $1
		  AND arch = ANY($2::text[])
		  AND status = 'running'
		  AND `+generationPredicate,
		args...)
	if err != nil {
		return 0, fmt.Errorf("failed to requeue scan generation: %w", err)
	}
	return result.RowsAffected(), nil
}

func uniqueArchitectures(archs []string) []string {
	seen := make(map[string]struct{}, len(archs))
	result := make([]string, 0, len(archs))
	for _, arch := range archs {
		if arch == "" {
			continue
		}
		if _, ok := seen[arch]; ok {
			continue
		}
		seen[arch] = struct{}{}
		result = append(result, arch)
	}
	return result
}

// InitializeSBOMStatusPending initializes SBOM status to pending for a digest.
// Uses ON CONFLICT DO NOTHING to avoid overwriting existing status.
// SBOM generation is an atomic operation that processes all architectures at once,
// so we track a single status per digest (not per architecture).
func InitializeSBOMStatusPending(ctx context.Context, digest string) error {
	logger.Debugf("initializing SBOM status to pending for digest %s", digest)
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now()

	query := `
		INSERT INTO external_image_sbom_status (digest, created_at, status, updated_at, status_updated_at)
		VALUES ($1, $2, $3, $2, $2)
		ON CONFLICT (digest) DO NOTHING
	`

	_, err := conn.Exec(ctx, query, digest, now, string(SBOMStatusPending))
	if err != nil {
		return fmt.Errorf("failed to initialize SBOM status to pending for digest %s: %w", digest, err)
	}

	return nil
}

// SetSBOMStatusGenerating updates SBOM status to 'generating' for all architectures of a digest.
// This is used when SBOM generation starts to indicate the download is in progress.
func SetSBOMStatusGenerating(ctx context.Context, digest string) error {
	logger.Debugf("setting SBOM status to generating for digest %s", digest)
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now()

	query := `
		UPDATE external_image_sbom_status
		SET status = $1,
		    updated_at = $2,
		    status_updated_at = $2
		WHERE digest = $3
	`

	_, err := conn.Exec(ctx, query, string(SBOMStatusGenerating), now, digest)
	if err != nil {
		return fmt.Errorf("failed to set SBOM status to generating for digest %s: %w", digest, err)
	}

	return nil
}

// SetSBOMStatusSucceeded marks SBOM generation as succeeded for the digest.
// This should be called after successfully storing all SBOMs in external_image_sbom table.
func SetSBOMStatusSucceeded(ctx context.Context, digest string) error {
	logger.Debugf("setting SBOM status to succeeded for digest %s", digest)
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now()

	query := `
		UPDATE external_image_sbom_status
		SET status = $1,
		    status_message = NULL,
		    updated_at = $2,
		    status_updated_at = $2
		WHERE digest = $3
	`

	result, err := conn.Exec(ctx, query, string(SBOMStatusSucceeded), now, digest)
	if err != nil {
		return fmt.Errorf("failed to set SBOM status to succeeded for digest %s: %w", digest, err)
	}

	rowsAffected := result.RowsAffected()
	logger.Debugf("SetSBOMStatusSucceeded updated %d rows for digest %s", rowsAffected, digest)
	if rowsAffected == 0 {
		return fmt.Errorf("no SBOM status row found to update for digest %s (expected 1 row, updated 0 rows)", digest)
	}

	return nil
}

// SetSBOMStatusFailed marks SBOM generation as failed with an error message.
func SetSBOMStatusFailed(ctx context.Context, digest string, errorMessage string) error {
	logger.Debugf("setting SBOM status to failed for digest %s", digest)
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now()

	query := `
		UPDATE external_image_sbom_status
		SET status = $1,
		    status_message = $2,
		    updated_at = $3,
		    status_updated_at = $3
		WHERE digest = $4
	`

	_, err := conn.Exec(ctx, query, string(SBOMStatusFailed), errorMessage, now, digest)
	if err != nil {
		return fmt.Errorf("failed to set SBOM status to failed for digest %s: %w", digest, err)
	}

	return nil
}

// InitializeScanStatusQueued creates a scan status record with status='queued'.
// This is used after SBOM creation to indicate that a scan is pending.
// Does not set scan_attempted_at or scan_completed_at (those are set when scan actually runs).
// On conflict, updates status to 'queued' only if current status is 'unknown',
// 'pending_sbom', or 'generating_sbom'.
func InitializeScanStatusQueued(ctx context.Context, digest, arch string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now()

	query := `
		INSERT INTO external_image_scan (digest, arch, created_at, status, updated_at, scan_status_updated_at)
		VALUES ($1, $2, $3, $4, $3, $3)
		ON CONFLICT (digest, arch) DO UPDATE
		SET status = $4,
		    updated_at = $3,
		    scan_status_updated_at = $3
		WHERE external_image_scan.status IN ('unknown', 'pending_sbom', 'generating_sbom')
	`

	_, err := conn.Exec(ctx, query, digest, arch, now, string(ScanStatusQueued))
	if err != nil {
		return fmt.Errorf("failed to initialize scan status to queued for digest %s, arch %s: %w", digest, arch, err)
	}

	return nil
}

// SetExternalImageScanStatus records a scan result (success or failure).
// scan_completed_at tracks the last successfully persisted result, so status-only
// updates preserve it. For new rows, scan_attempted_at is also set.
// On conflict, scan_attempted_at is not updated (it should have been set by SetScanStatusRunning).
func SetExternalImageScanStatus(ctx context.Context, params SetExternalImageScanStatusParams) error {
	if params.Status == ScanStatusSucceeded {
		return publishSuccessfulScan(ctx, params)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now()

	var scanStatusMessage *string
	if params.ScanStatusMessage != "" {
		scanStatusMessage = &params.ScanStatusMessage
	}

	// Status-only updates preserve the last selected generation, compact counts,
	// successful completion time, and object availability.
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin scan status transaction for digest %s, arch %s: %w", params.Digest, params.Arch, err)
	}
	defer tx.Rollback(ctx)

	if params.ScanGenerationID != "" {
		result, err := tx.Exec(ctx, `
			UPDATE external_image_scan
			SET status = $4,
			    scan_status_message = $5,
			    updated_at = $3,
			    scan_status_updated_at = $3
			WHERE digest = $1 AND arch = $2
			  AND current_scan_generation_id = $6
		`, params.Digest, params.Arch, now, string(params.Status), scanStatusMessage, params.ScanGenerationID)
		if err != nil {
			return fmt.Errorf("failed to set scan status for digest %s, arch %s: %w", params.Digest, params.Arch, err)
		}
		if result.RowsAffected() != 1 {
			return fmt.Errorf("%w: generation %s cannot update status for %s/%s", ErrStaleScanGeneration, params.ScanGenerationID, params.Digest, params.Arch)
		}
	} else {
		query := `
		INSERT INTO external_image_scan (digest, arch, parsed_results, created_at, status, scan_status_message, updated_at, scan_completed_at, scan_attempted_at, scan_status_updated_at, is_in_object_store)
		VALUES ($1, $2, NULL, $3, $4, $5, $3, NULL, $3, $3, false)
		ON CONFLICT (digest, arch) DO UPDATE
		SET status = $4,
		    scan_status_message = $5,
		    updated_at = $3,
		    scan_status_updated_at = $3
		WHERE external_image_scan.status != 'running'
		   OR external_image_scan.current_scan_generation_id IS NULL
	`

		result, err := tx.Exec(ctx, query,
			params.Digest,
			params.Arch,
			now,
			string(params.Status),
			scanStatusMessage,
		)
		if err != nil {
			return fmt.Errorf("failed to set scan status for digest %s, arch %s: %w", params.Digest, params.Arch, err)
		}
		if result.RowsAffected() != 1 {
			return fmt.Errorf("%w: generationless status update cannot replace the active scan for %s/%s", ErrStaleScanGeneration, params.Digest, params.Arch)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit scan status for digest %s, arch %s: %w", params.Digest, params.Arch, err)
	}

	return nil
}

func GetExternalImageSBOM(ctx context.Context, digest string) (*string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Query metadata only (no sbom column) to find which arch has an SBOM
	query := `
		select esbom.arch
		from external_image_sbom esbom
		inner join external_image_sbom_status status on status.digest = esbom.digest
		where esbom.digest = $1
		  and esbom.is_in_object_store = true
		  and status.status = $2
		limit 1
	`

	row := conn.QueryRow(ctx, query, digest, string(SBOMStatusSucceeded))

	var arch string
	err := row.Scan(&arch)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to query external image SBOM for digest %s: %w", digest, err)
	}

	// Fetch SBOM content from object store
	store, err := newBlobStore(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create blob store: %w", err)
	}
	sbom, err := store.getSBOM(ctx, digest, arch)
	if err != nil {
		return nil, fmt.Errorf("failed to get SBOM from object store for digest %s, arch %s: %w", digest, arch, err)
	}

	return &sbom, nil
}

func GetExternalImageSBOMs(ctx context.Context, digest string) ([]types.ExternalImageSBOM, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Query metadata only (no sbom column)
	query := `
		select esbom.digest, esbom.arch, esbom.source, esbom.created_at, esbom.image_digest
		from external_image_sbom esbom
		inner join external_image_sbom_status status on status.digest = esbom.digest
		where esbom.digest = $1
		  and esbom.is_in_object_store = true
		  and status.status = $2
		order by esbom.arch
	`

	rows, err := conn.Query(ctx, query, digest, string(SBOMStatusSucceeded))
	if err != nil {
		return nil, fmt.Errorf("failed to query external image SBOMs for digest %s: %w", digest, err)
	}
	defer rows.Close()

	var sboms []types.ExternalImageSBOM
	var store *blobStore
	for rows.Next() {
		var sbom types.ExternalImageSBOM
		var imageDigest sql.NullString
		err := rows.Scan(&sbom.Digest, &sbom.Arch, &sbom.Source, &sbom.CreatedAt, &imageDigest)
		if err != nil {
			return nil, fmt.Errorf("failed to scan external image SBOM row: %w", err)
		}
		if imageDigest.Valid {
			sbom.ImageDigest = imageDigest.String
		}
		if store == nil {
			store, err = newBlobStore(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to create blob store: %w", err)
			}
		}
		// Fetch SBOM content from object store
		content, err := store.getSBOM(ctx, sbom.Digest, sbom.Arch)
		if err != nil {
			return nil, fmt.Errorf("failed to get SBOM from object store for digest %s, arch %s: %w", sbom.Digest, sbom.Arch, err)
		}
		sbom.SBOM = content
		sboms = append(sboms, sbom)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed while reading external image SBOM rows for digest %s: %w", digest, err)
	}

	return sboms, nil
}

// HasExistingSBOM checks if an SBOM already exists for this digest.
// Used to prevent duplicate enqueuing.
func HasExistingSBOM(ctx context.Context, digest string) (bool, error) {
	sbom, err := GetExternalImageSBOM(ctx, digest)
	if err != nil {
		return false, err
	}
	return sbom != nil, nil
}

// WasScannedRecently checks whether the digest was scanned within the given duration.
// Uses last_security_scanned_at from external_image_sbom (digest-level timestamp).
// Returns true only if every architecture has been scanned and the oldest scan
// is within the threshold. Returns false if any architecture has never been
// scanned (NULL last_security_scanned_at) or if the oldest scan is stale.
func WasScannedRecently(ctx context.Context, digest string, threshold time.Duration) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var hasUnscanned bool
	var lastScannedAt *time.Time
	err := conn.QueryRow(ctx, `
		SELECT
			bool_or(last_security_scanned_at IS NULL),
			min(last_security_scanned_at)
		FROM external_image_sbom
		WHERE digest = $1
	`, digest).Scan(&hasUnscanned, &lastScannedAt)
	if err != nil {
		return false, fmt.Errorf("failed to check scan recency for digest %s: %w", digest, err)
	}

	if hasUnscanned || lastScannedAt == nil {
		return false, nil
	}

	now := util.GetNowFunc(ctx)()
	return now.Sub(*lastScannedAt) < threshold, nil
}

func SetExternalImageSBOM(ctx context.Context, digest string, sbom string, source string, arch string, imageSizeBytes int64, imageDigest string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Step 1: Upload SBOM to object store (mandatory — fail on error)
	blobUploaded := false
	if sbom != "" {
		store, err := newBlobStore(ctx)
		if err != nil {
			return fmt.Errorf("failed to create blob store: %w", err)
		}
		if err := store.putSBOM(ctx, digest, arch, sbom); err != nil {
			return fmt.Errorf("failed to upload sbom to object store: %w", err)
		}
		blobUploaded = true
	}

	// Step 2: Write metadata to DB. SBOM content lives only in object storage.
	query := `
		insert into external_image_sbom (digest, arch, source, image_size_bytes, image_digest, created_at, is_in_object_store)
		values ($1, $2, $3, $4, $5, $6, $7)
		on conflict (digest, arch) do update
		set source = $3, image_size_bytes = $4, image_digest = $5, created_at = $6, is_in_object_store = $7
	`

	_, err := conn.Exec(ctx, query, digest, arch, source, imageSizeBytes, imageDigest, time.Now(), blobUploaded)
	if err != nil {
		return fmt.Errorf("failed to insert/update external image SBOM for digest %s, arch %s: %w", digest, arch, err)
	}

	return nil
}

func ListExternalImagesNeedDigestCheck(ctx context.Context) ([]*types.ExternalImage, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now()
	query := `
		select eit.team_id, et.digest, et.registry, et.image_name, array_agg(et.image_tag), max(et.created_at) as max_created_at
		from external_image_tag et
		join external_image_team eit
		  on eit.registry = et.registry
		 and eit.image_name = et.image_name
		 and eit.image_tag = et.image_tag
		where et.next_check_digest_at < $1
		group by eit.team_id, et.digest, et.registry, et.image_name
		order by max_created_at desc
	`

	rows, err := conn.Query(ctx, query, now)
	if err != nil {
		return nil, fmt.Errorf("failed to query external images needing digest check: %w", err)
	}
	defer rows.Close()

	var externalImages []*types.ExternalImage

	for rows.Next() {
		var teamID, digest, registry, imageName string
		var tags []string
		var createdAt time.Time

		err := rows.Scan(&teamID, &digest, &registry, &imageName, &tags, &createdAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan external image row for digest check: %w", err)
		}

		externalImages = append(externalImages, &types.ExternalImage{
			TeamID:    teamID,
			Digest:    digest,
			Registry:  registry,
			ImageName: imageName,
			Tags:      tags,
			CreatedAt: createdAt,
		})
	}

	return externalImages, nil
}

func AddExternalImage(ctx context.Context, registry string, imageName string, tag string, digest string, username string, password string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Insert into external_image table (with ON CONFLICT DO NOTHING to avoid duplicates)
	query := `
		insert into external_image (registry, image_name, created_at)
		values ($1, $2, $3)
		on conflict (registry, image_name) do nothing
	`

	_, err := conn.Exec(ctx, query, registry, imageName, time.Now())
	if err != nil {
		return fmt.Errorf("failed to insert external image %s/%s: %w", registry, imageName, err)
	}

	// Insert into external_image_tag table
	// Set last_submitted_at = now() so the digest is included in scan tier
	// queries. The monitor re-adds an image when it detects a digest change,
	// which indicates active tracking — same as the API submission path.
	now := time.Now()
	query = `
		insert into external_image_tag (registry, image_name, image_tag, created_at, last_submitted_at, digest, next_check_digest_at, next_scan_at)
		values ($1, $2, $3, $4, $4, $5, $6, $7)
		on conflict (registry, image_name, image_tag) do update
		set digest = $5, last_submitted_at = $4, next_check_digest_at = $6, next_scan_at = $7, created_at = $4
	`

	inFourHours := now.Add(time.Hour * 4)
	_, err = conn.Exec(ctx, query, registry, imageName, tag, now, digest, inFourHours, inFourHours)
	if err != nil {
		return fmt.Errorf("failed to insert/update external image tag %s/%s:%s: %w", registry, imageName, tag, err)
	}

	return nil
}

func UpdateExternalImageTagNextCheckDigestAt(ctx context.Context, registry string, imageName string, tags []string, nextCheckDigestAt time.Time) error {
	if len(tags) == 0 {
		return nil
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		update external_image_tag set next_check_digest_at = $1 
		where registry = $2 and image_name = $3 and image_tag = ANY($4)
	`

	_, err := conn.Exec(ctx, query, nextCheckDigestAt, registry, imageName, tags)
	if err != nil {
		return fmt.Errorf("failed to update next check digest time for %s/%s with %d tags: %w", registry, imageName, len(tags), err)
	}

	return nil
}

func GetExternalImageCredentials(ctx context.Context, teamID string, registry string, imageName string) (string, string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		select username, password
		from external_image_credential
		where registry = $1 and image_name = $2 and team_id = $3
	`

	row := conn.QueryRow(ctx, query, registry, imageName, teamID)

	var username sql.NullString
	var password sql.NullString
	err := row.Scan(&username, &password)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", "", nil
		}
		return "", "", fmt.Errorf("failed to scan external image credentials for team %s and image %s/%s: %w", teamID, registry, imageName, err)
	}

	if !username.Valid || !password.Valid {
		return "", "", nil
	}

	clearPassword, err := image.DecryptExternalRegistryPassword(ctx, password.String)
	if err != nil {
		return "", "", fmt.Errorf("failed to get decrypted password for external image: %w", err)
	}

	return username.String, clearPassword, nil
}

// MigrateScanStatusColumn migrates legacy external_image_scan rows and repairs
// rows that an older version of this migration incorrectly marked succeeded.
// Legacy rows are identified by a NULL scan_status_updated_at; current writers
// always populate that column, including for legitimate queued rescans that
// retain results from a previous successful scan.
func MigrateScanStatusColumn(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Quick check for either an unmigrated legacy row or a false success created
	// when the old migration treated an empty parsed_results string as data.
	var needsMigration bool
	checkQuery := `
		SELECT EXISTS (
			SELECT 1 FROM external_image_scan
			WHERE (
			        status = 'queued'
			        AND scan_status_updated_at IS NULL
			        AND (
			          NULLIF(BTRIM(parsed_results), '') IS NOT NULL
			          OR NULLIF(BTRIM(scan_status_message), '') IS NOT NULL
			        )
			      )
			   OR (
			        status = 'succeeded'
			        AND NULLIF(BTRIM(parsed_results), '') IS NULL
			        AND NULLIF(BTRIM(scan_status_message), '') IS NOT NULL
			      )
			LIMIT 1
		)
	`
	if err := conn.QueryRow(ctx, checkQuery).Scan(&needsMigration); err != nil {
		return fmt.Errorf("failed to check if scan status migration is needed: %w", err)
	}

	if !needsMigration {
		logger.Debug("Scan status migration not needed")
		return nil
	}

	// Migrate legacy rows with real counts to succeeded and legacy rows with an
	// error message to failed. Also repair false successes produced by the old
	// empty-string check.
	query := `
		UPDATE external_image_scan
		SET status = CASE
		        WHEN status = 'succeeded' THEN 'failed'
		        WHEN NULLIF(BTRIM(parsed_results), '') IS NOT NULL THEN 'succeeded'
		        WHEN NULLIF(BTRIM(scan_status_message), '') IS NOT NULL THEN 'failed'
		    END,
		    scan_status_updated_at = CASE
		        WHEN status = 'succeeded' THEN COALESCE(scan_status_updated_at, updated_at, created_at)
		        WHEN NULLIF(BTRIM(parsed_results), '') IS NOT NULL THEN COALESCE(scan_completed_at, updated_at, created_at)
		        WHEN NULLIF(BTRIM(scan_status_message), '') IS NOT NULL THEN COALESCE(updated_at, created_at)
		    END
		WHERE (
		        status = 'queued'
		        AND scan_status_updated_at IS NULL
		        AND (
		          NULLIF(BTRIM(parsed_results), '') IS NOT NULL
		          OR NULLIF(BTRIM(scan_status_message), '') IS NOT NULL
		        )
		      )
		   OR (
		        status = 'succeeded'
		        AND NULLIF(BTRIM(parsed_results), '') IS NULL
		        AND NULLIF(BTRIM(scan_status_message), '') IS NOT NULL
		      )
	`
	result, err := conn.Exec(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to migrate scan statuses: %w", err)
	}

	logger.Infof("Migrated %d external_image_scan rows", result.RowsAffected())

	return nil
}
