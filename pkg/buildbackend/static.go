package buildbackend

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/securebuildhq/securebuild/pkg/builder"
	"github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// StaticBackend uses a preconfigured list of VMs via SSH.
type StaticBackend struct {
	vms []param.StaticVM
}

func NewStaticBackend(ctx context.Context) (*StaticBackend, error) {
	p := param.GetParam(ctx)
	if len(p.StaticVMs) == 0 {
		return nil, fmt.Errorf("static backend requires at least one VM in static_vms config")
	}

	// Validate VMs
	for i, vm := range p.StaticVMs {
		if vm.Host == "" {
			return nil, fmt.Errorf("static VM #%d: host is required", i)
		}
		if vm.User == "" {
			return nil, fmt.Errorf("static VM #%d: user is required", i)
		}
		if vm.SSHKeyPath == "" && vm.SSHKey == "" {
			return nil, fmt.Errorf("static VM #%d: either ssh_key_path or ssh_key must be set", i)
		}
		if vm.SSHKeyPath != "" && vm.SSHKey != "" {
			return nil, fmt.Errorf("static VM #%d: only one of ssh_key_path or ssh_key should be set", i)
		}
	}

	return &StaticBackend{vms: p.StaticVMs}, nil
}

func (b *StaticBackend) Type() BackendType {
	return BackendStatic
}

func (b *StaticBackend) SeedMachinePool(ctx context.Context) error {
	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstErr error
	successCount := 0

	for _, vm := range b.vms {
		vm := vm
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := b.seedOneStaticVM(ctx, vm)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				logger.Warn("static VM seed failed, continuing with other VMs",
					zap.String("host", vm.Host),
					zap.Error(err))
			} else {
				successCount++
			}
		}()
	}

	wg.Wait()

	if successCount == 0 && firstErr != nil {
		return fmt.Errorf("all static VMs failed to seed (e.g. %w)", firstErr)
	}
	if firstErr != nil && successCount > 0 {
		logger.Warn("some static VMs failed to seed; worker will use the ones that succeeded",
			zap.Int("succeeded", successCount),
			zap.Int("total", len(b.vms)))
	}
	return nil
}

// seedOneStaticVM seeds a single static VM: detect arch, upsert row, run InstallBuildEnv.
// Uses its own DB connection; safe to call from multiple goroutines.
func (b *StaticBackend) seedOneStaticVM(ctx context.Context, vm param.StaticVM) error {
	id := staticVMID(vm)
	port := vm.Port
	if port == 0 {
		port = 22
	}

	privateKey := vm.SSHKey
	if vm.SSHKeyPath != "" {
		privateKey = "file:" + vm.SSHKeyPath
	}

	builderVM := types.BuilderVM{
		ID:         id,
		IPAddress:  vm.Host,
		Port:       port,
		Username:   vm.User,
		PrivateKey: privateKey,
		Type:       "static",
	}

	runner, err := NewRunner(ctx, builderVM)
	if err != nil {
		return fmt.Errorf("connect for arch detection: %w", err)
	}

	out, err := runner.RunCommand(ctx, "uname -m")
	runner.Close()
	if err != nil {
		return fmt.Errorf("run uname: %w", err)
	}

	arch := parseUnameToArch(strings.TrimSpace(out))
	if arch == "" {
		return fmt.Errorf("unsupported architecture %q (uname -m)", out)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Skip re-install if machine is already in pool and running (e.g. after worker restart).
	var existingStatus string
	row := conn.QueryRow(ctx, `SELECT status FROM machine_pool WHERE id = $1`, id)
	if err := row.Scan(&existingStatus); err == nil && existingStatus == "running" {
		logger.Debug("static VM already running, skipping re-install",
			zap.String("id", id),
			zap.String("host", vm.Host),
			zap.String("architecture", arch))
		// Still update ip_address, port, etc. in case they changed, but leave status as running.
		_, _ = conn.Exec(ctx, `
			INSERT INTO machine_pool (id, machine_id, created_at, private_key, username, status, ip_address, port, architecture, is_on_demand, type)
			VALUES ($1, $2, $3, $4, $5, 'running', $6, $7, $8, $9, $10)
			ON CONFLICT (id) DO UPDATE SET
				ip_address = EXCLUDED.ip_address,
				port = EXCLUDED.port,
				username = EXCLUDED.username,
				private_key = EXCLUDED.private_key,
				architecture = EXCLUDED.architecture
		`, id, staticMachineID(vm), time.Now().UTC(), privateKey, vm.User, vm.Host, port, arch, false, "static")
		return nil
	}

	query := `
		INSERT INTO machine_pool (id, machine_id, created_at, private_key, username, status, ip_address, port, architecture, is_on_demand, type)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (id) DO UPDATE SET
			ip_address = EXCLUDED.ip_address,
			port = EXCLUDED.port,
			username = EXCLUDED.username,
			private_key = EXCLUDED.private_key,
			architecture = EXCLUDED.architecture,
			status = EXCLUDED.status,
			type = EXCLUDED.type
	`
	_, err = conn.Exec(ctx, query,
		id,
		staticMachineID(vm),
		time.Now().UTC(),
		privateKey,
		vm.User,
		"installing",
		vm.Host,
		port,
		arch,
		false,
		"static",
	)
	if err != nil {
		return fmt.Errorf("insert/update machine_pool: %w", err)
	}

	logger.Info("detected static VM architecture, installing build env",
		zap.String("id", id),
		zap.String("host", vm.Host),
		zap.String("architecture", arch))

	if err := builder.InstallBuildEnv(ctx, id); err != nil {
		return fmt.Errorf("install build env: %w", err)
	}

	logger.Info("seeded static VM in pool",
		zap.String("id", id),
		zap.String("host", vm.Host),
		zap.String("architecture", arch))
	return nil
}

// parseUnameToArch maps uname -m output to our architecture names (x86_64 or aarch64).
func parseUnameToArch(uname string) string {
	switch strings.ToLower(uname) {
	case "x86_64", "amd64":
		return "x86_64"
	case "aarch64", "arm64":
		return "aarch64"
	default:
		return ""
	}
}

func (b *StaticBackend) AvailableArchitectures(ctx context.Context) ([]string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	rows, err := conn.Query(ctx, `SELECT DISTINCT architecture FROM machine_pool WHERE type = 'static' AND status = 'running' AND architecture IS NOT NULL AND architecture != ''`)
	if err != nil {
		return nil, fmt.Errorf("query static VM architectures: %w", err)
	}
	defer rows.Close()

	var arches []string
	for rows.Next() {
		var arch string
		if err := rows.Scan(&arch); err != nil {
			return nil, fmt.Errorf("scan architecture: %w", err)
		}
		arches = append(arches, arch)
	}
	return arches, rows.Err()
}

func (b *StaticBackend) AcquireBuildMachine(ctx context.Context, opts AcquireOptions) (*BuildMachine, error) {
	maxParallel := getMaxParallelBuildsFromCtx(ctx)

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	rows, err := conn.Query(ctx, `
		SELECT id, ip_address, port, username, private_key, architecture
		FROM machine_pool
		WHERE type = 'static' AND status = 'running' AND architecture = $1
	`, opts.Architecture)
	if err != nil {
		return nil, fmt.Errorf("query static VMs: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id, ipAddress, username, privateKey, architecture string
		var portNull sql.NullInt32
		if err := rows.Scan(&id, &ipAddress, &portNull, &username, &privateKey, &architecture); err != nil {
			return nil, fmt.Errorf("scan static VM: %w", err)
		}
		port := 22
		if portNull.Valid {
			port = int(portNull.Int32)
		}

		builderVM := types.BuilderVM{
			ID:           id,
			IPAddress:    ipAddress,
			Port:         port,
			PrivateKey:   privateKey,
			Username:     username,
			Status:       "running",
			Architecture: architecture,
			Type:         "static",
		}
		home, err := builder.GetRemoteHome(ctx, builderVM)
		if err != nil {
			logger.Warn("failed to get remote HOME for static VM", zap.String("id", id), zap.Error(err))
			continue
		}
		workDir := fmt.Sprintf("%s/builds/%s-%s", home, opts.TaskID, opts.Architecture)

		// Atomically check capacity and insert assignment
		if err := builder.InsertMachineAssignmentIfCapacity(ctx, id, opts.TaskType, opts.TaskID, workDir, maxParallel); err != nil {
			if err == builder.ErrMachineAtCapacity {
				continue
			}
			logger.Warn("failed to insert assignment for static VM", zap.String("id", id), zap.Error(err))
			continue
		}

		logger.Debug("static backend acquired VM",
			zap.String("id", id),
			zap.String("host", ipAddress),
			zap.String("workDir", workDir),
			zap.String("taskType", opts.TaskType),
			zap.String("taskID", opts.TaskID))

		return &BuildMachine{
			ID:          id,
			VM:          builderVM,
			WorkDir:     workDir,
			BackendType: BackendStatic,
		}, nil
	}

	return nil, fmt.Errorf("no static VM available for architecture %s", opts.Architecture)
}

// staticVMID returns a stable ID for a static VM based on its host and port.
func staticVMID(vm param.StaticVM) string {
	port := vm.Port
	if port == 0 {
		port = 22
	}
	input := fmt.Sprintf("%s:%d", vm.Host, port)
	hash := sha256.Sum256([]byte(input))
	return fmt.Sprintf("static-%x", hash[:8])
}

// staticMachineID returns a sha256 of the host (matching the proposal spec).
func staticMachineID(vm param.StaticVM) string {
	hash := sha256.Sum256([]byte(vm.Host))
	return fmt.Sprintf("%x", hash[:16])
}
