package listener

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	executiontypes "github.com/securebuildhq/securebuild/pkg/execution/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
)

// retryFailedPackageBuild preserves the revision and failed execution, and lets
// the normal build handler create a new execution using the stored build inputs.
func retryFailedPackageBuild(ctx context.Context, versionID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Serialize retry requests for this revision so repeated requests cannot
	// enqueue duplicate attempts while the build handler is waiting to start.
	var packageID string
	if err := tx.QueryRow(ctx, `SELECT package_id FROM package_version WHERE id = $1 FOR UPDATE`, versionID).Scan(&packageID); err != nil {
		return err
	}
	// A success makes this revision immutable. An active execution also blocks
	// retries, even if a newer execution happens to have failed.
	var blocked bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM execution WHERE package_version_id = $1
		  AND (status IS NULL OR status NOT IN ('failed', 'vm_deleted')))
	`, versionID).Scan(&blocked); err != nil {
		return err
	}
	if blocked {
		return nil
	}
	var failedExecutionID string
	var status executiontypes.ExecutionStatus
	var cause, causeID sql.NullString
	var createdAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT id, status, cause, cause_id, created_at FROM execution
		WHERE package_version_id = $1 ORDER BY created_at DESC LIMIT 1`, versionID).
		Scan(&failedExecutionID, &status, &cause, &causeID, &createdAt)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if status != executiontypes.ExecutionStatusFailed && status != executiontypes.ExecutionStatusVMDeleted {
		return nil
	}

	var queued bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM work_queue
			WHERE channel = 'build_package' AND completed_at IS NULL
			  AND payload->>'packageVersionId' = $1
			  AND (payload->>'retryOfExecutionId' = $3 OR created_at > $2)
		)`, versionID, createdAt, failedExecutionID).Scan(&queued); err != nil {
		return err
	}
	if queued {
		return nil
	}

	// Keep the cause ID so an existing rebuild chain can observe the new
	// execution and unblock its dependents when the retry succeeds.
	payload, err := json.Marshal(BuildPackagePayload{
		PackageID: packageID, PackageVersionID: versionID,
		Cause: cause.String, CauseID: causeID.String,
		RetryOfExecutionID: failedExecutionID,
	})
	if err != nil {
		return err
	}
	id, err := securerandom.Hex(6)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO work_queue (id, channel, payload, created_at, priority)
		VALUES ($1, 'build_package', $2, clock_timestamp(), $3)`, id, payload, persistence.PriorityNormal); err != nil {
		return fmt.Errorf("enqueue retry: %w", err)
	}
	if _, err := tx.Exec(ctx, `SELECT pg_notify('build_package', $1)`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
