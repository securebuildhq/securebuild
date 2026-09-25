package externalimage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

const scanCandidateCleanupDelay = 24 * time.Hour

// ScanPublicationFailureStage identifies a deterministic integration-test
// failure point in the scan publication pipeline.
type ScanPublicationFailureStage string

const (
	ScanPublicationFailureBeforeRawUpload ScanPublicationFailureStage = "before_raw_upload"
	ScanPublicationFailureBetweenUploads  ScanPublicationFailureStage = "between_uploads"
	ScanPublicationFailureValidation      ScanPublicationFailureStage = "validation"
	ScanPublicationFailureSelection       ScanPublicationFailureStage = "selection"
)

type scanPublicationFailureContextKey struct{}
type scanPublicationPauseContextKey struct{}

type scanPublicationPause struct {
	stage   ScanPublicationFailureStage
	reached chan<- struct{}
	resume  <-chan struct{}
}

// WithScanPublicationFailure returns a context that fails publication at a
// named stage. It is intended for integration tests and is context-local so
// parallel tests cannot interfere with each other.
func WithScanPublicationFailure(ctx context.Context, stage ScanPublicationFailureStage) context.Context {
	return context.WithValue(ctx, scanPublicationFailureContextKey{}, stage)
}

// WithScanPublicationPause returns a context that pauses publication at a
// named stage until resume is closed or receives a value. It is intended for
// integration tests that need to synchronize concurrent publishers.
func WithScanPublicationPause(ctx context.Context, stage ScanPublicationFailureStage, reached chan<- struct{}, resume <-chan struct{}) context.Context {
	return context.WithValue(ctx, scanPublicationPauseContextKey{}, scanPublicationPause{
		stage:   stage,
		reached: reached,
		resume:  resume,
	})
}

func injectScanPublicationFailure(ctx context.Context, stage ScanPublicationFailureStage) error {
	if pause, ok := ctx.Value(scanPublicationPauseContextKey{}).(scanPublicationPause); ok && pause.stage == stage {
		select {
		case pause.reached <- struct{}{}:
		case <-ctx.Done():
			return ctx.Err()
		}
		select {
		case <-pause.resume:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if configured, ok := ctx.Value(scanPublicationFailureContextKey{}).(ScanPublicationFailureStage); ok && configured == stage {
		return fmt.Errorf("injected scan publication failure at %s", stage)
	}
	return nil
}

type scanObjectStore interface {
	putCompressed(context.Context, string, []byte) error
	getCompressed(context.Context, string) ([]byte, error)
	deleteMany(context.Context, []string) error
}

type scanObjectStoreContextKey struct{}

// withScanObjectStore is used by publication tests to inject deterministic
// object-store failures without changing process-global state.
func withScanObjectStore(ctx context.Context, store scanObjectStore) context.Context {
	return context.WithValue(ctx, scanObjectStoreContextKey{}, store)
}

func getScanObjectStore(ctx context.Context) (scanObjectStore, error) {
	if store, ok := ctx.Value(scanObjectStoreContextKey{}).(scanObjectStore); ok {
		return store, nil
	}
	return newBlobStore(ctx)
}

type scanArtifact struct {
	key        string
	compressed []byte
	size       int64
	sha256     string
}

type scanCandidate struct {
	generationID string
	digest       string
	arch         string
	state        string
	raw          scanArtifact
	details      scanArtifact
}

func newScanArtifact(key, payload string) (scanArtifact, error) {
	if !json.Valid([]byte(payload)) {
		return scanArtifact{}, fmt.Errorf("%w: payload for %s is not valid JSON", ErrInvalidScanCandidate, key)
	}
	compressed, err := gzipData(payload)
	if err != nil {
		return scanArtifact{}, err
	}
	sum := sha256.Sum256(compressed)
	return scanArtifact{
		key:        key,
		compressed: compressed,
		size:       int64(len(compressed)),
		sha256:     hex.EncodeToString(sum[:]),
	}, nil
}

func newScanCandidate(params SetExternalImageScanStatusParams) (scanCandidate, error) {
	if params.ScanGenerationID == "" {
		return scanCandidate{}, fmt.Errorf("%w: successful publication requires a scan generation ID", ErrInvalidScanCandidate)
	}
	if params.RawResult == "" || params.ParsedResultsDetails == "" || params.ParsedResults == "" {
		return scanCandidate{}, fmt.Errorf("%w: successful publication requires raw, detailed, and compact results", ErrInvalidScanCandidate)
	}
	if !json.Valid([]byte(params.ParsedResults)) {
		return scanCandidate{}, fmt.Errorf("%w: compact results are not valid JSON", ErrInvalidScanCandidate)
	}

	raw, err := newScanArtifact(
		generationRawResultKey(params.Digest, params.Arch, params.ScanGenerationID),
		params.RawResult,
	)
	if err != nil {
		return scanCandidate{}, err
	}
	details, err := newScanArtifact(
		generationParsedResultsDetailsKey(params.Digest, params.Arch, params.ScanGenerationID),
		params.ParsedResultsDetails,
	)
	if err != nil {
		return scanCandidate{}, err
	}

	return scanCandidate{
		generationID: params.ScanGenerationID,
		digest:       params.Digest,
		arch:         params.Arch,
		raw:          raw,
		details:      details,
	}, nil
}

func ensureScanCandidate(ctx context.Context, candidate *scanCandidate) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now()
	_, err := conn.Exec(ctx, `
		INSERT INTO external_image_scan_generation (
			generation_id, digest, arch, state,
			raw_object_key, raw_size_bytes, raw_sha256,
			details_object_key, details_size_bytes, details_sha256,
			created_at, cleanup_after
		)
		VALUES ($1, $2, $3, 'uploading', $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (generation_id, digest, arch) DO NOTHING
	`, candidate.generationID, candidate.digest, candidate.arch,
		candidate.raw.key, candidate.raw.size, candidate.raw.sha256,
		candidate.details.key, candidate.details.size, candidate.details.sha256,
		now, now.Add(scanCandidateCleanupDelay))
	if err != nil {
		return fmt.Errorf("failed to create scan publication candidate: %w", err)
	}

	var stored scanCandidate
	stored.generationID = candidate.generationID
	stored.digest = candidate.digest
	stored.arch = candidate.arch
	err = conn.QueryRow(ctx, `
		SELECT state,
		       raw_object_key, raw_size_bytes, raw_sha256,
		       details_object_key, details_size_bytes, details_sha256
		FROM external_image_scan_generation
		WHERE generation_id = $1 AND digest = $2 AND arch = $3
	`, candidate.generationID, candidate.digest, candidate.arch).Scan(
		&stored.state,
		&stored.raw.key, &stored.raw.size, &stored.raw.sha256,
		&stored.details.key, &stored.details.size, &stored.details.sha256,
	)
	if err != nil {
		return fmt.Errorf("failed to read scan publication candidate: %w", err)
	}
	if stored.state == "deleting" {
		return fmt.Errorf("%w: generation %s is being deleted", ErrInvalidScanCandidate, candidate.generationID)
	}
	if stored.state == "superseded" {
		return fmt.Errorf("%w: generation %s has already been superseded", ErrStaleScanGeneration, candidate.generationID)
	}
	if stored.raw.key != candidate.raw.key || stored.raw.size != candidate.raw.size || stored.raw.sha256 != candidate.raw.sha256 ||
		stored.details.key != candidate.details.key || stored.details.size != candidate.details.size || stored.details.sha256 != candidate.details.sha256 {
		return fmt.Errorf("%w: generation %s was reused with different object metadata", ErrInvalidScanCandidate, candidate.generationID)
	}
	candidate.state = stored.state
	return nil
}

func validateStoredScanArtifact(ctx context.Context, store scanObjectStore, artifact scanArtifact) error {
	data, err := store.getCompressed(ctx, artifact.key)
	if err != nil {
		return fmt.Errorf("failed to read back %s: %w", artifact.key, err)
	}
	if int64(len(data)) != artifact.size {
		return fmt.Errorf("%w: object %s has size %d, expected %d", ErrInvalidScanCandidate, artifact.key, len(data), artifact.size)
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != artifact.sha256 {
		return fmt.Errorf("%w: object %s checksum does not match", ErrInvalidScanCandidate, artifact.key)
	}
	payload, err := gunzipData(data)
	if err != nil {
		return fmt.Errorf("%w: object %s is not valid gzip: %v", ErrInvalidScanCandidate, artifact.key, err)
	}
	if !json.Valid([]byte(payload)) {
		return fmt.Errorf("%w: object %s does not contain valid JSON", ErrInvalidScanCandidate, artifact.key)
	}
	return nil
}

func markScanCandidateState(ctx context.Context, candidate scanCandidate, state string) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var actualState string
	err := conn.QueryRow(ctx, `
		UPDATE external_image_scan_generation
		SET state = $4,
		    validated_at = CASE WHEN $4 = 'validated' THEN NOW() ELSE validated_at END,
		    cleanup_after = CASE
		        WHEN $4 = 'selected' THEN NULL
		        WHEN $4 = 'validated' THEN NOW() + INTERVAL '24 hours'
		        ELSE COALESCE(cleanup_after, NOW() + INTERVAL '24 hours')
		    END
		WHERE generation_id = $1 AND digest = $2 AND arch = $3
		  AND state IN ('uploading', 'failed')
		RETURNING state
	`, candidate.generationID, candidate.digest, candidate.arch, state).Scan(&actualState)
	if err == nil {
		return actualState, nil
	}
	if err != pgx.ErrNoRows {
		return "", fmt.Errorf("failed to mark scan candidate %s: %w", state, err)
	}

	err = conn.QueryRow(ctx, `
		SELECT state
		FROM external_image_scan_generation
		WHERE generation_id = $1 AND digest = $2 AND arch = $3
	`, candidate.generationID, candidate.digest, candidate.arch).Scan(&actualState)
	if err != nil {
		return "", fmt.Errorf("failed to read scan candidate after rejected %s transition: %w", state, err)
	}
	switch actualState {
	case "validated", "selected":
		return actualState, nil
	case "superseded":
		return actualState, fmt.Errorf("%w: generation %s has already been superseded", ErrStaleScanGeneration, candidate.generationID)
	case "deleting":
		return actualState, fmt.Errorf("%w: generation %s is being deleted", ErrInvalidScanCandidate, candidate.generationID)
	default:
		return actualState, fmt.Errorf("%w: generation %s in state %s cannot transition to %s", ErrInvalidScanCandidate, candidate.generationID, actualState, state)
	}
}

func failScanCandidate(ctx context.Context, candidate *scanCandidate, cause error) error {
	actualState, err := markScanCandidateState(ctx, *candidate, "failed")
	if err != nil {
		return errors.Join(cause, err)
	}
	candidate.state = actualState
	if actualState == "validated" || actualState == "selected" {
		return nil
	}
	return cause
}

func uploadAndValidateScanCandidate(ctx context.Context, candidate *scanCandidate) error {
	switch candidate.state {
	case "validated", "selected":
		return nil
	case "superseded":
		return fmt.Errorf("%w: generation %s has already been superseded", ErrStaleScanGeneration, candidate.generationID)
	case "deleting":
		return fmt.Errorf("%w: generation %s is being deleted", ErrInvalidScanCandidate, candidate.generationID)
	}
	store, err := getScanObjectStore(ctx)
	if err != nil {
		return fmt.Errorf("failed to create blob store: %w", err)
	}
	if err := injectScanPublicationFailure(ctx, ScanPublicationFailureBeforeRawUpload); err != nil {
		return failScanCandidate(ctx, candidate, err)
	}
	if err := store.putCompressed(ctx, candidate.raw.key, candidate.raw.compressed); err != nil {
		return failScanCandidate(ctx, candidate, fmt.Errorf("failed to upload raw_result candidate: %w", err))
	}
	if err := injectScanPublicationFailure(ctx, ScanPublicationFailureBetweenUploads); err != nil {
		return failScanCandidate(ctx, candidate, err)
	}
	if err := store.putCompressed(ctx, candidate.details.key, candidate.details.compressed); err != nil {
		return failScanCandidate(ctx, candidate, fmt.Errorf("failed to upload parsed_results_details candidate: %w", err))
	}
	if err := injectScanPublicationFailure(ctx, ScanPublicationFailureValidation); err != nil {
		return failScanCandidate(ctx, candidate, err)
	}
	if err := validateStoredScanArtifact(ctx, store, candidate.raw); err != nil {
		return failScanCandidate(ctx, candidate, err)
	}
	if err := validateStoredScanArtifact(ctx, store, candidate.details); err != nil {
		return failScanCandidate(ctx, candidate, err)
	}
	actualState, err := markScanCandidateState(ctx, *candidate, "validated")
	if err != nil {
		return err
	}
	candidate.state = actualState
	return nil
}

func selectScanCandidate(ctx context.Context, params SetExternalImageScanStatusParams, candidate scanCandidate, now time.Time) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin scan publication transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var currentGeneration string
	var selectedGeneration sql.NullString
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(current_scan_generation_id, ''), selected_scan_generation_id
		FROM external_image_scan
		WHERE digest = $1 AND arch = $2
		FOR UPDATE
	`, params.Digest, params.Arch).Scan(&currentGeneration, &selectedGeneration)
	if err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("%w: no scan row exists for %s/%s", ErrStaleScanGeneration, params.Digest, params.Arch)
		}
		return fmt.Errorf("failed to lock scan row for publication: %w", err)
	}
	if currentGeneration != params.ScanGenerationID {
		return fmt.Errorf("%w: generation %s is no longer current for %s/%s", ErrStaleScanGeneration, params.ScanGenerationID, params.Digest, params.Arch)
	}

	var candidateState string
	err = tx.QueryRow(ctx, `
		SELECT state
		FROM external_image_scan_generation
		WHERE generation_id = $1 AND digest = $2 AND arch = $3
		FOR UPDATE
	`, candidate.generationID, candidate.digest, candidate.arch).Scan(&candidateState)
	if err != nil {
		return fmt.Errorf("failed to lock scan publication candidate: %w", err)
	}
	if candidateState != "validated" && candidateState != "selected" {
		return fmt.Errorf("%w: generation %s has state %s", ErrInvalidScanCandidate, candidate.generationID, candidateState)
	}
	if selectedGeneration.Valid && selectedGeneration.String == candidate.generationID && candidateState == "selected" {
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("failed to commit idempotent scan generation selection: %w", err)
		}
		return nil
	}

	result, err := tx.Exec(ctx, `
		UPDATE external_image_scan
		SET selected_scan_generation_id = $3,
		    parsed_results = $4,
		    status = 'succeeded',
		    scan_status_message = NULL,
		    updated_at = $5,
		    scan_completed_at = $5,
		    scan_status_updated_at = $5,
		    is_in_object_store = true
		WHERE digest = $1 AND arch = $2
		  AND current_scan_generation_id = $3
	`, params.Digest, params.Arch, params.ScanGenerationID, params.ParsedResults, now)
	if err != nil {
		return fmt.Errorf("failed to select scan generation: %w", err)
	}
	if result.RowsAffected() != 1 {
		return fmt.Errorf("%w: generation %s lost selection race", ErrStaleScanGeneration, params.ScanGenerationID)
	}

	result, err = tx.Exec(ctx, `
		UPDATE external_image_sbom
		SET last_security_scanned_at = $3
		WHERE digest = $1 AND arch = $2
	`, params.Digest, params.Arch, now)
	if err != nil {
		return fmt.Errorf("failed to update successful scan freshness for digest %s, arch %s: %w", params.Digest, params.Arch, err)
	}
	if result.RowsAffected() != 1 {
		return fmt.Errorf("failed to update successful scan freshness for digest %s, arch %s: expected 1 SBOM row, updated %d", params.Digest, params.Arch, result.RowsAffected())
	}

	if selectedGeneration.Valid && selectedGeneration.String != candidate.generationID {
		_, err = tx.Exec(ctx, `
			UPDATE external_image_scan_generation
			SET state = 'superseded', cleanup_after = $4
			WHERE generation_id = $1 AND digest = $2 AND arch = $3
		`, selectedGeneration.String, params.Digest, params.Arch, now.Add(scanCandidateCleanupDelay))
		if err != nil {
			return fmt.Errorf("failed to supersede previous scan generation: %w", err)
		}
	}

	_, err = tx.Exec(ctx, `
		UPDATE external_image_scan_generation
		SET state = 'selected', selected_at = $4, cleanup_after = NULL
		WHERE generation_id = $1 AND digest = $2 AND arch = $3
	`, candidate.generationID, candidate.digest, candidate.arch, now)
	if err != nil {
		return fmt.Errorf("failed to mark scan generation selected: %w", err)
	}
	if err := injectScanPublicationFailure(ctx, ScanPublicationFailureSelection); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit scan generation selection: %w", err)
	}
	return nil
}

func publishSuccessfulScan(ctx context.Context, params SetExternalImageScanStatusParams) error {
	candidate, err := newScanCandidate(params)
	if err != nil {
		return err
	}
	if err := ensureScanCandidate(ctx, &candidate); err != nil {
		return err
	}
	if err := uploadAndValidateScanCandidate(ctx, &candidate); err != nil {
		return err
	}
	return selectScanCandidate(ctx, params, candidate, time.Now())
}
