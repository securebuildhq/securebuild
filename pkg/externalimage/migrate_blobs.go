package externalimage

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

// MigrateBlobsConfig controls the bulk migration of large text columns
// from PostgreSQL to object storage.
type MigrateBlobsConfig struct {
	BatchSize int           // rows per batch per worker (default: 100)
	Workers   int           // number of parallel workers (default: 5)
	Delay     time.Duration // delay between batches per worker (default: 0)
}

// MigrateBlobsResult summarizes a migration run.
type MigrateBlobsResult struct {
	ScansMigrated int // external_image_scan rows successfully migrated
	SBOMsMigrated int // external_image_sbom rows successfully migrated
}

// MigrateBlobsToStorage copies large text columns from PostgreSQL to the
// S3-compatible object store. Object keys are derived deterministically from
// each row's primary key (digest, arch), so no object key columns are needed
// for the key itself — but an is_in_object_store boolean column tracks which
// rows have been copied, enabling restart-safe parallel migration.
//
// This function is designed to be called by an external CLI tool for a
// one-time bulk migration. It is safe to run multiple times and to run
// multiple instances concurrently:
//
//   - Only rows with is_in_object_store = false are selected.
//   - Workers use SELECT ... FOR UPDATE SKIP LOCKED so concurrent workers
//     never process the same rows.
//   - After uploading, each worker sets is_in_object_store = true in the
//     same transaction, so a crash leaves the row unlocked (rolled back)
//     and it will be retried on the next run.
//
// Context cancellation is respected between batches.
func MigrateBlobsToStorage(ctx context.Context, cfg MigrateBlobsConfig) (*MigrateBlobsResult, error) {
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 100
	}
	if cfg.Workers <= 0 {
		cfg.Workers = 5
	}

	store, err := newBlobStore(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create blob store: %w", err)
	}

	result := &MigrateBlobsResult{}

	// Migrate external_image_scan: raw_result + parsed_results_details
	if err := migrateTableBlobs(ctx, store, cfg, result, "scan"); err != nil {
		return result, fmt.Errorf("scan blob migration failed: %w", err)
	}

	// Migrate external_image_sbom: sbom
	if err := migrateTableBlobs(ctx, store, cfg, result, "sbom"); err != nil {
		return result, fmt.Errorf("sbom blob migration failed: %w", err)
	}

	return result, nil
}

// migrateTableBlobs runs parallel workers to migrate blobs for either the
// scan table or the sbom table. Each worker grabs a batch of rows with
// FOR UPDATE SKIP LOCKED, uploads the blobs, and sets is_in_object_store = true.
func migrateTableBlobs(ctx context.Context, store *blobStore, cfg MigrateBlobsConfig, result *MigrateBlobsResult, table string) error {
	var migrated *int64
	switch table {
	case "scan":
		migrated = new(int64)
		defer func() {
			result.ScansMigrated = int(atomic.LoadInt64(migrated))
		}()
	case "sbom":
		migrated = new(int64)
		defer func() {
			result.SBOMsMigrated = int(atomic.LoadInt64(migrated))
		}()
	}

	var wg sync.WaitGroup
	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	var firstErr error
	var errMu sync.Mutex

	for i := 0; i < cfg.Workers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			if err := migrateWorkerLoop(workerCtx, store, cfg, table, migrated, workerID); err != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = err
					cancel() // stop other workers
				}
				errMu.Unlock()
			}
		}(i)
	}
	wg.Wait()

	return firstErr
}

// migrateWorkerLoop repeatedly grabs and processes batches until no more rows
// are available. Returns an error if a fatal error occurs.
func migrateWorkerLoop(ctx context.Context, store *blobStore, cfg MigrateBlobsConfig, table string, migrated *int64, workerID int) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		hasRows, err := migrateWorkerBatch(ctx, store, cfg, table, migrated, workerID)
		if err != nil {
			return fmt.Errorf("worker %d: batch failed: %w", workerID, err)
		}
		if !hasRows {
			return nil // no more rows
		}

		if cfg.Delay > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(cfg.Delay):
			}
		}
	}
}

// rowInfo tracks a single row's primary key for marking as migrated.
type rowInfo struct {
	digest string
	arch   string
}

// migrateWorkerBatch grabs one batch of rows, uploads blobs, and marks them
// as migrated. Returns true if rows were found (more work may remain), false
// if no rows were selected (table is done). Any error stops the worker —
// the transaction rolls back, rows stay is_in_object_store = false, and the
// migration is idempotent so a re-run will retry them.
func migrateWorkerBatch(ctx context.Context, store *blobStore, cfg MigrateBlobsConfig, table string, migrated *int64, workerID int) (hasRows bool, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("worker %d: panic in batch: %v", workerID, r)
		}
	}()

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	query := buildBatchQuery(table)
	rows, err := tx.Query(ctx, query, cfg.BatchSize)
	if err != nil {
		return false, fmt.Errorf("failed to query batch: %w", err)
	}

	var toMark []rowInfo

	for rows.Next() {
		hasRows = true

		switch table {
		case "scan":
			var digest, arch string
			var rawResult, parsedDetails *string
			if err := rows.Scan(&digest, &arch, &rawResult, &parsedDetails); err != nil {
				return hasRows, fmt.Errorf("worker %d: failed to scan row: %w", workerID, err)
			}

			// Upload raw_result
			if rawResult != nil && *rawResult != "" {
				if err := store.putRawResult(ctx, digest, arch, *rawResult); err != nil {
					return hasRows, fmt.Errorf("worker %d: failed to upload raw_result for %s/%s: %w", workerID, digest, arch, err)
				}
			}

			// Upload parsed_results_details
			if parsedDetails != nil && *parsedDetails != "" {
				if err := store.putParsedResultsDetails(ctx, digest, arch, *parsedDetails); err != nil {
					return hasRows, fmt.Errorf("worker %d: failed to upload parsed_results_details for %s/%s: %w", workerID, digest, arch, err)
				}
			}

			toMark = append(toMark, rowInfo{digest, arch})

		case "sbom":
			var digest, arch, sbom string
			if err := rows.Scan(&digest, &arch, &sbom); err != nil {
				return hasRows, fmt.Errorf("worker %d: failed to scan row: %w", workerID, err)
			}

			if err := store.putSBOM(ctx, digest, arch, sbom); err != nil {
				return hasRows, fmt.Errorf("worker %d: failed to upload sbom for %s/%s: %w", workerID, digest, arch, err)
			}

			toMark = append(toMark, rowInfo{digest, arch})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return hasRows, fmt.Errorf("worker %d: failed while iterating rows: %w", workerID, err)
	}

	if !hasRows {
		return false, nil
	}

	// Mark processed rows as is_in_object_store = true
	if err := markRowsMigrated(ctx, tx, table, toMark); err != nil {
		return hasRows, fmt.Errorf("failed to mark rows as migrated: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return hasRows, fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Only count migrated rows after successful commit
	atomic.AddInt64(migrated, int64(len(toMark)))

	logger.Infof("%s migration: worker %d completed batch (migrated=%d, total_migrated=%d)",
		table, workerID, len(toMark), atomic.LoadInt64(migrated))

	return hasRows, nil
}

// buildBatchQuery constructs the SELECT ... FOR UPDATE SKIP LOCKED query for
// the given table. Only rows with is_in_object_store = false are selected,
// ensuring restart-safe progress tracking.
func buildBatchQuery(table string) string {
	switch table {
	case "scan":
		return `
			SELECT digest, arch, raw_result, parsed_results_details
			FROM external_image_scan
			WHERE is_in_object_store = false
			  AND (raw_result IS NOT NULL OR parsed_results_details IS NOT NULL)
			ORDER BY random()
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		`
	case "sbom":
		return `
			SELECT digest, arch, sbom
			FROM external_image_sbom
			WHERE is_in_object_store = false
			  AND sbom IS NOT NULL
			ORDER BY random()
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		`
	default:
		return ""
	}
}

// markRowsMigrated sets is_in_object_store = true for the given rows in the
// same transaction that locked them.
func markRowsMigrated(ctx context.Context, tx pgx.Tx, table string, rows []rowInfo) error {
	for _, r := range rows {
		var query string
		switch table {
		case "scan":
			query = "UPDATE external_image_scan SET is_in_object_store = true WHERE digest = $1 AND arch = $2"
		case "sbom":
			query = "UPDATE external_image_sbom SET is_in_object_store = true WHERE digest = $1 AND arch = $2"
		}
		if _, err := tx.Exec(ctx, query, r.digest, r.arch); err != nil {
			return fmt.Errorf("failed to mark %s/%s as migrated in %s: %w", r.digest, r.arch, table, err)
		}
	}
	return nil
}
