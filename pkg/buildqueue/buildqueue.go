package buildqueue

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/execution"
	executiontypes "github.com/securebuildhq/securebuild/pkg/execution/types"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// ProcessRebuildChains processes all ready rebuild chain links in one pass.
// It returns only an error (e.g. query failure); per-link failures are logged and processing continues.
func ProcessRebuildChains(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Optimized: use NOT EXISTS for "no execution" (avoids large join) and a single
	// CTE for latest execution per cause_id. EXPLAIN ANALYZE showed the previous
	// inline ROW_NUMBER() subquery was executed ~14k times (once per candidate link),
	// each doing a full execution scan+sort — moving it to a CTE runs it once.
	// Index execution_cause_id_created_at_idx makes the CTE efficient.
	query := `
		WITH latest_execution AS (
			SELECT DISTINCT ON (cause_id) cause_id, status
			FROM execution
			ORDER BY cause_id, created_at DESC
		)
		SELECT p.name, p.id, rcl.link_id, rc.chain_name, rc.package_version_id, rc.package_id
		FROM rebuild_chain_link rcl
		JOIN package p ON rcl.package_id = p.id
		JOIN rebuild_chain rc ON rcl.rebuild_chain_id = rc.id
		WHERE NOT EXISTS (SELECT 1 FROM execution e WHERE e.cause_id = rcl.link_id)
		AND NOT EXISTS (
			SELECT 1
			FROM rebuild_chain_dependency rcd
			JOIN rebuild_chain_link dep_rcl ON rcd.dependency_id = dep_rcl.link_id
			LEFT JOIN latest_execution le ON dep_rcl.link_id = le.cause_id
			WHERE rcd.link_id = rcl.link_id
			AND (le.status IS NULL OR le.status != 'success')
		)
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to query rebuild chain links: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var packageName, packageID, linkID, chainName string
		var chainPackageVersionID sql.NullString
		var chainPackageID string
		if err := rows.Scan(&packageName, &packageID, &linkID, &chainName, &chainPackageVersionID, &chainPackageID); err != nil {
			return fmt.Errorf("failed to scan package data: %w", err)
		}

		logger.Info("building package for rebuild chain",
			zap.String("chainName", chainName),
			zap.String("packageName", packageName),
			zap.String("packageId", packageID))

		var pkgVersionID string

		// If the chain has a package_version_id and this link is for the root package,
		// use that version instead of creating a new release.
		if chainPackageVersionID.Valid && chainPackageID == packageID {
			pkgVersionID = chainPackageVersionID.String
			logger.Info("using existing package version from rebuild chain",
				zap.String("packageName", packageName),
				zap.String("packageVersionId", pkgVersionID))
		}

		if pkgVersionID == "" {
			// No pre-specified version — create a new release
			newPackageVersion, err := sbpackage.CreateNewReleaseForLatestPackageVersion(ctx, packageID, "", "")
			if err != nil {
				if recordErr := recordFailedExecutionForLink(ctx, packageID, linkID, chainName); recordErr != nil {
					logger.Error(fmt.Errorf("failed to record failed execution for link; queue may retry same package: %w", recordErr),
						zap.String("linkId", linkID),
						zap.String("packageName", packageName))
				} else {
					logger.Warn("increment epoch failed for rebuild chain link; recorded failed execution so queue can progress",
						zap.String("chainName", chainName),
						zap.String("packageName", packageName),
						zap.String("linkId", linkID),
						zap.Error(err))
				}
				continue
			}
			pkgVersionID = newPackageVersion.ID
			logger.Info("incremented epoch for package",
				zap.String("packageName", packageName),
				zap.String("packageVersionId", pkgVersionID),
				zap.Int("newEpoch", newPackageVersion.APKRelease))
		}

		payload := listener.BuildPackagePayload{
			PackageID:        packageID,
			PackageVersionID: pkgVersionID,
			Cause:            fmt.Sprintf("rebuild chain for %s", chainName),
			CauseID:          linkID,
		}

		payloadBytes, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("failed to marshal build package payload: %w", err)
		}

		err = listener.HandleBuildPackage(ctx, string(payloadBytes))
		if err != nil {
			logger.Error(fmt.Errorf("failed to handle build package: %w", err),
				zap.String("chainName", chainName),
				zap.String("packageName", packageName),
				zap.String("linkId", linkID))

			// If the error is not retryable (e.g. the package version was deleted),
			// record a failed execution so the queue won't keep retrying this link.
			// For other errors, allow the queue to retry on the next cycle.
			if errors.Is(err, listener.ErrNotRetryable) {
				if recordErr := recordFailedExecutionForLink(ctx, packageID, linkID, chainName); recordErr != nil {
					logger.Error(fmt.Errorf("failed to record failed execution for link; queue may retry same package: %w", recordErr),
						zap.String("linkId", linkID),
						zap.String("packageName", packageName))
				}
			}
			continue
		}
	}

	return nil
}

// recordFailedExecutionForLink creates an execution record with status failed for the given
// rebuild chain link. This ensures the queue query (which only returns links with no execution)
// will not keep returning this link, so other packages in the chain can progress.
func recordFailedExecutionForLink(ctx context.Context, packageID, linkID, chainName string) error {
	pkgVersion, err := sbpackage.GetLatestPackageVersion(ctx, packageID)
	if err != nil {
		return fmt.Errorf("get latest package version: %w", err)
	}
	cause := fmt.Sprintf("rebuild chain for %s", chainName)
	exe, err := execution.CreateExecution(ctx, packageID, pkgVersion, cause, linkID)
	if err != nil {
		return fmt.Errorf("create execution: %w", err)
	}
	if err := execution.UpdateExecutionStatus(ctx, exe.ID, executiontypes.ExecutionStatusFailed); err != nil {
		return fmt.Errorf("update execution status to failed: %w", err)
	}
	return nil
}

func StartBuildQueue(ctx context.Context) error {
	for {
		if err := ProcessRebuildChains(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to process build queue: %w", err))
		}
		time.Sleep(time.Second * 10)
	}
}
