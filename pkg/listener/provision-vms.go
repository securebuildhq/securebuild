package listener

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/builder"
	"github.com/securebuildhq/securebuild/pkg/execution"
	executiontypes "github.com/securebuildhq/securebuild/pkg/execution/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

type ProvisionVMsPayload struct {
	PackageID        string `json:"packageId"`
	PackageVersionID string `json:"packageVersionId"`
	ExecutionID      string `json:"executionId"`
	DiskSizeGB       int    `json:"diskSizeGb"`
}

func deleteVMBestEffort(ctx context.Context, vmIDs ...string) {
	for _, id := range vmIDs {
		if err := builder.DeleteVM(ctx, id); err != nil {
			logger.Warn("failed to delete VM during cleanup", zap.String("vmID", id), zap.Error(err))
		}
	}
}

func handleProvisionVMs(ctx context.Context, payload string) error {
	logger.Debug("handling provision vms", zap.String("payload", payload))

	var p ProvisionVMsPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return fmt.Errorf("failed to unmarshal provision vms payload: %w", err)
	}

	// Get the current worker's machine ID so this worker can manage these VMs
	// Both VMs use the same machine ID so the maintenance loop can find and update them
	machineID, err := builder.GetMachineID()
	if err != nil {
		return fmt.Errorf("failed to get machine ID: %w", err)
	}

	// Provision x86_64 VM with custom disk size
	// isOnDemand=true since this is provisioned for a specific build
	logger.Info("provisioning x86_64 VM with custom disk size",
		zap.String("executionID", p.ExecutionID),
		zap.Int("diskSizeGB", p.DiskSizeGB))

	vmx86, err := builder.ProvisionVMForBuild(ctx, machineID, "x86_64", p.DiskSizeGB, true)
	if err != nil {
		if statusErr := execution.UpdateExecutionStatus(ctx, p.ExecutionID, executiontypes.ExecutionStatusFailed); statusErr != nil {
			logger.Warn("failed to update execution status to failed", zap.Error(statusErr))
		}
		return fmt.Errorf("failed to provision x86_64 VM: %w", err)
	}

	// Assign the VM to this execution without a work dir. The VM was just
	// created and is not yet network/SSH-reachable, so we must NOT SSH into it
	// here (doing so fails and would trigger immediate teardown of the VM). The
	// work dir (remote $HOME) is resolved later at build time, once the
	// maintenance loop observes the VM as "running".
	if err := builder.AssignVMToTask(ctx, vmx86.ID, "build_package", p.ExecutionID, ""); err != nil {
		deleteVMBestEffort(ctx, vmx86.ID)
		return fmt.Errorf("failed to assign x86_64 VM to task: %w", err)
	}

	// Provision aarch64 VM with custom disk size
	// isOnDemand=true since this is provisioned for a specific build
	logger.Info("provisioning aarch64 VM with custom disk size",
		zap.String("executionID", p.ExecutionID),
		zap.Int("diskSizeGB", p.DiskSizeGB))

	vmaarch64, err := builder.ProvisionVMForBuild(ctx, machineID, "aarch64", p.DiskSizeGB, true)
	if err != nil {
		deleteVMBestEffort(ctx, vmx86.ID)

		if statusErr := execution.UpdateExecutionStatus(ctx, p.ExecutionID, executiontypes.ExecutionStatusFailed); statusErr != nil {
			logger.Warn("failed to update execution status to failed", zap.Error(statusErr))
		}
		return fmt.Errorf("failed to provision aarch64 VM: %w", err)
	}

	// Assign the VM without a work dir; resolved later at build time once the VM
	// is running (see x86_64 note above).
	if err := builder.AssignVMToTask(ctx, vmaarch64.ID, "build_package", p.ExecutionID, ""); err != nil {
		deleteVMBestEffort(ctx, vmx86.ID, vmaarch64.ID)
		return fmt.Errorf("failed to assign aarch64 VM to task: %w", err)
	}

	// Update execution table with builder IDs
	// This allows installBuildEnv to know when both VMs are ready
	if err := execution.SetExecutionBuilderID(ctx, p.ExecutionID, "x86_64", vmx86.ID); err != nil {
		deleteVMBestEffort(ctx, vmx86.ID, vmaarch64.ID)
		return fmt.Errorf("failed to set x86_64 builder ID: %w", err)
	}

	if err := execution.SetExecutionBuilderID(ctx, p.ExecutionID, "aarch64", vmaarch64.ID); err != nil {
		deleteVMBestEffort(ctx, vmx86.ID, vmaarch64.ID)
		return fmt.Errorf("failed to set aarch64 builder ID: %w", err)
	}

	logger.Info("successfully provisioned on-demand VMs, waiting for them to become ready",
		zap.String("executionID", p.ExecutionID),
		zap.String("x86VMID", vmx86.ID),
		zap.String("armVMID", vmaarch64.ID),
		zap.Int("diskSizeGB", p.DiskSizeGB))

	// VMs will provision asynchronously
	// checkAndUpdateVMStatus will detect when both VMs are ready and queue build_package_with_vms_assigned
	return nil
}
