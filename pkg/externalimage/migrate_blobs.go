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
	BatchSize    int           // rows per batch per worker (default: 100)
	Workers      int           // number of parallel workers (default: 5)
	DryRun       bool          // if true, log what would be done but don't upload
	SkipExisting bool          // if true, only select rows where is_in_object_store = false (default: true)
	Delay        time.Duration // delay between batches per worker (default: 0)
}

// MigrateBlobsResult summarizes a migration run.
type MigrateBlobsResult struct {
	ScansMigrated int // external_image_scan rows processed
	ScansSkipped  int // external_image_scan rows skipped (already in object store)
	ScansFailed   int // external_image_scan rows that failed
	SBOMsMigrated int // external_image_sbom rows processed
	SBOMsSkipped  int // external_image_sbom rows skipped (already in object store)
	SBOMsFailed   int // external_image_sbom rows that failed
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
//   - When SkipExisting is true (default), only rows with
//     is_in_object_store = false are selected.
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
	var migrated, skipped, failed *int64
	switch table {
	case "scan":
		migrated = new(int64)
		skipped = new(int64)
		failed = new(int64)
		defer func() {
			result.ScansMigrated = int(atomic.LoadInt64(migrated))
			result.ScansSkipped = int(atomic.LoadInt64(skipped))
			result.ScansFailed = int(atomic.LoadInt64(failed))
		}()
	case "sbom":
		migrated = new(int64)
		skipped = new(int64)
		failed = new(int64)
		defer func() {
			result.SBOMsMigrated = int(atomic.LoadInt64(migrated))
			result.SBOMsSkipped = int(atomic.LoadInt64(skipped))
			result.SBOMsFailed = int(atomic.LoadInt64(failed))
		}()
	}

	var wg sync.WaitGroup
	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	for i := 0; i < cfg.Workers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			migrateWorkerLoop(workerCtx, store, cfg, table, migrated, skipped, failed, workerID)
		}(i)
	}
	wg.Wait()

	return nil
}

// migrateWorkerLoop repeatedly grabs and processes batches until no more rows
// are available.
func migrateWorkerLoop(ctx context.Context, store *blobStore, cfg MigrateBlobsConfig, table string, migrated, skipped, failed *int64, workerID int) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		processed, err := migrateWorkerBatch(ctx, store, cfg, table, migrated, skipped, failed, workerID)
		if err != nil {
			logger.Errorf("worker %d: batch failed: %v", workerID, err)
			// Continue to next batch — other workers may still make progress
		}
		if processed == 0 {
			return // no more rows
		}

		if cfg.Delay > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(cfg.Delay):
			}
		}
	}
}

// migrateWorkerBatch grabs one batch of rows, uploads blobs, and marks them
// as migrated. Returns the number of rows processed (0 means no more rows).
// rowInfo tracks a single row's primary key for marking as migrated.
type rowInfo struct {
	digest string
	arch   string
}

// migrateWorkerBatch grabs one batch of rows, uploads blobs, and marks them
// as migrated. Returns the number of rows processed (0 means no more rows).
func migrateWorkerBatch(ctx context.Context, store *blobStore, cfg MigrateBlobsConfig, table string, migrated, skipped, failed *int64, workerID int) (int, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	query := buildBatchQuery(table, cfg)
	rows, err := tx.Query(ctx, query, cfg.BatchSize)
	if err != nil {
		return 0, fmt.Errorf("failed to query batch: %w", err)
	}

	var toMark []rowInfo
	batchCount := 0

	for rows.Next() {
		batchCount++

		switch table {
		case "scan":
			var digest, arch string
			var rawResult, parsedDetails *string
			if err := rows.Scan(&digest, &arch, &rawResult, &parsedDetails); err != nil {
				atomic.AddInt64(failed, 1)
				logger.Errorf("worker %d: failed to scan row: %v", workerID, err)
				continue
			}

			allOK := true

			// Upload raw_result
			if rawResult != nil && *rawResult != "" {
				if cfg.DryRun {
					logger.Infof("[dry-run] worker %d: would upload raw_result for %s/%s (%d bytes)", workerID, digest, arch, len(*rawResult))
				} else {
					if err := store.putRawResult(ctx, digest, arch, *rawResult); err != nil {
						atomic.AddInt64(failed, 1)
						logger.Errorf("worker %d: failed to upload raw_result for %s/%s: %v", workerID, digest, arch, err)
						allOK = false
					} else {
						atomic.AddInt64(migrated, 1)
					}
				}
			}

			// Upload parsed_results_details
			if allOK && parsedDetails != nil && *parsedDetails != "" {
				if cfg.DryRun {
					logger.Infof("[dry-run] worker %d: would upload parsed_results_details for %s/%s (%d bytes)", workerID, digest, arch, len(*parsedDetails))
				} else {
					if err := store.putParsedResultsDetails(ctx, digest, arch, *parsedDetails); err != nil {
						atomic.AddInt64(failed, 1)
						logger.Errorf("worker %d: failed to upload parsed_results_details for %s/%s: %v", workerID, digest, arch, err)
						allOK = false
					}
				}
			}

			if cfg.DryRun {
				atomic.AddInt64(migrated, 1)
				allOK = true
			}

			if allOK {
				toMark = append(toMark, rowInfo{digest, arch})
			}

		case "sbom":
			var digest, arch, sbom string
			if err := rows.Scan(&digest, &arch, &sbom); err != nil {
				atomic.AddInt64(failed, 1)
				logger.Errorf("worker %d: failed to scan row: %v", workerID, err)
				continue
			}

			if cfg.DryRun {
				logger.Infof("[dry-run] worker %d: would upload sbom for %s/%s (%d bytes)", workerID, digest, arch, len(sbom))
				atomic.AddInt64(migrated, 1)
				toMark = append(toMark, rowInfo{digest, arch})
			} else {
				if err := store.putSBOM(ctx, digest, arch, sbom); err != nil {
					atomic.AddInt64(failed, 1)
					logger.Errorf("worker %d: failed to upload sbom for %s/%s: %v", workerID, digest, arch, err)
				} else {
					atomic.AddInt64(migrated, 1)
					toMark = append(toMark, rowInfo{digest, arch})
				}
			}
		}
	}
	rows.Close()

	if batchCount == 0 {
		return 0, nil
	}

	// Mark processed rows as is_in_object_store = true (unless dry run)
	if !cfg.DryRun && len(toMark) > 0 {
		if err := markRowsMigrated(ctx, tx, table, toMark); err != nil {
			return batchCount, fmt.Errorf("failed to mark rows as migrated: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return batchCount, fmt.Errorf("failed to commit transaction: %w", err)
	}

	logger.Infof("%s migration: worker %d completed batch (migrated=%d, skipped=%d, failed=%d, total_migrated=%d)",
		table, workerID, len(toMark), 0, batchCount-len(toMark), atomic.LoadInt64(migrated))

	return batchCount, nil
}

// buildBatchQuery constructs the SELECT ... FOR UPDATE SKIP LOCKED query for
// the given table. Only rows with is_in_object_store = false are selected
// (when SkipExisting is true), ensuring restart-safe progress tracking.
func buildBatchQuery(table string, cfg MigrateBlobsConfig) string {
	whereClause := ""
	if cfg.SkipExisting {
		whereClause = "WHERE is_in_object_store = false AND "
	} else {
		whereClause = "WHERE "
	}

	switch table {
	case "scan":
		return fmt.Sprintf(`
			SELECT digest, arch, raw_result, parsed_results_details
			FROM external_image_scan
			%s(raw_result IS NOT NULL OR parsed_results_details IS NOT NULL)
			ORDER BY random()
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		`, whereClause)
	case "sbom":
		return fmt.Sprintf(`
			SELECT digest, arch, sbom
			FROM external_image_sbom
			%ssbom IS NOT NULL
			ORDER BY random()
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		`, whereClause)
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
