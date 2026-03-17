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

	// Assign VM to this execution BEFORE provisioning completes (work dir = remote $HOME)
	x86Home, err := builder.GetRemoteHome(ctx, vmx86)
	if err != nil {
		builder.DeleteVM(ctx, vmx86.ID)
		return fmt.Errorf("failed to get x86_64 VM home: %w", err)
	}
	if err := builder.AssignVMToTask(ctx, vmx86.ID, "build_package", p.ExecutionID, x86Home); err != nil {
		builder.DeleteVM(ctx, vmx86.ID)
		return fmt.Errorf("failed to assign x86_64 VM to task: %w", err)
	}

	// Provision aarch64 VM with custom disk size
	// isOnDemand=true since this is provisioned for a specific build
	logger.Info("provisioning aarch64 VM with custom disk size",
		zap.String("executionID", p.ExecutionID),
		zap.Int("diskSizeGB", p.DiskSizeGB))

	vmaarch64, err := builder.ProvisionVMForBuild(ctx, machineID, "aarch64", p.DiskSizeGB, true)
	if err != nil {
		// Clean up x86 VM
		builder.DeleteVM(ctx, vmx86.ID)

		if statusErr := execution.UpdateExecutionStatus(ctx, p.ExecutionID, executiontypes.ExecutionStatusFailed); statusErr != nil {
			logger.Warn("failed to update execution status to failed", zap.Error(statusErr))
		}
		return fmt.Errorf("failed to provision aarch64 VM: %w", err)
	}

	// Assign VM to this execution (work dir = remote $HOME)
	armHome, err := builder.GetRemoteHome(ctx, vmaarch64)
	if err != nil {
		builder.DeleteVM(ctx, vmx86.ID)
		builder.DeleteVM(ctx, vmaarch64.ID)
		return fmt.Errorf("failed to get aarch64 VM home: %w", err)
	}
	if err := builder.AssignVMToTask(ctx, vmaarch64.ID, "build_package", p.ExecutionID, armHome); err != nil {
		builder.DeleteVM(ctx, vmx86.ID)
		builder.DeleteVM(ctx, vmaarch64.ID)
		return fmt.Errorf("failed to assign aarch64 VM to task: %w", err)
	}

	// Update execution table with builder IDs
	// This allows installBuildEnv to know when both VMs are ready
	if err := execution.SetExecutionBuilderID(ctx, p.ExecutionID, "x86_64", vmx86.ID); err != nil {
		builder.DeleteVM(ctx, vmx86.ID)
		builder.DeleteVM(ctx, vmaarch64.ID)
		return fmt.Errorf("failed to set x86_64 builder ID: %w", err)
	}

	if err := execution.SetExecutionBuilderID(ctx, p.ExecutionID, "aarch64", vmaarch64.ID); err != nil {
		builder.DeleteVM(ctx, vmx86.ID)
		builder.DeleteVM(ctx, vmaarch64.ID)
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
