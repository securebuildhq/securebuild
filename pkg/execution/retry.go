package execution

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/execution/types"
	sbpackagetypes "github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

// CreateRetryExecution atomically claims a retry of a particular failed attempt.
// A nil result means that retry is no longer eligible. In particular, a queue
// redelivery must not create another execution after this retry has run.
func CreateRetryExecution(ctx context.Context, packageID string, pkgVersion *sbpackagetypes.PackageVersion, cause, causeID, failedExecutionID string) (*types.Execution, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var lockedID string
	if err := tx.QueryRow(ctx, `SELECT id FROM package_version WHERE id = $1 FOR UPDATE`, pkgVersion.ID).Scan(&lockedID); err != nil {
		return nil, err
	}
	var blocked bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM execution WHERE package_version_id = $1
		  AND (status IS NULL OR status NOT IN ('failed', 'vm_deleted')))
	`, pkgVersion.ID).Scan(&blocked); err != nil {
		return nil, err
	}
	if blocked {
		return nil, nil
	}

	var latestID string
	err = tx.QueryRow(ctx, `SELECT id FROM execution WHERE package_version_id = $1 ORDER BY created_at DESC LIMIT 1`, pkgVersion.ID).Scan(&latestID)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if latestID != failedExecutionID {
		return nil, nil
	}

	exe, err := createExecution(ctx, tx, packageID, pkgVersion, cause, causeID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return exe, nil
}
