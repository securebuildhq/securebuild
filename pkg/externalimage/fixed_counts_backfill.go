package externalimage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

const defaultFixedCountsBackfillBatchSize = 100

// FixedCountsBackfillOptions controls the one-time compact-summary backfill.
type FixedCountsBackfillOptions struct {
	DryRun    bool
	BatchSize int
}

// FixedCountsBackfillResult reports what the backfill inspected and changed.
type FixedCountsBackfillResult struct {
	Candidates        int
	WouldUpdate       int
	Updated           int
	SkippedConcurrent int
	Failed            int
}

type fixedCountsBackfillCandidate struct {
	Digest          string
	Arch            string
	ParsedResults   string
	ScanCompletedAt *time.Time
}

type fixedCountsBackfillDB interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

type fixedCountsCandidateLister func(context.Context, string, string, int) ([]fixedCountsBackfillCandidate, error)
type fixedCountsDetailsLoader func(context.Context, string, string) (string, error)
type fixedCountsSummaryUpdater func(context.Context, fixedCountsBackfillCandidate, string) (bool, error)

// BackfillExternalImageFixedCounts fills fixed_counts in the compact
// external_image_scan.parsed_results value using the detailed result that is
// already stored in object storage. It is safe to rerun: completed rows are not
// selected, and the conditional update will not overwrite a concurrently
// completed scan.
func BackfillExternalImageFixedCounts(ctx context.Context, options FixedCountsBackfillOptions) (FixedCountsBackfillResult, error) {
	if options.BatchSize == 0 {
		options.BatchSize = defaultFixedCountsBackfillBatchSize
	}
	if options.BatchSize < 1 || options.BatchSize > 1000 {
		return FixedCountsBackfillResult{}, fmt.Errorf("batch size must be between 1 and 1000")
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	store, err := newBlobStore(ctx)
	if err != nil {
		return FixedCountsBackfillResult{}, fmt.Errorf("create external image blob store: %w", err)
	}

	return runFixedCountsBackfill(
		ctx,
		options,
		func(ctx context.Context, afterDigest, afterArch string, limit int) ([]fixedCountsBackfillCandidate, error) {
			return listFixedCountsBackfillCandidates(ctx, conn, afterDigest, afterArch, limit)
		},
		store.getParsedResultsDetails,
		func(ctx context.Context, candidate fixedCountsBackfillCandidate, summary string) (bool, error) {
			return updateFixedCountsSummary(ctx, conn, candidate, summary)
		},
	)
}

func runFixedCountsBackfill(
	ctx context.Context,
	options FixedCountsBackfillOptions,
	listCandidates fixedCountsCandidateLister,
	loadDetails fixedCountsDetailsLoader,
	updateSummary fixedCountsSummaryUpdater,
) (FixedCountsBackfillResult, error) {
	var result FixedCountsBackfillResult
	var firstFailure error
	var afterDigest, afterArch string

	for {
		candidates, err := listCandidates(ctx, afterDigest, afterArch, options.BatchSize)
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return result, ctxErr
			}
			return result, fmt.Errorf("list fixed-count backfill candidates: %w", err)
		}
		if len(candidates) == 0 {
			break
		}

		for _, candidate := range candidates {
			result.Candidates++
			detailsJSON, err := loadDetails(ctx, candidate.Digest, candidate.Arch)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return result, ctxErr
				}
				result.Failed++
				if firstFailure == nil {
					firstFailure = fmt.Errorf("load details for %s/%s: %w", candidate.Digest, candidate.Arch, err)
				}
				continue
			}

			var details struct {
				Counts      imagetypes.ImageScanResult  `json:"counts"`
				FixedCounts *imagetypes.ImageScanResult `json:"fixed_counts"`
			}
			if err := json.Unmarshal([]byte(detailsJSON), &details); err != nil {
				result.Failed++
				if firstFailure == nil {
					firstFailure = fmt.Errorf("decode details for %s/%s: %w", candidate.Digest, candidate.Arch, err)
				}
				continue
			}
			if details.FixedCounts == nil {
				result.Failed++
				if firstFailure == nil {
					firstFailure = fmt.Errorf("details for %s/%s do not contain fixed_counts", candidate.Digest, candidate.Arch)
				}
				continue
			}

			summaryJSON, err := json.Marshal(imagetypes.ImageScanResultSummary{
				Counts:      details.Counts,
				FixedCounts: *details.FixedCounts,
			})
			if err != nil {
				result.Failed++
				if firstFailure == nil {
					firstFailure = fmt.Errorf("encode summary for %s/%s: %w", candidate.Digest, candidate.Arch, err)
				}
				continue
			}

			if options.DryRun {
				result.WouldUpdate++
				continue
			}

			updated, err := updateSummary(ctx, candidate, string(summaryJSON))
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return result, ctxErr
				}
				result.Failed++
				if firstFailure == nil {
					firstFailure = fmt.Errorf("update summary for %s/%s: %w", candidate.Digest, candidate.Arch, err)
				}
				continue
			}
			if updated {
				result.Updated++
			} else {
				result.SkippedConcurrent++
			}
		}

		last := candidates[len(candidates)-1]
		afterDigest, afterArch = last.Digest, last.Arch
	}

	if result.Failed > 0 {
		return result, fmt.Errorf("fixed-count backfill failed for %d row(s); first failure: %w", result.Failed, firstFailure)
	}
	if result.SkippedConcurrent > 0 {
		return result, fmt.Errorf("fixed-count backfill skipped %d concurrently changed row(s); rerun to verify completion", result.SkippedConcurrent)
	}
	return result, nil
}

func listFixedCountsBackfillCandidates(
	ctx context.Context,
	db fixedCountsBackfillDB,
	afterDigest, afterArch string,
	limit int,
) ([]fixedCountsBackfillCandidate, error) {
	rows, err := db.Query(ctx, `
		SELECT digest, arch, parsed_results, scan_completed_at
		FROM external_image_scan
		WHERE is_in_object_store = true
		  AND NULLIF(BTRIM(parsed_results), '') IS NOT NULL
		  AND POSITION('"fixed_counts"' IN parsed_results) = 0
		  AND (digest, arch) > ($1, $2)
		ORDER BY digest, arch
		LIMIT $3
	`, afterDigest, afterArch, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var candidates []fixedCountsBackfillCandidate
	for rows.Next() {
		var candidate fixedCountsBackfillCandidate
		if err := rows.Scan(&candidate.Digest, &candidate.Arch, &candidate.ParsedResults, &candidate.ScanCompletedAt); err != nil {
			return nil, err
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return candidates, nil
}

func updateFixedCountsSummary(
	ctx context.Context,
	db fixedCountsBackfillDB,
	candidate fixedCountsBackfillCandidate,
	summary string,
) (bool, error) {
	result, err := db.Exec(ctx, `
		UPDATE external_image_scan
		SET parsed_results = $1
		WHERE digest = $2
		  AND arch = $3
		  AND parsed_results IS NOT DISTINCT FROM $4
		  AND scan_completed_at IS NOT DISTINCT FROM $5
	`, summary, candidate.Digest, candidate.Arch, candidate.ParsedResults, candidate.ScanCompletedAt)
	if err != nil {
		return false, err
	}
	return result.RowsAffected() == 1, nil
}
