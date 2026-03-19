package builder

import (
	"context"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// MigrateMachinePool runs data migrations at startup. Schema changes are managed
// by SchemaHero. This function is idempotent and safe to run multiple times.
//
//   - Set type='cmx' for any machine_pool rows with NULL type (backfill for existing VMs)
//   - Backfill machine_assignment from machine_pool's assigned_task_type/assigned_task_id
//     (one-time migration before those columns are dropped by SchemaHero)
func MigrateMachinePool(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Step 1: Set type='cmx' for all existing rows that have NULL type
	setTypeQuery := `UPDATE machine_pool SET type = 'cmx' WHERE type IS NULL`
	result, err := conn.Exec(ctx, setTypeQuery)
	if err != nil {
		return fmt.Errorf("failed to set type=cmx for existing machine_pool rows: %w", err)
	}
	if result.RowsAffected() > 0 {
		logger.Info("migrated machine_pool rows to type=cmx", zap.Int64("count", result.RowsAffected()))
	}

	// Step 2: Backfill machine_assignment from machine_pool's assigned_task columns.
	backfillQuery := `
		INSERT INTO machine_assignment (machine_id, assigned_task_type, assigned_task_id, created_at)
		SELECT id, assigned_task_type, assigned_task_id, now()
		FROM machine_pool
		WHERE assigned_task_type IS NOT NULL
		  AND assigned_task_type != ''
		  AND assigned_task_id IS NOT NULL
		  AND assigned_task_id != ''
		ON CONFLICT (machine_id, assigned_task_type, assigned_task_id) DO NOTHING
	`
	backfillResult, err := conn.Exec(ctx, backfillQuery)
	if err != nil {
		return fmt.Errorf("failed to backfill machine_assignment from machine_pool: %w", err)
	}
	if backfillResult.RowsAffected() > 0 {
		logger.Info("backfilled machine_assignment from machine_pool", zap.Int64("count", backfillResult.RowsAffected()))
	}

	logger.Info("machine_pool migration completed successfully")
	return nil
}
