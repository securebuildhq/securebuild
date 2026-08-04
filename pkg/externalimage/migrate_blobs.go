package externalimage

import (
	"context"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

// MigrateBlobsConfig controls the bulk migration of large text columns
// from PostgreSQL to object storage.
type MigrateBlobsConfig struct {
	BatchSize    int           // rows per batch (default: 100)
	DryRun       bool          // if true, log what would be done but don't upload
	SkipExisting bool          // if true, skip objects that already exist in S3 (HEAD check)
	Delay        time.Duration // delay between batches (default: 0)
}

// MigrateBlobsResult summarizes a migration run.
type MigrateBlobsResult struct {
	ScansMigrated int // external_image_scan rows processed
	ScansSkipped  int // external_image_scan rows skipped (already in S3)
	ScansFailed   int // external_image_scan rows that failed
	SBOMsMigrated int // external_image_sbom rows processed
	SBOMsSkipped  int // external_image_sbom rows skipped (already in S3)
	SBOMsFailed   int // external_image_sbom rows that failed
}

// MigrateBlobsToStorage copies large text columns from PostgreSQL to the
// S3-compatible object store. Object keys are derived deterministically from
// each row's primary key (digest, arch), so no object key columns are needed
// in the database and no DB writes are performed during migration.
//
// This function is designed to be called by an external CLI tool for a
// one-time bulk migration. It is safe to run multiple times (idempotent):
// when SkipExisting is true, a HEAD request checks if the object already
// exists before uploading.
//
// The function processes rows in batches using server-side cursors to avoid
// loading the entire ~1.25 TB into memory. Context cancellation is respected
// between batches.
func MigrateBlobsToStorage(ctx context.Context, cfg MigrateBlobsConfig) (*MigrateBlobsResult, error) {
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 100
	}

	result := &MigrateBlobsResult{}

	store, err := newBlobStore(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create blob store: %w", err)
	}

	// Migrate external_image_scan: raw_result + parsed_results_details
	if err := migrateScanBlobs(ctx, store, cfg, result); err != nil {
		return result, fmt.Errorf("scan blob migration failed: %w", err)
	}

	// Migrate external_image_sbom: sbom
	if err := migrateSBOMBlobs(ctx, store, cfg, result); err != nil {
		return result, fmt.Errorf("sbom blob migration failed: %w", err)
	}

	return result, nil
}

// objectExists checks if an object already exists in the object store.
// Returns true if the object exists, false if it doesn't, or on error
// (treat errors as "doesn't exist" to allow re-upload).
func (s *blobStore) objectExists(ctx context.Context, key string) bool {
	_, err := s.client.GetObject(ctx, key)
	return err == nil
}

func migrateScanBlobs(ctx context.Context, store *blobStore, cfg MigrateBlobsConfig, result *MigrateBlobsResult) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Server-side cursors require an explicit transaction block.
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Use a server-side cursor for memory-efficient iteration over ~410K rows
	// with potentially 1 MB+ payloads each.
	if _, err := tx.Exec(ctx, `
		DECLARE scan_cursor CURSOR FOR
		SELECT digest, arch, raw_result, parsed_results_details
		FROM external_image_scan
		WHERE raw_result IS NOT NULL OR parsed_results_details IS NOT NULL
	`); err != nil {
		return fmt.Errorf("failed to declare cursor: %w", err)
	}

	batchNum := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		rows, err := tx.Query(ctx, fmt.Sprintf("FETCH %d FROM scan_cursor", cfg.BatchSize))
		if err != nil {
			return fmt.Errorf("failed to fetch batch: %w", err)
		}

		batchCount := 0
		for rows.Next() {
			batchCount++
			var digest, arch string
			var rawResult, parsedDetails *string
			if err := rows.Scan(&digest, &arch, &rawResult, &parsedDetails); err != nil {
				result.ScansFailed++
				logger.Errorf("failed to scan row: %v", err)
				continue
			}

			// Upload raw_result
			if rawResult != nil && *rawResult != "" {
				rawKey := rawResultKey(digest, arch)

				if cfg.SkipExisting && store.objectExists(ctx, rawKey) {
					result.ScansSkipped++
				} else if cfg.DryRun {
					logger.Infof("[dry-run] would upload raw_result for %s/%s (%d bytes)", digest, arch, len(*rawResult))
				} else {
					if err := store.putRawResult(ctx, digest, arch, *rawResult); err != nil {
						result.ScansFailed++
						logger.Errorf("failed to upload raw_result for %s/%s: %v", digest, arch, err)
					} else {
						result.ScansMigrated++
					}
				}
			}

			// Upload parsed_results_details
			if parsedDetails != nil && *parsedDetails != "" {
				detailsKey := parsedResultsDetailsKey(digest, arch)

				if cfg.SkipExisting && store.objectExists(ctx, detailsKey) {
					// Already counted as skipped or migrated above; don't double-count
				} else if cfg.DryRun {
					logger.Infof("[dry-run] would upload parsed_results_details for %s/%s (%d bytes)", digest, arch, len(*parsedDetails))
				} else {
					if err := store.putParsedResultsDetails(ctx, digest, arch, *parsedDetails); err != nil {
						result.ScansFailed++
						logger.Errorf("failed to upload parsed_results_details for %s/%s: %v", digest, arch, err)
					}
				}
			}
		}
		rows.Close()

		if batchCount == 0 {
			break // no more rows
		}

		batchNum++
		logger.Infof("scan migration: completed batch %d (migrated=%d, skipped=%d, failed=%d)",
			batchNum, result.ScansMigrated, result.ScansSkipped, result.ScansFailed)

		if cfg.Delay > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(cfg.Delay):
			}
		}
	}

	// Commit closes the cursor and ends the transaction.
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

func migrateSBOMBlobs(ctx context.Context, store *blobStore, cfg MigrateBlobsConfig, result *MigrateBlobsResult) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Server-side cursors require an explicit transaction block.
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		DECLARE sbom_cursor CURSOR FOR
		SELECT digest, arch, sbom
		FROM external_image_sbom
		WHERE sbom IS NOT NULL
	`); err != nil {
		return fmt.Errorf("failed to declare cursor: %w", err)
	}

	batchNum := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		rows, err := tx.Query(ctx, fmt.Sprintf("FETCH %d FROM sbom_cursor", cfg.BatchSize))
		if err != nil {
			return fmt.Errorf("failed to fetch batch: %w", err)
		}

		batchCount := 0
		for rows.Next() {
			batchCount++
			var digest, arch, sbom string
			if err := rows.Scan(&digest, &arch, &sbom); err != nil {
				result.SBOMsFailed++
				logger.Errorf("failed to scan row: %v", err)
				continue
			}

			key := sbomKey(digest, arch)

			if cfg.SkipExisting && store.objectExists(ctx, key) {
				result.SBOMsSkipped++
			} else if cfg.DryRun {
				logger.Infof("[dry-run] would upload sbom for %s/%s (%d bytes)", digest, arch, len(sbom))
			} else {
				if err := store.putSBOM(ctx, digest, arch, sbom); err != nil {
					result.SBOMsFailed++
					logger.Errorf("failed to upload sbom for %s/%s: %v", digest, arch, err)
				} else {
					result.SBOMsMigrated++
				}
			}
		}
		rows.Close()

		if batchCount == 0 {
			break
		}

		batchNum++
		logger.Infof("sbom migration: completed batch %d (migrated=%d, skipped=%d, failed=%d)",
			batchNum, result.SBOMsMigrated, result.SBOMsSkipped, result.SBOMsFailed)

		if cfg.Delay > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(cfg.Delay):
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}
