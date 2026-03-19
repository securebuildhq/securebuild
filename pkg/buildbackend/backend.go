package buildbackend

import (
	"context"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"go.uber.org/zap"
)

const backendContextKey = "buildbackend"

// WithBackend stores a Backend in the context.
func WithBackend(ctx context.Context, b Backend) context.Context {
	return context.WithValue(ctx, backendContextKey, b)
}

// GetBackend retrieves the Backend from the context.
func GetBackend(ctx context.Context) Backend {
	b, _ := ctx.Value(backendContextKey).(Backend)
	return b
}

// BackendType identifies which build execution backend is active.
type BackendType string

const (
	BackendLocal  BackendType = "local"
	BackendStatic BackendType = "static"
	BackendCMX    BackendType = "cmx"
)

// AcquireOptions are passed to AcquireBuildMachine.
type AcquireOptions struct {
	Architecture string
	TaskType     string // "build_package" or "build_image"
	TaskID       string // execution ID or image build ID
	DiskSizeGB   int    // only used by CMX for on-demand VMs
	IsOnDemand   bool   // only supported for CMX
}

// BuildMachine represents an acquired build machine, regardless of backend.
type BuildMachine struct {
	// ID is a stable identifier for logging/status (e.g. "local", "static:<hash>", "<cmx-vm-id>")
	ID string

	// VM is the underlying BuilderVM from the pool (contains SSH details, arch, etc.)
	VM types.BuilderVM

	// WorkDir is the unique per-build working directory on the machine.
	WorkDir string

	// BackendType indicates which backend provided this machine.
	BackendType BackendType
}

// Backend is the interface for pluggable build execution backends.
type Backend interface {
	// Type returns the backend type.
	Type() BackendType

	// AcquireBuildMachine reserves a build machine for a task.
	// It inserts into machine_assignment and returns a BuildMachine.
	// No releaseFn is returned; release is handled by monitoring/cleanup.
	AcquireBuildMachine(ctx context.Context, opts AcquireOptions) (*BuildMachine, error)

	// SeedMachinePool ensures machine_pool rows exist for this backend's machines.
	// Called at startup. For local: creates a single local row. For static: seeds from config.
	// For CMX: no-op (pool maintenance handles it).
	SeedMachinePool(ctx context.Context) error

	// AvailableArchitectures returns the architectures available for package builds.
	// Local: single arch (host). Static: depends on configured VMs. CMX: always both.
	AvailableArchitectures(ctx context.Context) ([]string, error)
}

// GetActiveBackend returns the configured backend based on params.
// Falls back to CMX if not configured (backward compat).
func GetActiveBackend(ctx context.Context) (Backend, error) {
	p := param.GetParam(ctx)
	backendType := BackendType(p.BuildBackend)

	if backendType == "" {
		// Default: if Replicated API is configured, use CMX; otherwise local
		if p.ReplicatedAPIToken != "" && p.ReplicatedAPIOrigin != "" {
			backendType = BackendCMX
		} else {
			backendType = BackendLocal
		}
	}

	logger.Info("active build backend", zap.String("backend", string(backendType)))

	switch backendType {
	case BackendLocal:
		return NewLocalBackend(ctx)
	case BackendStatic:
		return NewStaticBackend(ctx)
	case BackendCMX:
		return NewCMXBackend(ctx)
	default:
		return nil, fmt.Errorf("unsupported build backend: %s", backendType)
	}
}
