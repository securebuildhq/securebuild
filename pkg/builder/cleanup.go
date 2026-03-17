package builder

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	executiontypes "github.com/securebuildhq/securebuild/pkg/execution/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

func StartVMCleanup(ctx context.Context) error {
	for {
		if err := cleanupFinishedVMs(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to cleanup finished vms: %w", err))
		}

		time.Sleep(time.Second * 10)
	}
}

func cleanupFinishedVMs(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Use machine_assignment joined to machine_pool (for type) and execution/image_build (for status)
	query := `
		select ma.machine_id, ma.assigned_task_id, ma.assigned_task_type, ma.work_dir, e.status, mp.type
		from machine_assignment ma
		inner join execution e on ma.assigned_task_id = e.id
		inner join machine_pool mp on ma.machine_id = mp.id
		where ma.assigned_task_type = 'build_package'
		union all
		select ma.machine_id, ma.assigned_task_id, ma.assigned_task_type, ma.work_dir, ib.status, mp.type
		from machine_assignment ma
		inner join image_build ib on ma.assigned_task_id = ib.id
		inner join machine_pool mp on ma.machine_id = mp.id
		where ma.assigned_task_type = 'build_image'
		order by assigned_task_type, machine_id
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to query machine assignments with build status: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var machineID, taskID, taskType, status, machineType string
		var workDir *string
		if err := rows.Scan(&machineID, &taskID, &taskType, &workDir, &status, &machineType); err != nil {
			return fmt.Errorf("failed to scan machine assignment row: %w", err)
		}

		wd := ""
		if workDir != nil {
			wd = *workDir
		}

		if err := handleVMCleanup(ctx, machineID, taskID, taskType, status, machineType, wd); err != nil {
			logger.Error(fmt.Errorf("failed to handle VM cleanup for machine %s: %w", machineID, err))
		}
	}

	// Handle VMs with missing build records (orphaned assignments)
	if err := cleanupOrphanedVMs(ctx, conn); err != nil {
		logger.Error(fmt.Errorf("failed to cleanup orphaned VMs: %w", err))
	}

	return nil
}

func handleVMCleanup(ctx context.Context, machineID, taskID, taskType, status, machineType, workDir string) error {
	logger.Debug("checking build status for VM cleanup",
		zap.String("machineID", machineID),
		zap.String("taskID", taskID),
		zap.String("taskType", taskType),
		zap.String("status", status),
		zap.String("machineType", machineType))

	var shouldRelease bool
	var reason string

	if taskType == "build_package" {
		// Handle package build cleanup
		switch status {
		case string(executiontypes.ExecutionStatusFailed):
			shouldRelease = true
			reason = "build failed"
		case string(executiontypes.ExecutionStatusVMDeleted):
			shouldRelease = true
			reason = "build failed(vm deleted)"
		case string(executiontypes.ExecutionStatusSuccess):
			shouldRelease = true
			reason = "build complete"
		}
	} else if taskType == "build_image" {
		// Handle image build cleanup
		switch status {
		case "failed":
			shouldRelease = true
			reason = "image build failed"
		case "timed_out":
			shouldRelease = true
			reason = "image build timed out"
		case "success":
			shouldRelease = true
			reason = "image build complete"
		}
	}

	if shouldRelease {
		logger.Info("releasing machine after build completion",
			zap.String("machineID", machineID),
			zap.String("taskID", taskID),
			zap.String("taskType", taskType),
			zap.String("status", status),
			zap.String("machineType", machineType),
			zap.String("reason", reason))

		if err := ReleaseMachine(ctx, machineID, taskType, taskID, machineType, workDir, reason); err != nil {
			return fmt.Errorf("failed to release machine: %w", err)
		}
	} else {
		logger.Debug("build still in progress, keeping VM assigned",
			zap.String("machineID", machineID),
			zap.String("taskID", taskID),
			zap.String("taskType", taskType),
			zap.String("status", status))
	}

	return nil
}

// ReleaseMachine releases a machine after a build completes.
// For CMX: calls Replicated API to delete the VM and removes from machine_pool.
// For local/static: only removes the machine_assignment row (machine stays in pool).
func ReleaseMachine(ctx context.Context, machineID, taskType, taskID, machineType, workDir, reason string) error {
	switch machineType {
	case "local", "static":
		// For static: delete remote work dir before releasing (local uses RemoveAll below).
		if machineType == "static" && workDir != "" {
			if vm, err := GetBuilderVM(ctx, machineID); err == nil {
				if client, err := GetSSHClient(ctx, vm); err == nil {
					escaped := strings.ReplaceAll(workDir, "'", "'\\''")
					cmd := "rm -rf '" + escaped + "'"
					stdoutCh := make(chan string)
					stderrCh := make(chan string)
					var wg sync.WaitGroup
					wg.Add(2)
					go func() { defer wg.Done(); for range stdoutCh {} }()
					go func() { defer wg.Done(); for range stderrCh {} }()
					if runErr := RunCommand(ctx, client.Client, machineID, cmd, stdoutCh, stderrCh); runErr != nil {
						logger.Warn("failed to delete remote work dir",
							zap.String("machineID", machineID),
							zap.String("workDir", workDir),
							zap.Error(runErr))
					}
					client.Close()
				}
			}
		}

		// For local/static: only remove the assignment, don't touch machine_pool
		if err := DeleteMachineAssignment(ctx, machineID, taskType, taskID); err != nil {
			return fmt.Errorf("failed to delete machine assignment: %w", err)
		}

		// Clean up work directory for local backends
		if machineType == "local" && workDir != "" {
			if err := os.RemoveAll(workDir); err != nil {
				logger.Warn("failed to clean up local work directory",
					zap.String("workDir", workDir),
					zap.Error(err))
			}
		}

		logger.Info("released machine assignment",
			zap.String("machineID", machineID),
			zap.String("taskType", taskType),
			zap.String("taskID", taskID),
			zap.String("machineType", machineType),
			zap.String("reason", reason))
		return nil

	default:
		// CMX: full VM deletion (Replicated API + machine_pool row)
		return DeleteVMWithReason(ctx, machineID, reason)
	}
}

func cleanupOrphanedVMs(ctx context.Context, conn *pgxpool.Conn) error {
	// Find machine_assignment rows where the referenced task no longer exists
	query := `
		select ma.machine_id, ma.assigned_task_id, ma.assigned_task_type, ma.work_dir, coalesce(mp.type, 'cmx') as machine_type
		from machine_assignment ma
		left join machine_pool mp on ma.machine_id = mp.id
		where ma.assigned_task_type in ('build_package', 'build_image')
		and not exists (
			select 1 from execution e where e.id = ma.assigned_task_id and ma.assigned_task_type = 'build_package'
		)
		and not exists (
			select 1 from image_build ib where ib.id = ma.assigned_task_id and ma.assigned_task_type = 'build_image'
		)
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to query orphaned machine assignments: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var machineID, taskID, taskType, machineType string
		var workDir *string
		if err := rows.Scan(&machineID, &taskID, &taskType, &workDir, &machineType); err != nil {
			return fmt.Errorf("failed to scan orphaned machine assignment row: %w", err)
		}

		logger.Warn("found orphaned machine assignment, releasing",
			zap.String("machineID", machineID),
			zap.String("taskID", taskID),
			zap.String("taskType", taskType),
			zap.String("machineType", machineType))

		wd := ""
		if workDir != nil {
			wd = *workDir
		}
		reason := fmt.Sprintf("%s not found", taskType)
		if err := ReleaseMachine(ctx, machineID, taskType, taskID, machineType, wd, reason); err != nil {
			logger.Errorf("failed to release orphaned machine: %w", err)
		}
	}

	return nil
}
