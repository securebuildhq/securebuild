package listener

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/securebuildhq/securebuild/pkg/buildpriority"
)

// pendingBuildOrder ranks the entire eligible backlog before the claim limit is
// applied. Ranking only a FIFO batch would leave newer builds behind old batches.
// The subsequent atomic claim rechecks eligibility and skips concurrently locked
// jobs. New arrivals are considered on the next pass.
func pendingBuildOrder(ctx context.Context, conn *pgxpool.Conn, processor *queueProcessor) ([]string, error) {
	var metadata, joins string
	switch processor.channel {
	case "build_package":
		metadata = "family_metadata.family, version_metadata.versions"
		joins = buildpriority.PackageMetadataJoin
	case "build_apko":
		metadata = "COALESCE(ia.image_id, ''), ia.tags"
		joins = buildpriority.ImageMetadataJoin
	default:
		return nil, nil
	}
	rows, err := conn.Query(ctx, `
		WITH candidate AS (
			SELECT id, COALESCE(priority, 0) AS priority, created_at,
				payload->>'packageId' AS package_id,
				NULLIF(payload->>'packageVersionId', '') AS package_version_id,
				payload->>'apkoId' AS apko_id
			FROM work_queue
			WHERE channel = $1 AND completed_at IS NULL
			AND COALESCE(next_attempt_at, created_at) <= NOW()
			AND (processing_started_at IS NULL OR processing_started_at < NOW() - $2::interval)
		)
		SELECT candidate.id, candidate.priority, candidate.created_at, `+metadata+`
		FROM candidate `+joins, processor.channel, processor.maxDuration.String())
	if err != nil {
		return nil, fmt.Errorf("query pending build priorities: %w", err)
	}
	defer rows.Close()
	var candidates []buildpriority.Candidate
	for rows.Next() {
		var c buildpriority.Candidate
		if err := rows.Scan(&c.ID, &c.Priority, &c.CreatedAt, &c.Family, &c.Versions); err != nil {
			return nil, fmt.Errorf("scan pending build priority: %w", err)
		}
		candidates = append(candidates, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return buildpriority.Order(candidates), nil
}
