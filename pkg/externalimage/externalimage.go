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
	Status               ScanStatus
	ParsedResults        string // JSON with vulnerability counts (for success)
	ParsedResultsDetails string // JSON with vulnerability details (for success)
	RawResult            string // Raw scan output (for success)
	ScanStatusMessage    string // Error message (for failure)
}

// SetScanStatusRunning marks a scan as running for a specific digest and architecture.
// This should be called immediately before starting the actual scan.
// Sets scan_attempted_at to the current time (both on insert and update).
func SetScanStatusRunning(ctx context.Context, digest, arch string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now()

	query := `
		INSERT INTO external_image_scan (digest, arch, created_at, status, updated_at, scan_attempted_at, scan_status_updated_at)
		VALUES ($1, $2, $3, $4, $3, $3, $3)
		ON CONFLICT (digest, arch) DO UPDATE
		SET status = $4,
		    updated_at = $3,
		    scan_attempted_at = $3,
		    scan_status_updated_at = $3
	`

	_, err := conn.Exec(ctx, query, digest, arch, now, string(ScanStatusRunning))
	if err != nil {
		return fmt.Errorf("failed to set scan status to running for digest %s, arch %s: %w", digest, arch, err)
	}

	return nil
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
// Sets scan_completed_at to the current time. For new rows, also sets scan_attempted_at.
// On conflict, scan_attempted_at is not updated (it should have been set by SetScanStatusRunning).
func SetExternalImageScanStatus(ctx context.Context, params SetExternalImageScanStatusParams) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now()

	var scanStatusMessage *string
	if params.ScanStatusMessage != "" {
		scanStatusMessage = &params.ScanStatusMessage
	}

	// Step 1: Upload blobs to object store (mandatory — fail on error)
	blobsUploaded := false
	if params.Status == ScanStatusSucceeded && params.RawResult != "" {
		store, err := newBlobStore(ctx)
		if err != nil {
			return fmt.Errorf("failed to create blob store: %w", err)
		}
		if err := store.putRawResult(ctx, params.Digest, params.Arch, params.RawResult); err != nil {
			return fmt.Errorf("failed to upload raw_result to object store: %w", err)
		}
		if params.ParsedResultsDetails != "" {
			if err := store.putParsedResultsDetails(ctx, params.Digest, params.Arch, params.ParsedResultsDetails); err != nil {
				return fmt.Errorf("failed to upload parsed_results_details to object store: %w", err)
			}
		}
		blobsUploaded = true
	}

	// Step 2: DB write — fail on error (S3 object stays, will be overwritten on retry)
	query := `
		INSERT INTO external_image_scan (digest, arch, parsed_results, parsed_results_details, raw_result, created_at, status, scan_status_message, updated_at, scan_completed_at, scan_attempted_at, scan_status_updated_at, is_in_object_store)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $6, $6, $6, $6, $9)
		ON CONFLICT (digest, arch) DO UPDATE
		SET parsed_results = $3,
		    parsed_results_details = $4,
		    raw_result = $5,
		    status = $7,
		    scan_status_message = $8,
		    updated_at = $6,
		    scan_completed_at = $6,
		    scan_status_updated_at = $6,
		    is_in_object_store = $9
	`

	_, err := conn.Exec(ctx, query,
		params.Digest,
		params.Arch,
		params.ParsedResults,
		params.ParsedResultsDetails,
		params.RawResult,
		now,
		string(params.Status),
		scanStatusMessage,
		blobsUploaded,
	)
	if err != nil {
		return fmt.Errorf("failed to set scan status for digest %s, arch %s: %w", params.Digest, params.Arch, err)
	}

	return nil
}

// GetExternalImageScanRawResult returns the raw scan result from object storage.
func GetExternalImageScanRawResult(ctx context.Context, digest, arch string) (string, error) {
	store, err := newBlobStore(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to create blob store: %w", err)
	}
	return store.getRawResult(ctx, digest, arch)
}

// GetExternalImageScanParsedResultsDetails returns parsed vulnerability details from object storage.
func GetExternalImageScanParsedResultsDetails(ctx context.Context, digest, arch string) (string, error) {
	store, err := newBlobStore(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to create blob store: %w", err)
	}
	return store.getParsedResultsDetails(ctx, digest, arch)
}

// GetExternalImageSBOMContent returns the SBOM JSON from object storage.
func GetExternalImageSBOMContent(ctx context.Context, digest, arch string) (string, error) {
	store, err := newBlobStore(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to create blob store: %w", err)
	}
	return store.getSBOM(ctx, digest, arch)
}

func GetExternalImageSBOM(ctx context.Context, digest string) (*string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Query metadata only (no sbom column) to find which arch has an SBOM
	query := `
		select arch
		from external_image_sbom
		where digest = $1
		limit 1
	`

	row := conn.QueryRow(ctx, query, digest)

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
		select digest, arch, source, created_at, image_digest
		from external_image_sbom
		where digest = $1
		order by arch
	`

	rows, err := conn.Query(ctx, query, digest)
	if err != nil {
		return nil, fmt.Errorf("failed to query external image SBOMs for digest %s: %w", digest, err)
	}
	defer rows.Close()

	// Fetch SBOM content from object store
	store, err := newBlobStore(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create blob store: %w", err)
	}

	var sboms []types.ExternalImageSBOM
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
		// Fetch SBOM content from object store
		content, err := store.getSBOM(ctx, sbom.Digest, sbom.Arch)
		if err != nil {
			return nil, fmt.Errorf("failed to get SBOM from object store for digest %s, arch %s: %w", sbom.Digest, sbom.Arch, err)
		}
		sbom.SBOM = content
		sboms = append(sboms, sbom)
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
	blobsUploaded := false
	if sbom != "" {
		store, err := newBlobStore(ctx)
		if err != nil {
			return fmt.Errorf("failed to create blob store: %w", err)
		}
		if err := store.putSBOM(ctx, digest, arch, sbom); err != nil {
			return fmt.Errorf("failed to upload sbom to object store: %w", err)
		}
		blobsUploaded = true
	}

	// Step 2: DB write — fail on error (S3 object stays, will be overwritten on retry)
	query := `
		insert into external_image_sbom (digest, arch, sbom, source, image_size_bytes, image_digest, created_at, is_in_object_store)
		values ($1, $2, $3, $4, $5, $6, $7, $8)
		on conflict (digest, arch) do update
		set sbom = $3, source = $4, image_size_bytes = $5, image_digest = $6, created_at = $7, is_in_object_store = $8
	`

	_, err := conn.Exec(ctx, query, digest, arch, sbom, source, imageSizeBytes, imageDigest, time.Now(), blobsUploaded)
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
		select digest, registry, image_name, array_agg(image_tag), max(created_at) as max_created_at
		from external_image_tag
		where next_check_digest_at < $1
		group by digest, registry, image_name
		order by max_created_at desc
	`

	rows, err := conn.Query(ctx, query, now)
	if err != nil {
		return nil, fmt.Errorf("failed to query external images needing digest check: %w", err)
	}
	defer rows.Close()

	var externalImages []*types.ExternalImage

	for rows.Next() {
		var digest, registry, imageName string
		var tags []string
		var createdAt time.Time

		err := rows.Scan(&digest, &registry, &imageName, &tags, &createdAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan external image row for digest check: %w", err)
		}

		externalImages = append(externalImages, &types.ExternalImage{
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

func GetExternalImageCredentials(ctx context.Context, registry string, imageName string) (string, string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		select username, password from external_image_credential where registry = $1 and image_name = $2
	`

	row := conn.QueryRow(ctx, query, registry, imageName)

	var username sql.NullString
	var password sql.NullString
	err := row.Scan(&username, &password)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", "", nil
		}
		return "", "", fmt.Errorf("failed to scan external image credentials for %s/%s: %w", registry, imageName, err)
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

// MigrateScanStatusColumn migrates existing external_image_scan rows to have the correct
// status value based on their data. This is needed because when the status column was added,
// existing rows received the default value 'queued' even if they had completed scans.
// This function is idempotent - if no rows match, it updates nothing.
func MigrateScanStatusColumn(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Quick check: are there any rows that need migration?
	// These are rows with status='queued' that have scan data (parsed_results or scan_status_message),
	// indicating they completed but weren't migrated to the new status values.
	var needsMigration bool
	checkQuery := `
		SELECT EXISTS (
			SELECT 1 FROM external_image_scan
			WHERE status = 'queued'
			  AND (parsed_results IS NOT NULL OR scan_status_message IS NOT NULL)
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

	// Migrate rows: parsed_results -> 'succeeded', scan_status_message -> 'failed'
	query := `
		UPDATE external_image_scan
		SET status = CASE
		        WHEN parsed_results IS NOT NULL THEN 'succeeded'
		        WHEN scan_status_message IS NOT NULL THEN 'failed'
		    END,
		    scan_status_updated_at = CASE
		        WHEN parsed_results IS NOT NULL THEN COALESCE(scan_completed_at, updated_at, created_at)
		        WHEN scan_status_message IS NOT NULL THEN COALESCE(updated_at, created_at)
		    END
		WHERE status = 'queued'
		  AND (parsed_results IS NOT NULL OR scan_status_message IS NOT NULL)
	`
	result, err := conn.Exec(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to migrate scan statuses: %w", err)
	}

	logger.Infof("Migrated %d external_image_scan rows", result.RowsAffected())

	return nil
}
