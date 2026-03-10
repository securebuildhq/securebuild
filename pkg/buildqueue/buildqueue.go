package buildqueue

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

func processBuildQueueItem(ctx context.Context, conn *pgxpool.Conn) (bool, error) {
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
		LIMIT 1
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return false, fmt.Errorf("failed to query rebuild chain links: %w", err)
	}

	var packageName, packageID, linkID, chainName string
	var hasResult bool

	for rows.Next() {
		if err := rows.Scan(&packageName, &packageID, &linkID, &chainName); err != nil {
			rows.Close()
			return false, fmt.Errorf("failed to scan package data: %w", err)
		}
		hasResult = true
		break // Only process the first result since we have LIMIT 1
	}
	rows.Close()

	if hasResult {
		logger.Info("building package for rebuild chain",
			zap.String("chainName", chainName),
			zap.String("packageName", packageName),
			zap.String("packageId", packageID))

		// Increment epoch for the package before building
		newPackageVersion, err := sbpackage.CreateNewReleaseForLatestPackageVersion(ctx, packageID, "", "")
		if err != nil {
			return false, fmt.Errorf("failed to increment epoch for package %s: %w", packageName, err)
		}

		logger.Info("incremented epoch for package",
			zap.String("packageName", packageName),
			zap.String("packageVersionId", newPackageVersion.ID),
			zap.Int("newEpoch", newPackageVersion.APKRelease))

		// Create payload for HandleBuildPackage
		payload := listener.BuildPackagePayload{
			PackageID:        packageID,
			PackageVersionID: newPackageVersion.ID,
			Cause:            fmt.Sprintf("rebuild chain for %s", chainName),
			CauseID:          linkID,
		}

		payloadBytes, err := json.Marshal(payload)
		if err != nil {
			return false, fmt.Errorf("failed to marshal build package payload: %w", err)
		}

		// Call HandleBuildPackage directly to avoid potentially duplicating the execution
		err = listener.HandleBuildPackage(ctx, string(payloadBytes))
		if err != nil {
			return false, fmt.Errorf("failed to handle build package: %w", err)
		}
	}

	return hasResult, nil
}

func StartBuildQueue(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	for {
		hasResult, err := processBuildQueueItem(ctx, conn)
		if err != nil {
			logger.Error(fmt.Errorf("failed to process build queue item: %w", err))
			// Continue processing instead of exiting
			time.Sleep(time.Second * 5)
			continue
		}

		if !hasResult {
			// if we didn't find any packages to build, sleep for 10 seconds
			time.Sleep(time.Second * 10)
		}
	}
}
