package buildqueue

import (
	"context"
	"encoding/json"
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

	query := `
		SELECT p.name, p.id, rcl.link_id, rc.chain_name
		FROM rebuild_chain_link rcl
		JOIN package p ON rcl.package_id = p.id
		JOIN rebuild_chain rc ON rcl.rebuild_chain_id = rc.id
		LEFT JOIN execution e ON rcl.link_id = e.cause_id
		WHERE e.status IS NULL
		AND NOT EXISTS (
			SELECT 1
			FROM rebuild_chain_dependency rcd
			JOIN rebuild_chain_link dep_rcl ON rcd.dependency_id = dep_rcl.link_id
			LEFT JOIN (
				SELECT cause_id, status,
					   ROW_NUMBER() OVER (PARTITION BY cause_id ORDER BY created_at DESC) as rn
				FROM execution
			) latest_dep_e ON dep_rcl.link_id = latest_dep_e.cause_id AND latest_dep_e.rn = 1
			WHERE rcd.link_id = rcl.link_id
			AND (latest_dep_e.status IS NULL OR latest_dep_e.status != 'success')
		)
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to query rebuild chain links: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var packageName, packageID, linkID, chainName string
		if err := rows.Scan(&packageName, &packageID, &linkID, &chainName); err != nil {
			return fmt.Errorf("failed to scan package data: %w", err)
		}

		logger.Info("building package for rebuild chain",
			zap.String("chainName", chainName),
			zap.String("packageName", packageName),
			zap.String("packageId", packageID))

		newPackageVersion, err := sbpackage.CreateNewReleaseForLatestPackageVersion(ctx, packageID, "", "")
		if err != nil {
			// Record a failed execution for this link so the queue won't keep returning it.
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

		logger.Info("incremented epoch for package",
			zap.String("packageName", packageName),
			zap.String("packageVersionId", newPackageVersion.ID),
			zap.Int("newEpoch", newPackageVersion.APKRelease))

		payload := listener.BuildPackagePayload{
			PackageID:        packageID,
			PackageVersionID: newPackageVersion.ID,
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
