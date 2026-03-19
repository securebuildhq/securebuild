package buildbackend

import (
	"context"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/builder"
	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

// resolveCMXWorkDir returns the CMX work dir using the same method as GetRemoteHome:
// use assignment work_dir if set, else remote $HOME via SSH, else "/home/<username>".
func resolveCMXWorkDir(ctx context.Context, vm buildertypes.BuilderVM) (string, error) {
	assn, err := builder.GetMachineAssignment(ctx, vm.ID)
	if err == nil && assn != nil && assn.WorkDir != "" {
		return assn.WorkDir, nil
	}
	home, err := builder.GetRemoteHome(ctx, vm)
	if err != nil {
		return "", fmt.Errorf("get remote HOME for VM %s: %w", vm.ID, err)
	}
	return home, nil
}

// CMXBackend implements the Backend interface using Replicated CMX VMs.
// This wraps the existing pool.go behavior.
type CMXBackend struct{}

func NewCMXBackend(_ context.Context) (*CMXBackend, error) {
	return &CMXBackend{}, nil
}

func (b *CMXBackend) Type() BackendType {
	return BackendCMX
}

func (b *CMXBackend) SeedMachinePool(_ context.Context) error {
	// CMX pool is managed by CreatePool and the maintenance loop.
	// No additional seeding needed.
	return nil
}

func (b *CMXBackend) AvailableArchitectures(_ context.Context) ([]string, error) {
	// CMX always builds both architectures for package builds.
	return []string{"x86_64", "aarch64"}, nil
}

func (b *CMXBackend) AcquireBuildMachine(ctx context.Context, opts AcquireOptions) (*BuildMachine, error) {
	if opts.IsOnDemand {
		return b.acquireOnDemand(ctx, opts)
	}
	return b.acquireFromPool(ctx, opts)
}

func (b *CMXBackend) acquireFromPool(ctx context.Context, opts AcquireOptions) (*BuildMachine, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	vm, err := builder.TakeVMWithAssignment(timeoutCtx, opts.Architecture, opts.TaskType, opts.TaskID)
	if err != nil {
		return nil, fmt.Errorf("failed to take VM from pool: %w", err)
	}

	logger.Debug("CMX backend acquired VM from pool",
		zap.String("vmID", vm.ID),
		zap.String("architecture", opts.Architecture),
		zap.String("taskType", opts.TaskType),
		zap.String("taskID", opts.TaskID))

	workDir, err := resolveCMXWorkDir(ctx, vm)
	if err != nil {
		return nil, fmt.Errorf("resolve CMX work dir: %w", err)
	}

	return &BuildMachine{
		ID:          vm.ID,
		VM:          vm,
		WorkDir:     workDir,
		BackendType: BackendCMX,
	}, nil
}

func (b *CMXBackend) acquireOnDemand(ctx context.Context, opts AcquireOptions) (*BuildMachine, error) {
	machineID, err := builder.GetMachineID()
	if err != nil {
		return nil, fmt.Errorf("failed to get machine ID: %w", err)
	}

	vm, err := builder.ProvisionVMForBuild(ctx, machineID, opts.Architecture, opts.DiskSizeGB, true)
	if err != nil {
		return nil, fmt.Errorf("failed to provision on-demand VM: %w", err)
	}

	workDir, err := resolveCMXWorkDir(ctx, vm)
	if err != nil {
		builder.DeleteVM(ctx, vm.ID)
		return nil, fmt.Errorf("resolve CMX work dir: %w", err)
	}

	if err := builder.AssignVMToTask(ctx, vm.ID, opts.TaskType, opts.TaskID, workDir); err != nil {
		builder.DeleteVM(ctx, vm.ID)
		return nil, fmt.Errorf("failed to assign on-demand VM: %w", err)
	}

	return &BuildMachine{
		ID:          vm.ID,
		VM:          vm,
		WorkDir:     workDir,
		BackendType: BackendCMX,
	}, nil
}
