package listener

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/buildbackend"
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
	ErrNotRetryable    = errors.New("not retryable")
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
			return fmt.Errorf("%w: failed to get package version: %w", ErrNotRetryable, err)
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

	exe, created, err := execution.CreateExecutionIfNoActive(ctx, pkg.ID, pkgVersion, buildPackagePayload.Cause, buildPackagePayload.CauseID)
	if err != nil {
		return fmt.Errorf("failed to create execution: %w", err)
	}
	if !created {
		logger.Info("package version already has an active execution; skipping duplicate build request",
			zap.String("packageVersionID", pkgVersion.ID),
			zap.String("executionID", exe.ID),
			zap.String("status", exe.Status))
		return nil
	}

	// Get the active backend to determine architecture behavior
	backend := buildbackend.GetBackend(ctx)
	if backend == nil {
		// Fallback: create backend from config (handles tests and legacy code paths)
		var backendErr error
		backend, backendErr = buildbackend.GetActiveBackend(ctx)
		if backendErr != nil {
			logger.Warn("failed to create build backend, falling back to CMX", zap.Error(backendErr))
			backend, _ = buildbackend.NewCMXBackend(ctx)
		}
	}

	// On-demand VMs (custom disk size) are only supported for CMX backend
	if pkgVersion.CustomDiskSize != nil && *pkgVersion.CustomDiskSize > 0 {
		if backend == nil || backend.Type() == buildbackend.BackendCMX {
			return handleOnDemandProvision(ctx, exe, pkg, pkgVersion)
		}
		// For non-CMX backends, ignore custom disk size and proceed normally
		logger.Warn("custom disk size requested but backend does not support on-demand VMs, using standard build",
			zap.String("backend", string(backend.Type())),
			zap.String("executionID", exe.ID))
	}

	// Set status to "queued" for pool VM builds
	if err := execution.UpdateExecutionStatus(ctx, exe.ID, executiontypes.ExecutionStatusQueued); err != nil {
		return fmt.Errorf("failed to set execution status: %w", err)
	}

	// Determine which architectures to build based on backend
	arches, err := getPackageBuildArchitectures(ctx, backend)
	if err != nil {
		if statusErr := execution.UpdateExecutionStatus(ctx, exe.ID, executiontypes.ExecutionStatusFailed); statusErr != nil {
			logger.Warn("failed to set execution status to failed", zap.Error(statusErr))
		}
		return fmt.Errorf("failed to determine build architectures: %w", err)
	}

	x86VMID, armVMID, x86WorkDir, armWorkDir, err := assignVMsForArchitectures(ctx, backend, exe.ID, arches)
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
		X86WorkDir:       x86WorkDir,
		ARMWorkDir:       armWorkDir,
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

// handleOnDemandProvision handles the on-demand VM provisioning path (CMX only).
func handleOnDemandProvision(ctx context.Context, exe *executiontypes.Execution, pkg *sbpackagetypes.Package, pkgVersion *sbpackagetypes.PackageVersion) error {
	if err := execution.UpdateExecutionStatus(ctx, exe.ID, executiontypes.ExecutionStatusProvisioning); err != nil {
		return fmt.Errorf("failed to set execution status to provisioning: %w", err)
	}

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

// getPackageBuildArchitectures returns the architectures to build for package builds.
func getPackageBuildArchitectures(ctx context.Context, backend buildbackend.Backend) ([]string, error) {
	if backend == nil {
		// Fallback: always both (legacy CMX behavior)
		return []string{"x86_64", "aarch64"}, nil
	}
	return backend.AvailableArchitectures(ctx)
}

// assignVMsForArchitectures assigns VMs for the given architectures using the active backend.
// Returns x86VMID, armVMID, x86WorkDir, armWorkDir; either pair may be empty if that arch is not in the list.
func assignVMsForArchitectures(ctx context.Context, backend buildbackend.Backend, executionID string, arches []string) (string, string, string, string, error) {
	logger.Debug("assigning VMs for architectures",
		zap.String("executionID", executionID),
		zap.Strings("architectures", arches),
	)

	var x86VMID, armVMID, x86WorkDir, armWorkDir string

	for _, arch := range arches {
		machine, err := backend.AcquireBuildMachine(ctx, buildbackend.AcquireOptions{
			Architecture: arch,
			TaskType:     "build_package",
			TaskID:       executionID,
		})
		if err != nil {
			return "", "", "", "", fmt.Errorf("failed to acquire build machine for %s: %w", arch, err)
		}

		switch arch {
		case "x86_64":
			x86VMID = machine.ID
			x86WorkDir = machine.WorkDir
		case "aarch64":
			armVMID = machine.ID
			armWorkDir = machine.WorkDir
		}
	}

	return x86VMID, armVMID, x86WorkDir, armWorkDir, nil
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
