package builder

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// InsertMachineAssignmentWithWorkDir inserts a row into machine_assignment with a work directory.
func InsertMachineAssignmentWithWorkDir(ctx context.Context, machineID, taskType, taskID, workDir string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `INSERT INTO machine_assignment (machine_id, assigned_task_type, assigned_task_id, work_dir, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (machine_id, assigned_task_type, assigned_task_id) DO UPDATE SET work_dir = EXCLUDED.work_dir`
	_, err := conn.Exec(ctx, query, machineID, taskType, taskID, workDir, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("failed to insert machine assignment: %w", err)
	}

	logger.Debug("inserted machine assignment",
		zap.String("machineID", machineID),
		zap.String("taskType", taskType),
		zap.String("taskID", taskID),
		zap.String("workDir", workDir))
	return nil
}

// ErrMachineAtCapacity is returned when a machine has reached its max parallel build limit.
var ErrMachineAtCapacity = fmt.Errorf("machine at capacity")

// InsertMachineAssignmentIfCapacity atomically checks that the machine has fewer than
// maxParallel assignments and inserts a new one. Uses a PostgreSQL advisory lock keyed
// on the machine ID to serialize concurrent callers for the same machine.
func InsertMachineAssignmentIfCapacity(ctx context.Context, machineID, taskType, taskID, workDir string, maxParallel int) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Take an advisory lock keyed on the machine ID to serialize concurrent assignment attempts.
	lockKey := advisoryLockKey(machineID)
	_, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, lockKey)
	if err != nil {
		return fmt.Errorf("failed to acquire advisory lock: %w", err)
	}

	// Count current assignments under the lock.
	var count int
	err = tx.QueryRow(ctx, `SELECT COUNT(*) FROM machine_assignment WHERE machine_id = $1`, machineID).Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to count assignments: %w", err)
	}

	if count >= maxParallel {
		return ErrMachineAtCapacity
	}

	// Insert the assignment.
	_, err = tx.Exec(ctx, `INSERT INTO machine_assignment (machine_id, assigned_task_type, assigned_task_id, work_dir, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (machine_id, assigned_task_type, assigned_task_id) DO UPDATE SET work_dir = EXCLUDED.work_dir`,
		machineID, taskType, taskID, workDir, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("failed to insert machine assignment: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit assignment: %w", err)
	}

	logger.Debug("inserted machine assignment (capacity checked)",
		zap.String("machineID", machineID),
		zap.String("taskType", taskType),
		zap.String("taskID", taskID),
		zap.String("workDir", workDir),
		zap.Int("currentCount", count),
		zap.Int("maxParallel", maxParallel))
	return nil
}

// advisoryLockKey produces a stable int64 from a machine ID for use with pg_advisory_xact_lock.
func advisoryLockKey(machineID string) int64 {
	h := int64(0)
	for _, c := range machineID {
		h = h*31 + int64(c)
	}
	return h
}

// DeleteMachineAssignment removes a row from machine_assignment.
func DeleteMachineAssignment(ctx context.Context, machineID, taskType, taskID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `DELETE FROM machine_assignment WHERE machine_id = $1 AND assigned_task_type = $2 AND assigned_task_id = $3`
	_, err := conn.Exec(ctx, query, machineID, taskType, taskID)
	if err != nil {
		return fmt.Errorf("failed to delete machine assignment: %w", err)
	}

	logger.Debug("deleted machine assignment",
		zap.String("machineID", machineID),
		zap.String("taskType", taskType),
		zap.String("taskID", taskID))
	return nil
}

// DeleteAllMachineAssignments removes all assignments for a given machine.
func DeleteAllMachineAssignments(ctx context.Context, machineID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `DELETE FROM machine_assignment WHERE machine_id = $1`
	_, err := conn.Exec(ctx, query, machineID)
	if err != nil {
		return fmt.Errorf("failed to delete all machine assignments: %w", err)
	}
	return nil
}

// GetMachineAssignment returns the first assignment for a given machine, or nil if none.
func GetMachineAssignment(ctx context.Context, machineID string) (*types.MachineAssignment, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT machine_id, assigned_task_type, assigned_task_id, work_dir, created_at
		FROM machine_assignment WHERE machine_id = $1 LIMIT 1`
	var a types.MachineAssignment
	var workDir *string
	err := conn.QueryRow(ctx, query, machineID).Scan(&a.MachineID, &a.AssignedTaskType, &a.AssignedTaskID, &workDir, &a.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get machine assignment: %w", err)
	}
	if workDir != nil {
		a.WorkDir = *workDir
	}
	return &a, nil
}

// CountMachineAssignments returns the number of active assignments for a machine.
func CountMachineAssignments(ctx context.Context, machineID string) (int, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT COUNT(*) FROM machine_assignment WHERE machine_id = $1`
	var count int
	err := conn.QueryRow(ctx, query, machineID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count machine assignments: %w", err)
	}
	return count, nil
}

// IsMachineAssigned returns true if a machine has any assignments.
func IsMachineAssigned(ctx context.Context, machineID string) (bool, error) {
	count, err := CountMachineAssignments(ctx, machineID)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// GetAssignmentsByTask returns the machine assignment for a specific task.
func GetAssignmentsByTask(ctx context.Context, taskType, taskID string) ([]types.MachineAssignment, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT machine_id, assigned_task_type, assigned_task_id, work_dir, created_at
		FROM machine_assignment WHERE assigned_task_type = $1 AND assigned_task_id = $2`
	rows, err := conn.Query(ctx, query, taskType, taskID)
	if err != nil {
		return nil, fmt.Errorf("failed to query machine assignments by task: %w", err)
	}
	defer rows.Close()

	var assignments []types.MachineAssignment
	for rows.Next() {
		var a types.MachineAssignment
		var workDir *string
		if err := rows.Scan(&a.MachineID, &a.AssignedTaskType, &a.AssignedTaskID, &workDir, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan machine assignment: %w", err)
		}
		if workDir != nil {
			a.WorkDir = *workDir
		}
		assignments = append(assignments, a)
	}
	return assignments, nil
}

// GetWorkDirForTask returns the work directory for a specific task on a specific machine.
// It looks up the row by the full primary key (machine_id, assigned_task_type, assigned_task_id).
func GetWorkDirForTask(ctx context.Context, taskType, taskID, machineID string) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT work_dir FROM machine_assignment
		WHERE machine_id = $1 AND assigned_task_type = $2 AND assigned_task_id = $3`
	var workDir *string
	err := conn.QueryRow(ctx, query, machineID, taskType, taskID).Scan(&workDir)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", fmt.Errorf("no machine assignment found for %s/%s on machine %s", taskType, taskID, machineID)
		}
		return "", fmt.Errorf("failed to get work dir for task: %w", err)
	}
	if workDir == nil || *workDir == "" {
		return "", fmt.Errorf("machine assignment for %s/%s on machine %s has no work_dir", taskType, taskID, machineID)
	}
	return *workDir, nil
}
