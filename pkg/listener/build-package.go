package listener

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/builder"
	"github.com/securebuildhq/securebuild/pkg/execution"
	executiontypes "github.com/securebuildhq/securebuild/pkg/execution/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	sbpackagetypes "github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

var (
	ErrExecutionPaused = errors.New("execution is paused")
)

type BuildPackagePayload struct {
	PackageID        string `json:"packageId"`
	PackageVersionID string `json:"packageVersionId"`
	Cause            string `json:"cause"`
	CauseID          string `json:"causeId"`
}

func HandleBuildPackage(ctx context.Context, payload string) error {
	logger.Debug("handling build package", zap.String("payload", payload))

	// if execution is paused, we just return an error
	if isPaused, err := execution.IsExecutionPaused(ctx); err != nil {
		return fmt.Errorf("failed to check if execution is paused: %w", err)
	} else if isPaused {
		// this queue is set to 24 hour max, so we can sleep for up to that
		// but check every 15 seconds to see if we resumed
		stillPaused := true
		timeout := time.Now().Add(24 * time.Hour)
		for stillPaused && time.Now().Before(timeout) {
			time.Sleep(15 * time.Second)
			if isPaused, err := execution.IsExecutionPaused(ctx); err != nil {
				return fmt.Errorf("failed to check if execution is paused: %w", err)
			} else if !isPaused {
				stillPaused = false
				break
			}
		}
		if stillPaused {
			return ErrExecutionPaused
		}
	}

	var buildPackagePayload BuildPackagePayload
	if err := json.Unmarshal([]byte(payload), &buildPackagePayload); err != nil {
		return fmt.Errorf("failed to unmarshal build package payload: %w", err)
	}

	pkg, err := sbpackage.GetPackage(ctx, buildPackagePayload.PackageID)
	if err != nil {
		if err == sbpackage.ErrPackageNotFound {
			return nil // no need to try again
		}
		return fmt.Errorf("failed to get package: %w", err)
	}

	var pkgVersion *sbpackagetypes.PackageVersion
	if buildPackagePayload.PackageVersionID != "" {
		pkgVersion, err = sbpackage.GetPackageVersion(ctx, buildPackagePayload.PackageVersionID)
		if err != nil {
			return fmt.Errorf("failed to get package version: %w", err)
		}
	} else {
		// if the most recent package version built, we need a new one
		mostRecentPackageVersion, err := sbpackage.GetLatestPackageVersion(ctx, pkg.ID)
		if err != nil {
			return fmt.Errorf("failed to get most recent package version: %w", err)
		}

		executionStatus, err := execution.GetExcecutionStatusForPackageVersionID(ctx, mostRecentPackageVersion.ID)
		if err != nil {
			return fmt.Errorf("failed to get execution status for package version: %w", err)
		}

		if executionStatus == executiontypes.ExecutionStatusSuccess {
			pkgVersion, err = sbpackage.CreateNewReleaseForLatestPackageVersion(ctx, pkg.ID, "", "")
			if err != nil {
				return fmt.Errorf("failed to get package version: %w", err)
			}
		} else {
			pkgVersion = mostRecentPackageVersion
		}
	}

	if err := updateDependenciesForPackageVersion(ctx, pkgVersion); err != nil {
		logger.Warn("failed to update dependencies for package before building",
			zap.String("package_version_id", pkgVersion.ID),
			zap.String("package_name", pkg.Name),
			zap.String("package_version", pkgVersion.Version),
			zap.Int("package_apk_release", pkgVersion.APKRelease),
			zap.Error(err))
	}

	exe, err := execution.CreateExecution(ctx, pkg.ID, pkgVersion, buildPackagePayload.Cause, buildPackagePayload.CauseID)
	if err != nil {
		return fmt.Errorf("failed to create execution: %w", err)
	}

	// Check if custom disk size is specified
	if pkgVersion.CustomDiskSize != nil && *pkgVersion.CustomDiskSize > 0 {
		// Set status to "provisioning" for on-demand VMs
		if err := execution.UpdateExecutionStatus(ctx, exe.ID, executiontypes.ExecutionStatusProvisioning); err != nil {
			return fmt.Errorf("failed to set execution status to provisioning: %w", err)
		}

		// Queue provision_vms event for custom disk size
		provisionVMsPayload := ProvisionVMsPayload{
			PackageID:        pkg.ID,
			PackageVersionID: pkgVersion.ID,
			ExecutionID:      exe.ID,
			DiskSizeGB:       *pkgVersion.CustomDiskSize,
		}

		marshalledPayload, err := json.Marshal(provisionVMsPayload)
		if err != nil {
			return fmt.Errorf("failed to marshal provision vms payload: %w", err)
		}

		if err := persistence.EnqueueWork(ctx, "provision_vms", string(marshalledPayload)); err != nil {
			return fmt.Errorf("failed to enqueue provision vms: %w", err)
		}

		return nil
	}

	// Use pool VMs for standard disk size
	// Set status to "queued" for pool VM builds
	if err := execution.UpdateExecutionStatus(ctx, exe.ID, executiontypes.ExecutionStatusQueued); err != nil {
		return fmt.Errorf("failed to set execution status: %w", err)
	}

	x86VMID, armVMID, err := assignVMsWithTimeout(ctx, exe.ID, time.Minute*10)
	if err != nil {
		logger.Warn("EXECUTION FAILED: VM assignment failure - could not assign required VMs for build",
			zap.String("executionID", exe.ID),
			zap.String("packageID", pkg.ID),
			zap.String("packageName", pkg.Name),
			zap.String("version", pkgVersion.Version),
			zap.Error(err))

		if statusErr := execution.UpdateExecutionStatus(ctx, exe.ID, executiontypes.ExecutionStatusFailed); statusErr != nil {
			logger.Warn("failed to set execution status to failed after VM assignment failure", zap.Error(statusErr))
		}

		return fmt.Errorf("failed to assign vms: %w", err)
	}

	// update the created at on the execution so that our timeout works and we reflect reality
	if err := execution.UpdateExecutionCreatedAt(ctx, exe.ID); err != nil {
		return fmt.Errorf("failed to update created at: %w", err)
	}

	buildPackageWithVmsAssignedPayload := BuildPackageWithVMsAssignedPayload{
		PackageID:        pkg.ID,
		PackageVersionID: pkgVersion.ID,
		X86VMID:          x86VMID,
		ARMVMID:          armVMID,
		ExecutionID:      exe.ID,
	}

	marshalledPayload, err := json.Marshal(buildPackageWithVmsAssignedPayload)
	if err != nil {
		return fmt.Errorf("failed to marshal build package with vms assigned payload: %w", err)
	}

	if err := persistence.EnqueueWork(ctx, "build_package_with_vms_assigned", string(marshalledPayload)); err != nil {
		return fmt.Errorf("failed to enqueue build package with vms assigned: %w", err)
	}

	return nil
}

func assignVMsWithTimeout(ctx context.Context, executionID string, timeout time.Duration) (string, string, error) {
	logger.Debug("assigning VMs",
		zap.String("executionID", executionID),
		zap.Duration("timeout", timeout),
	)

	// Create a context with timeout
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	vmx86, err := builder.TakeVMWithAssignment(timeoutCtx, "x86_64", "build_package", executionID)
	if err != nil {
		return "", "", fmt.Errorf("failed to take vm for x86_64: %w", err)
	}

	vmaarch64, err := builder.TakeVMWithAssignment(timeoutCtx, "aarch64", "build_package", executionID)
	if err != nil {
		return "", "", fmt.Errorf("failed to take vm for aarch64: %w", err)
	}

	return vmx86.ID, vmaarch64.ID, nil
}

func updateDependenciesForPackageVersion(ctx context.Context, pkgVersion *sbpackagetypes.PackageVersion) error {
	logger.Debug("rebuilding dependency graph for package version during build",
		zap.String("package_version_id", pkgVersion.ID),
		zap.String("package_version", pkgVersion.Version),
		zap.Int("package_melange_yaml_size", len(pkgVersion.MelangeYaml)),
		zap.Int("package_apk_release", pkgVersion.APKRelease))

	if err := sbpackage.WritePackageVersionDependencies(ctx, nil, pkgVersion); err != nil {
		return fmt.Errorf("failed to write package version dependencies: %w", err)
	}

	return nil
}
