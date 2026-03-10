package builder

import (
	"context"
	"fmt"
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

	// Use UNION query to handle package builds and image builds
	query := `
		select p.id, p.assigned_task_id, p.assigned_task_type, e.status
		from machine_pool p
		inner join execution e on p.assigned_task_id = e.id
		where p.assigned_task_type = 'build_package'
		union all
		select p.id, p.assigned_task_id, p.assigned_task_type, ib.status
		from machine_pool p
		inner join image_build ib on p.assigned_task_id = ib.id
		where p.assigned_task_type = 'build_image'
		order by assigned_task_type, id
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to query machine pool with build status: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var machineID, taskID, taskType, status string
		if err := rows.Scan(&machineID, &taskID, &taskType, &status); err != nil {
			return fmt.Errorf("failed to scan machine pool row: %w", err)
		}

		if err := handleVMCleanup(ctx, machineID, taskID, taskType, status); err != nil {
			logger.Error(fmt.Errorf("failed to handle VM cleanup for machine %s: %w", machineID, err))
		}
	}

	// Handle VMs with missing build records (orphaned VMs)
	if err := cleanupOrphanedVMs(ctx, conn); err != nil {
		logger.Error(fmt.Errorf("failed to cleanup orphaned VMs: %w", err))
	}

	return nil
}

func handleVMCleanup(ctx context.Context, machineID, taskID, taskType, status string) error {
	logger.Debug("checking build status for VM cleanup",
		zap.String("machineID", machineID),
		zap.String("taskID", taskID),
		zap.String("taskType", taskType),
		zap.String("status", status))

	var shouldDelete bool
	var reason string

	if taskType == "build_package" {
		// Handle package build cleanup
		switch status {
		case string(executiontypes.ExecutionStatusFailed):
			shouldDelete = true
			reason = "build failed"
		case string(executiontypes.ExecutionStatusVMDeleted):
			shouldDelete = true
			reason = "build failed(vm deleted)"
		case string(executiontypes.ExecutionStatusSuccess):
			shouldDelete = true
			reason = "build complete"
		}
	} else if taskType == "build_image" {
		// Handle image build cleanup
		switch status {
		case "failed":
			shouldDelete = true
			reason = "image build failed"
		case "timed_out":
			shouldDelete = true
			reason = "image build timed out"
		case "success":
			shouldDelete = true
			reason = "image build complete"
		}
	}

	if shouldDelete {
		logger.Info("releasing VM after build completion",
			zap.String("machineID", machineID),
			zap.String("taskID", taskID),
			zap.String("taskType", taskType),
			zap.String("status", status),
			zap.String("reason", reason))

		if err := DeleteVMWithReason(ctx, machineID, reason); err != nil {
			return fmt.Errorf("failed to delete vm: %w", err)
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

func cleanupOrphanedVMs(ctx context.Context, conn *pgxpool.Conn) error {
	// Find VMs assigned to tasks that no longer exist
	query := `
		select p.id, p.assigned_task_id, p.assigned_task_type
		from machine_pool p
		where p.assigned_task_type in ('build_package', 'build_image')
		and p.assigned_task_id is not null
		and p.assigned_task_id != ''
		and not exists (
			select 1 from execution e where e.id = p.assigned_task_id and p.assigned_task_type = 'build_package'
		)
		and not exists (
			select 1 from image_build ib where ib.id = p.assigned_task_id and p.assigned_task_type = 'build_image'
		)
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to query orphaned VMs: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var machineID, taskID, taskType string
		if err := rows.Scan(&machineID, &taskID, &taskType); err != nil {
			return fmt.Errorf("failed to scan orphaned VM row: %w", err)
		}

		logger.Warn("found orphaned VM, releasing",
			zap.String("machineID", machineID),
			zap.String("taskID", taskID),
			zap.String("taskType", taskType))

		reason := fmt.Sprintf("%s not found", taskType)
		if err := DeleteVMWithReason(ctx, machineID, reason); err != nil {
			logger.Errorf("failed to delete orphaned vm: %w", err)
		}
	}

	return nil
}
