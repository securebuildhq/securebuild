package buildbackend

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/securebuildhq/securebuild/pkg/builder"
	"github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

const localMachineID = "local"

// LocalBackend runs builds on the same host as the service.
type LocalBackend struct {
	baseDir      string
	architecture string
}

func NewLocalBackend(_ context.Context) (*LocalBackend, error) {
	arch := goArchToBuilderArch(runtime.GOARCH)

	return &LocalBackend{
		baseDir:      os.TempDir(),
		architecture: arch,
	}, nil
}

func (b *LocalBackend) Type() BackendType {
	return BackendLocal
}

func (b *LocalBackend) SeedMachinePool(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Upsert a single local machine row in machine_pool
	query := `
		INSERT INTO machine_pool (id, machine_id, created_at, private_key, username, status, architecture, is_on_demand, type)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (id) DO UPDATE SET
			status = EXCLUDED.status,
			architecture = EXCLUDED.architecture,
			type = EXCLUDED.type
	`
	_, err := conn.Exec(ctx, query,
		localMachineID,    // id
		localMachineID,    // machine_id
		time.Now().UTC(),  // created_at
		"",                // private_key (not needed for local)
		"",                // username (not needed for local)
		"running",         // status
		b.architecture,    // architecture
		false,             // is_on_demand
		"local",           // type
	)
	if err != nil {
		return fmt.Errorf("failed to seed local machine in pool: %w", err)
	}

	logger.Info("seeded local machine in pool",
		zap.String("architecture", b.architecture))
	return nil
}

func (b *LocalBackend) AvailableArchitectures(_ context.Context) ([]string, error) {
	return []string{b.architecture}, nil
}

func (b *LocalBackend) AcquireBuildMachine(ctx context.Context, opts AcquireOptions) (*BuildMachine, error) {
	// Create unique work directory
	workDir, err := b.createWorkDir(opts)
	if err != nil {
		return nil, fmt.Errorf("failed to create work directory: %w", err)
	}

	// Atomically check capacity and insert assignment
	maxParallel := getMaxParallelBuildsFromCtx(ctx)
	if err := builder.InsertMachineAssignmentIfCapacity(ctx, localMachineID, opts.TaskType, opts.TaskID, workDir, maxParallel); err != nil {
		// Clean up the work directory on failure
		os.RemoveAll(workDir)
		if err == builder.ErrMachineAtCapacity {
			return nil, fmt.Errorf("local machine at capacity (%d max parallel builds)", maxParallel)
		}
		return nil, fmt.Errorf("failed to insert local machine assignment: %w", err)
	}

	vm := types.BuilderVM{
		ID:           localMachineID,
		Status:       "running",
		Architecture: b.architecture,
		Type:         "local",
	}

	logger.Debug("local backend acquired build machine",
		zap.String("workDir", workDir),
		zap.String("taskType", opts.TaskType),
		zap.String("taskID", opts.TaskID))

	return &BuildMachine{
		ID:          localMachineID,
		VM:          vm,
		WorkDir:     workDir,
		BackendType: BackendLocal,
	}, nil
}

func (b *LocalBackend) createWorkDir(opts AcquireOptions) (string, error) {
	var dirName string
	switch opts.TaskType {
	case "build_package":
		dirName = fmt.Sprintf("execution-%s-%s", opts.TaskID, opts.Architecture)
	case "build_image":
		dirName = fmt.Sprintf("build-%s", opts.TaskID)
	default:
		dirName = fmt.Sprintf("task-%s-%s", opts.TaskType, opts.TaskID)
	}

	workDir := filepath.Join(b.baseDir, "securebuild", dirName)
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create work directory %s: %w", workDir, err)
	}
	return workDir, nil
}

// goArchToBuilderArch converts Go's GOARCH to the builder architecture string.
func goArchToBuilderArch(goArch string) string {
	switch goArch {
	case "amd64":
		return "x86_64"
	case "arm64":
		return "aarch64"
	default:
		return goArch
	}
}

// localMachineIDFromHostname generates a stable machine ID for the local host.
// Not used currently (we use the constant "local") but available for future use.
func localMachineIDFromHostname() string {
	hostname, err := os.Hostname()
	if err != nil {
		return "local"
	}
	hash := sha256.Sum256([]byte(hostname))
	return fmt.Sprintf("local-%x", hash[:8])
}
