package builder

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math/rand"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mikesmitty/edkey"
	"github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/dynamicparam"
	"github.com/securebuildhq/securebuild/pkg/execution"
	executiontypes "github.com/securebuildhq/securebuild/pkg/execution/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
	"golang.org/x/crypto/ssh"
)

// httpClient is a properly configured HTTP client with timeouts and connection limits
// to prevent connection leaks
var httpClient = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
		DisableKeepAlives:   false,
	},
}

// KeepAliveSSHClient wraps an SSH client and manages the keep-alive goroutine lifecycle.
// When Close() is called, it cancels the keep-alive goroutine before closing the connection.
type KeepAliveSSHClient struct {
	*ssh.Client
	cancel context.CancelFunc
}

// Close cancels the keep-alive goroutine and closes the SSH connection
func (c *KeepAliveSSHClient) Close() error {
	c.cancel()
	return c.Client.Close()
}

// Termination reasons for machine pool history
const (
	TerminationReasonExcess         = "excess"
	TerminationReasonExpired        = "expired"
	TerminationReasonError          = "error"
	TerminationReasonNotFound       = "not_found"
	TerminationReasonManualDeletion = "manual_deletion"
	TerminationReasonNoArchitecture = "no_architecture"
	TerminationReasonInterrupted    = "interrupted"
	TerminationReasonTaskCompleted  = "task_completed"
	TerminationReasonBuildEnvFailed = "build_env_failed"
	TerminationReasonTaskFailed     = "task_failed"
	TerminationReasonOrphaned       = "orphaned"
)

var (
	poolX86          = []types.BuilderVM{}
	poolARM          = []types.BuilderVM{}
	vmAvailableX86Ch = make(chan struct{}, 1)
	vmAvailableARMCh = make(chan struct{}, 1)
	muX86            sync.Mutex
	muARM            sync.Mutex
	assignMutex      sync.Mutex
)

// VMContext tracks the current state and last operations for debugging
type VMContext struct {
	VMID           string
	LastCommand    string
	LastStdout     string
	LastStderr     string
	FailureDetails string
	mutex          sync.RWMutex
}

// Global VM context tracking
var (
	vmContexts      = make(map[string]*VMContext)
	vmContextsMutex sync.RWMutex
)

// GetVMContext gets or creates a VM context for tracking
func GetVMContext(vmID string) *VMContext {
	vmContextsMutex.Lock()
	defer vmContextsMutex.Unlock()

	if ctx, exists := vmContexts[vmID]; exists {
		return ctx
	}

	ctx := &VMContext{
		VMID: vmID,
	}
	vmContexts[vmID] = ctx
	return ctx
}

// UpdateLastCommand updates the last command executed on this VM
func (ctx *VMContext) UpdateLastCommand(command string) {
	ctx.mutex.Lock()
	defer ctx.mutex.Unlock()
	ctx.LastCommand = command
	// Clear previous output when starting new command
	ctx.LastStdout = ""
	ctx.LastStderr = ""
}

// AppendStdout appends to the stdout buffer (keeping last 2KB)
func (ctx *VMContext) AppendStdout(output string) {
	ctx.mutex.Lock()
	defer ctx.mutex.Unlock()
	ctx.LastStdout += output + "\n"
	// Keep only last 2KB to prevent memory issues
	if len(ctx.LastStdout) > 2048 {
		ctx.LastStdout = "...(truncated)...\n" + ctx.LastStdout[len(ctx.LastStdout)-1800:]
	}
}

// AppendStderr appends to the stderr buffer (keeping last 2KB)
func (ctx *VMContext) AppendStderr(output string) {
	ctx.mutex.Lock()
	defer ctx.mutex.Unlock()
	ctx.LastStderr += output + "\n"
	// Keep only last 2KB to prevent memory issues
	if len(ctx.LastStderr) > 2048 {
		ctx.LastStderr = "...(truncated)...\n" + ctx.LastStderr[len(ctx.LastStderr)-1800:]
	}
}

// SetFailureDetails sets additional failure context
func (ctx *VMContext) SetFailureDetails(details string) {
	ctx.mutex.Lock()
	defer ctx.mutex.Unlock()
	ctx.FailureDetails = details
}

// GetDebugInfo returns all debug information
func (ctx *VMContext) GetDebugInfo() (command, stdout, stderr, details string) {
	ctx.mutex.RLock()
	defer ctx.mutex.RUnlock()
	return ctx.LastCommand, ctx.LastStdout, ctx.LastStderr, ctx.FailureDetails
}

// CleanupVMContext removes VM context when VM is deleted
func CleanupVMContext(vmID string) {
	vmContextsMutex.Lock()
	defer vmContextsMutex.Unlock()
	delete(vmContexts, vmID)
}

func deleteInstallingBuilders(ctx context.Context) error {
	conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
	if err != nil {
		logger.Warn("failed to get database connection for deleting installing builders", zap.Error(err))
		return err // Return error but don't panic - this is startup cleanup
	}
	defer conn.Release()

	query := `select id from machine_pool where status = 'installing'`
	rows, err := conn.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to query installing machines: %w", err)
	}
	defer rows.Close()

	var deletedCount int
	for rows.Next() {
		var vmID string
		err = rows.Scan(&vmID)
		if err != nil {
			logger.Error(fmt.Errorf("failed to scan machine ID: %w", err))
			continue
		}

		logger.Info("deleting interrupted builder in installing status", zap.String("vmID", vmID))
		if err := DeleteVMWithReason(ctx, vmID, TerminationReasonInterrupted); err != nil {
			logger.Error(fmt.Errorf("failed to delete installing VM: %w", err))
			continue
		}
		deletedCount++
	}

	if deletedCount > 0 {
		logger.Info("deleted interrupted builders", zap.Int("count", deletedCount))
	}

	return nil
}

// listCMXVMIDs returns the set of VM IDs that currently exist in CMX. It calls
// the GET /v3/vms endpoint and collects the "id" (short ID) of every returned VM.
func listCMXVMIDs(ctx context.Context) (map[string]bool, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/v3/vms", param.GetParam(ctx).ReplicatedAPIOrigin), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create list VMs request: %w", err)
	}

	req.Header.Set("Authorization", param.GetParam(ctx).ReplicatedAPIToken)
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to list VMs from CMX: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read list VMs response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("list VMs returned unexpected status %d: %s", resp.StatusCode, string(body))
	}

	type listVMsResponse struct {
		VMs []types.CMXVM `json:"vms"`
	}

	var response listVMsResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("failed to unmarshal list VMs response: %w", err)
	}

	ids := make(map[string]bool, len(response.VMs))
	for _, vm := range response.VMs {
		ids[vm.ID] = true
	}
	return ids, nil
}

// deleteOrphanedMachines removes machine_pool rows whose VM no longer exists in
// CMX, regardless of their local status. This reclaims builders left behind by
// crashed/restarted workers: those rows are owned by a machine_id that no running
// worker reconciles, so the per-machine_id pool sizing never trims them and
// expired-machines cleanup can't touch rows with expires_at IS NULL.
//
// Safety: if the CMX list call fails for any reason, this function returns the
// error and deletes nothing. An empty VM list is treated as an error rather than
// "delete everything", so a transient API outage can never wipe the pool.
func deleteOrphanedMachines(ctx context.Context) error {
	if param.GetParam(ctx).BuildBackend != "cmx" {
		return nil
	}

	cmxVMIDs, err := listCMXVMIDs(ctx)
	if err != nil {
		return fmt.Errorf("failed to list CMX VMs, skipping orphan cleanup: %w", err)
	}

	if len(cmxVMIDs) == 0 {
		logger.Warn("CMX returned zero VMs, skipping orphan cleanup to avoid deleting live builders")
		return nil
	}

	conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
	if err != nil {
		logger.Warn("failed to get database connection for orphaned machine cleanup", zap.Error(err))
		return err
	}
	defer conn.Release()

	query := `select id from machine_pool where type = 'cmx'`
	rows, err := conn.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to query machine pool for orphan check: %w", err)
	}
	defer rows.Close()

	var orphanedIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			logger.Error(fmt.Errorf("failed to scan machine ID for orphan check: %w", err))
			continue
		}
		if !cmxVMIDs[id] {
			orphanedIDs = append(orphanedIDs, id)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed iterating machine pool rows for orphan check: %w", err)
	}

	if len(orphanedIDs) == 0 {
		return nil
	}

	logger.Info("found orphaned machines not present in CMX",
		zap.Int("count", len(orphanedIDs)),
		zap.Int("cmxVMCount", len(cmxVMIDs)))

	for _, vmID := range orphanedIDs {
		logger.Info("deleting orphaned machine not present in CMX", zap.String("vmID", vmID))
		if err := DeleteVMWithReason(ctx, vmID, TerminationReasonOrphaned); err != nil {
			logger.Error(fmt.Errorf("failed to delete orphaned VM %s: %w", vmID, err))
			continue
		}
	}

	return nil
}

func deleteMachinesWithoutArchitecture(ctx context.Context) error {
	conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
	if err != nil {
		logger.Warn("failed to get database connection for deleting machines without architecture", zap.Error(err))
		return err // Return error but don't panic - this is startup cleanup
	}
	defer conn.Release()

	query := `select id from machine_pool where architecture is null`
	rows, err := conn.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to query machines without architecture: %w", err)
	}
	defer rows.Close()

	var deletedCount int
	for rows.Next() {
		var vmID string
		err = rows.Scan(&vmID)
		if err != nil {
			logger.Error(fmt.Errorf("failed to scan machine ID: %w", err))
			continue
		}

		logger.Info("deleting machine without architecture", zap.String("vmID", vmID))
		if err := DeleteVMWithReason(ctx, vmID, TerminationReasonNoArchitecture); err != nil {
			logger.Error(fmt.Errorf("failed to delete VM without architecture: %w", err))
			continue
		}
		deletedCount++
	}

	if deletedCount > 0 {
		logger.Info("deleted machines without architecture", zap.Int("count", deletedCount))
	}

	return nil
}

func CreatePool(ctx context.Context) error {
	if err := deleteInstallingBuilders(ctx); err != nil {
		logger.Error(fmt.Errorf("failed to delete installing builders: %w", err))
	}

	if err := deleteOrphanedMachines(ctx); err != nil {
		logger.Error(fmt.Errorf("failed to delete orphaned machines: %w", err))
	}

	if err := deleteMachinesWithoutArchitecture(ctx); err != nil {
		logger.Error(fmt.Errorf("failed to delete machines without architecture: %w", err))
	}

	machineID, err := GetMachineID()
	if err != nil {
		return fmt.Errorf("failed to get machine ID: %w", err)
	}

	targetPoolSize := param.GetParam(ctx).PoolSize

	// Handle initial pool sizing for both architectures
	for _, arch := range []string{"x86_64", "aarch64"} {
		currentCount, err := countVMsByArchitecture(ctx, machineID, arch)
		if err != nil {
			logger.Error(fmt.Errorf("failed to count VMs for %s: %w", arch, err))
			continue
		}

		if currentCount > targetPoolSize {
			// Delete excess VMs
			excessCount := currentCount - targetPoolSize
			logger.Info("initial deprovisioning of excess VMs",
				zap.String("architecture", arch),
				zap.Int("excess", excessCount),
				zap.Int("current", currentCount),
				zap.Int("target", targetPoolSize))

			vmsToDelete, err := getVMsByArchitectureForDeletion(ctx, machineID, arch, excessCount)
			if err != nil {
				logger.Error(fmt.Errorf("failed to get VMs for deletion: %w", err))
				continue
			}

			for _, vm := range vmsToDelete {
				logger.Info("deleting excess VM", zap.String("vmID", vm.ID), zap.String("architecture", arch), zap.String("status", vm.Status))
				if err := DeleteVMWithReason(ctx, vm.ID, TerminationReasonExcess); err != nil {
					logger.Error(fmt.Errorf("failed to delete excess VM: %w", err))
				}
			}
		} else if currentCount < targetPoolSize {
			// Provision new VMs
			for i := currentCount; i < targetPoolSize; i++ {
				_, err := provisionVM(ctx, machineID, arch, 0, false)
				if err != nil {
					logger.Error(fmt.Errorf("failed to provision VM for %s: %w", arch, err))
					continue
				}
			}
		}
	}

	// Start background maintenance goroutine
	go func(machineID string) {
		maintenanceInterval := time.NewTicker(5 * time.Second)
		uptimeInterval := time.NewTicker(10 * time.Second)

		for {
			select {
			case <-ctx.Done():
				logger.Info("pool maintenance goroutine exiting", zap.String("machineID", machineID))
				return

			case <-maintenanceInterval.C:
				// Clean up expired machines
				if err := deleteExpiredMachines(ctx); err != nil {
					logger.Error(err)
				}

				// Clean up machines whose VM no longer exists in CMX
				if err := deleteOrphanedMachines(ctx); err != nil {
					logger.Error(err)
				}

				// Clean up stale cleanup locks
				if err := cleanupStaleLocks(ctx); err != nil {
					logger.Error(err)
				}
				// Check and update VM statuses
				machines, err := listMachines(ctx, machineID)
				if err != nil {
					logger.Error(err)
					continue
				}

				for _, machine := range machines {
					if err := checkAndUpdateVMStatus(ctx, machine.ID); err != nil {
						logger.Error(err)
						continue
					}
				}

				// Handle pool size changes
				targetPoolSize := param.GetParam(ctx).PoolSize
				for _, arch := range []string{"x86_64", "aarch64"} {
					currentCount, err := countVMsByArchitecture(ctx, machineID, arch)
					if err != nil {
						logger.Error(fmt.Errorf("failed to count VMs for %s: %w", arch, err))
						continue
					}

					if currentCount > targetPoolSize {
						// Delete excess VMs
						excessCount := currentCount - targetPoolSize
						logger.Info("deprovisioning excess VMs",
							zap.String("architecture", arch),
							zap.Int("excess", excessCount),
							zap.Int("current", currentCount),
							zap.Int("target", targetPoolSize))

						vmsToDelete, err := getVMsByArchitectureForDeletion(ctx, machineID, arch, excessCount)
						if err != nil {
							logger.Error(fmt.Errorf("failed to get VMs for deletion: %w", err))
							continue
						}

						for _, vm := range vmsToDelete {
							logger.Info("deleting excess VM", zap.String("vmID", vm.ID), zap.String("architecture", arch), zap.String("status", vm.Status))
							if err := DeleteVMWithReason(ctx, vm.ID, TerminationReasonExcess); err != nil {
								logger.Error(fmt.Errorf("failed to delete excess VM: %w", err))
							}
						}
					} else if currentCount < targetPoolSize {
						// Provision new VMs
						for i := currentCount; i < targetPoolSize; i++ {
							_, err := provisionVM(ctx, machineID, arch, 0, false)
							if err != nil {
								logger.Error(fmt.Errorf("failed to provision VM for %s: %w", arch, err))
								break // Don't spam provision attempts if they're failing
							}
						}
					}
				}

			case <-uptimeInterval.C:
				// Update uptime for all running machines
				machines, err := listMachines(ctx, machineID)
				if err != nil {
					logger.Error(err)
					continue
				}

				for _, machine := range machines {
					if machine.Status == "running" && machine.IPAddress != "" {
						go func(vm types.BuilderVM) {
							uptime, err := getUptimeViaSSH(ctx, vm)
							if err != nil {
								logger.Debug("failed to get uptime via SSH", zap.String("vmID", vm.ID), zap.Error(err))
								return
							}

							if err := UpdateMachineUptime(ctx, vm.ID, uptime); err != nil {
								logger.Error(fmt.Errorf("failed to update machine uptime for VM %s: %w", vm.ID, err))
								return
							}

							logger.Trace("updated machine uptime", zap.String("vmID", vm.ID), zap.String("uptime", uptime))
						}(machine)
					}
				}
			}
		}
	}(machineID)

	return nil
}

func checkAndUpdateVMStatus(ctx context.Context, vmID string) error {
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/v3/vm/%s", param.GetParam(ctx).ReplicatedAPIOrigin, vmID), nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", param.GetParam(ctx).ReplicatedAPIToken)
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		logger.Warn("vm not found", zap.String("vmID", vmID))

		// Archive to history before deletion
		if err := archiveMachineToHistory(ctx, vmID, TerminationReasonNotFound); err != nil {
			logger.Warn("failed to archive machine to history", zap.String("vmID", vmID), zap.Error(err))
		}

		conn := persistence.MustGetPooledPostgresSession(ctx)
		defer conn.Release()

		query := `delete from machine_pool where id = $1`
		_, err = conn.Exec(ctx, query, vmID)
		if err != nil {
			return fmt.Errorf("failed to delete machine from database: %w", err)
		}
		return nil
	}

	if resp.StatusCode == http.StatusUnauthorized {
		logger.Warn("unauthorized (check if api token is valid)", zap.String("vmID", vmID))
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode == http.StatusBadRequest {
		logger.Warn("bad request", zap.String("vmID", vmID), zap.String("response", string(body)))
		return nil
	}

	type getVMResponse struct {
		VM types.CMXVM `json:"vm"`
	}

	var response getVMResponse
	err = json.Unmarshal(body, &response)
	if err != nil {
		return fmt.Errorf("failed to unmarshal response body: %w", err)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id, user_id from buildadmin_session`
	rows, err := conn.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to get session: %w", err)
	}
	defer rows.Close()
	sessionIDUserIDMap := map[string]string{}
	for rows.Next() {
		var sessionID string
		var userID string
		err = rows.Scan(&sessionID, &userID)
		if err != nil {
			return fmt.Errorf("failed to scan session: %w", err)
		}
		sessionIDUserIDMap[sessionID] = userID
	}

	if response.VM.Status == "error" {
		logger.Warn("vm is in status: error", zap.String("vmID", vmID), zap.String("status", response.VM.Status))

		// Archive to history before deletion
		if err := archiveMachineToHistory(ctx, vmID, TerminationReasonError); err != nil {
			logger.Warn("failed to archive machine to history", zap.String("vmID", vmID), zap.Error(err))
		}

		query := `delete from machine_pool where id = $1`
		_, err = conn.Exec(ctx, query, vmID)
		if err != nil {
			return fmt.Errorf("failed to delete machine from database: %w", err)
		}
	} else if response.VM.Status == "running" {
		// if our internal status is not "installing" or "running" we just advance to the installing state
		lastVMState, err := getMachine(ctx, vmID)
		if err != nil {
			if err == ErrMachineNotFound {
				// Archive to history and remove the machine from the pool
				if err := archiveMachineToHistory(ctx, vmID, TerminationReasonNotFound); err != nil {
					logger.Warn("failed to archive machine to history", zap.String("vmID", vmID), zap.Error(err))
				}

				query := `delete from machine_pool where id = $1`
				_, err = conn.Exec(ctx, query, vmID)
				if err != nil {
					return fmt.Errorf("failed to delete machine from database: %w", err)
				}
				return nil
			}
			return fmt.Errorf("failed to get machine: %w", err)
		}

		if lastVMState.Status != "installing" && lastVMState.Status != "running" {
			query := `update machine_pool set status = $1, ip_address = $2, port = $3, expires_at = $4 where id = $5`
			_, err = conn.Exec(ctx, query, "installing", response.VM.IPAddress, response.VM.Port, response.VM.ExpiresAt, vmID)
			if err != nil {
				return fmt.Errorf("failed to update machine status: %w", err)
			}

			go func() {
				if err := InstallBuildEnv(ctx, vmID); err != nil {
					logger.Error(fmt.Errorf("build environment setup failed for VM %s, deleting for reprovisioning: %w", vmID, err))

					// Delete the VM so it gets reprovisioned automatically
					if deleteErr := DeleteVMWithReason(ctx, vmID, TerminationReasonBuildEnvFailed); deleteErr != nil {
						logger.Error(fmt.Errorf("failed to delete VM %s after build env setup failure: %w", vmID, deleteErr))
					}
				}
			}()

			lastVMState.Status = "installing"
		}
	} else {
		lastVMState, err := getMachine(ctx, vmID)
		if err != nil {
			if err == ErrMachineNotFound {
				// Archive to history and remove the machine from the pool
				if err := archiveMachineToHistory(ctx, vmID, TerminationReasonNotFound); err != nil {
					logger.Warn("failed to archive machine to history", zap.String("vmID", vmID), zap.Error(err))
				}

				query := `delete from machine_pool where id = $1`
				_, err = conn.Exec(ctx, query, vmID)
				if err != nil {
					return fmt.Errorf("failed to delete machine from database: %w", err)
				}
				return nil
			}
			return fmt.Errorf("failed to get machine: %w", err)
		}

		query := `update machine_pool set status = $1 where id = $2`
		_, err = conn.Exec(ctx, query, response.VM.Status, vmID)
		if err != nil {
			return fmt.Errorf("failed to update machine status: %w", err)
		}

		lastVMState.Status = response.VM.Status

		if response.VM.Status == "running" {
			// Signal the appropriate channel based on architecture
			switch lastVMState.Architecture {
			case "x86_64":
				select {
				case vmAvailableX86Ch <- struct{}{}:
				default:
				}
			case "aarch64":
				select {
				case vmAvailableARMCh <- struct{}{}:
				default:
				}
			}
		}
	}
	return nil
}

// InstallBuildEnv installs required build tools on a VM (melange, apko, grype, syft, docker, signing keys, builder binary, etc.).
// The machine must exist in machine_pool with status "installing".
// Used by CMX (after provision), static backend (on seed), and local backend (after seed inserts the row).
func InstallBuildEnv(ctx context.Context, vmID string) error {
	logger.Trace("installing build env", zap.String("vmID", vmID))

	vm, err := getMachine(ctx, vmID)
	if err != nil {
		return fmt.Errorf("failed to get machine %s: %w", vmID, err)
	}

	if vm.Status != "installing" {
		return fmt.Errorf("machine %s is not in installing state, current status: %s", vmID, vm.Status)
	}

	homeDir, err := GetRemoteHome(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get remote home for VM %s: %w", vmID, err)
	}

	// Put the cve0 signing key in the machine
	{
		if err := getSigningKeys(ctx, vm, homeDir); err != nil {
			return fmt.Errorf("failed to put signing keys on VM %s: %w", vmID, err)
		}
	}

	// Install basic deps
	{
		if err := installBasicDeps(ctx, vm); err != nil {
			return fmt.Errorf("failed to install basic deps on VM %s: %w", vmID, err)
		}
	}

	// install melange
	{
		if err := installMelange(ctx, vm); err != nil {
			return fmt.Errorf("failed to install melange on VM %s: %w", vmID, err)
		}
	}

	// install apko
	{
		if err := installApko(ctx, vm); err != nil {
			return fmt.Errorf("failed to install apko on VM %s: %w", vmID, err)
		}
	}

	// Install grype
	{
		if err := installGrype(ctx, vm); err != nil {
			return fmt.Errorf("failed to install grype on VM %s: %w", vmID, err)
		}
	}

	// Install syft
	{
		if err := installSyft(ctx, vm); err != nil {
			return fmt.Errorf("failed to install syft on VM %s: %w", vmID, err)
		}
	}

	// Install Docker
	{
		if err := installDocker(ctx, vm); err != nil {
			return fmt.Errorf("failed to install docker on VM %s: %w", vm.ID, err)
		}
	}

	// Configure SSH MaxSessions for CMX VMs to allow many concurrent
	// poller sessions for scan result collection.
	{
		if err := configureSSHMaxSessions(ctx, vm); err != nil {
			logger.Warn("failed to configure SSH MaxSessions, proceeding with default",
				zap.String("vmID", vmID),
				zap.Error(err))
		}
	}

	// generate local melange key
	{
		if err := generateLocalMelangeKey(ctx, vm, homeDir); err != nil {
			return fmt.Errorf("failed to generate local melange key on VM %s: %w", vmID, err)
		}
	}

	// copy the builder binary
	{
		if err := copyBuilderBinary(ctx, vm, homeDir); err != nil {
			return fmt.Errorf("failed to copy builder binary to VM %s: %w", vmID, err)
		}
	}

	// Copy build env files
	if err := copyBuildEnvFiles(ctx, vm, homeDir); err != nil {
		return fmt.Errorf("failed to copy build env files to VM %s: %w", vmID, err)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `update machine_pool set status = $1 where id = $2`
	_, err = conn.Exec(ctx, query, "running", vmID)
	if err != nil {
		return fmt.Errorf("failed to update machine %s status to running: %w", vmID, err)
	}

	// Check if this is an on-demand VM with an assigned task
	if vm.IsOnDemand && vm.AssignedTaskType == "build_package" && vm.AssignedTaskID != "" {
		// Check if both VMs for this execution are ready
		executionID := vm.AssignedTaskID

		// Query execution table to get both builder IDs and package info
		execQuery := `
			SELECT x86_64_builder_id, aarch64_builder_id, package_id, package_version_id
			FROM execution
			WHERE id = $1
		`
		var x86BuilderID, aarch64BuilderID sql.NullString
		var packageID, packageVersionID string
		err := conn.QueryRow(ctx, execQuery, executionID).Scan(&x86BuilderID, &aarch64BuilderID, &packageID, &packageVersionID)
		if err != nil {
			logger.Warn("failed to get execution for on-demand VM readiness check",
				zap.String("executionID", executionID),
				zap.Error(err))
		} else if x86BuilderID.Valid && aarch64BuilderID.Valid {
			// Both builder IDs are set, check if the other VM is also ready
			x86VM, err := getMachine(ctx, x86BuilderID.String)
			if err != nil {
				logger.Warn("failed to get x86 VM for readiness check",
					zap.String("vmID", x86BuilderID.String),
					zap.Error(err))
			} else {
				armVM, err := getMachine(ctx, aarch64BuilderID.String)
				if err != nil {
					logger.Warn("failed to get arm VM for readiness check",
						zap.String("vmID", aarch64BuilderID.String),
						zap.Error(err))
				} else if x86VM.Status == "running" && armVM.Status == "running" {
					// Both VMs are ready, update execution status and queue build
					if err := execution.UpdateExecutionStatus(ctx, executionID, executiontypes.ExecutionStatusQueued); err != nil {
						logger.Error(fmt.Errorf("failed to update execution status to queued: executionID=%s, error=%w", executionID, err))
					} else {
						// Queue build_package_with_vms_assigned event
						payload := map[string]interface{}{
							"packageId":        packageID,
							"packageVersionId": packageVersionID,
							"x86VMID":          x86VM.ID,
							"armVMID":          armVM.ID,
							"executionId":      executionID,
						}

						marshalledPayload, err := json.Marshal(payload)
						if err != nil {
							logger.Error(fmt.Errorf("failed to marshal build package with vms assigned payload: executionID=%s, error=%w", executionID, err))
						} else {
							if err := persistence.EnqueueWork(ctx, "build_package_with_vms_assigned", string(marshalledPayload)); err != nil {
								logger.Error(fmt.Errorf("failed to enqueue build package with vms assigned: executionID=%s, error=%w", executionID, err))
							} else {
								logger.Info("both on-demand VMs ready, queued build",
									zap.String("executionID", executionID),
									zap.String("x86VMID", x86VM.ID),
									zap.String("armVMID", armVM.ID))
							}
						}
					}
				}
			}
		}
	}

	// Signal the appropriate channel based on architecture
	switch vm.Architecture {
	case "x86_64":
		select {
		case vmAvailableX86Ch <- struct{}{}:
		default:
		}
	case "aarch64":
		select {
		case vmAvailableARMCh <- struct{}{}:
		default:
		}
	}

	return nil
}

func copyBuilderBinary(ctx context.Context, vm types.BuilderVM, homeDir string) error {
	logger.Trace("copying builder binary", zap.String("vmID", vm.ID), zap.String("ipAddress", vm.IPAddress), zap.Int("port", vm.Port), zap.String("architecture", vm.Architecture))

	// Check if builder is embedded for this architecture
	if !IsBuilderEmbedded(vm.Architecture) {
		return fmt.Errorf("builder binary is not embedded for architecture %s", vm.Architecture)
	}

	// Get the embedded builder binary for the specific architecture
	builderData := GetEmbeddedBuilder(vm.Architecture)
	if len(builderData) == 0 {
		return fmt.Errorf("embedded builder binary is empty for architecture %s", vm.Architecture)
	}

	if vm.Type == "local" {
		return localCopyBuilderBinary(homeDir, vm.Architecture, vm.ID)
	}

	logger.Trace("embedded builder binary info",
		zap.String("vmID", vm.ID),
		zap.String("architecture", vm.Architecture),
		zap.Int("size", len(builderData)))

	// Get SSH client
	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	// Check if builder already exists and remove it
	builderPath := homeDir + "/builder"
	logger.Debug("Checking for existing builder binary", zap.String("vmID", vm.ID))
	existingCheckCmd := fmt.Sprintf("ls -la %q || echo \"No existing builder found\"", builderPath)

	existingStdoutCh := make(chan string)
	existingStderrCh := make(chan string)
	var existingWg sync.WaitGroup
	existingWg.Add(2)
	go func() {
		defer existingWg.Done()
		for line := range existingStdoutCh {
			logger.Debug("existing builder check stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer existingWg.Done()
		for line := range existingStderrCh {
			logger.Debug("existing builder check stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	if err := RunCommand(ctx, client.Client, vm.ID, existingCheckCmd, existingStdoutCh, existingStderrCh); err != nil {
		logger.Warn("failed to check for existing builder", zap.String("vmID", vm.ID), zap.Error(err))
	}
	existingWg.Wait()

	// Remove existing builder to ensure clean deployment
	removeCmd := fmt.Sprintf("rm -f %q", builderPath)
	removeStdoutCh := make(chan string)
	removeStderrCh := make(chan string)
	var removeWg sync.WaitGroup
	removeWg.Add(2)
	go func() {
		defer removeWg.Done()
		for line := range removeStdoutCh {
			logger.Debug("remove builder stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer removeWg.Done()
		for line := range removeStderrCh {
			logger.Debug("remove builder stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	if err := RunCommand(ctx, client.Client, vm.ID, removeCmd, removeStdoutCh, removeStderrCh); err != nil {
		logger.Warn("failed to remove existing builder", zap.String("vmID", vm.ID), zap.Error(err))
	}
	removeWg.Wait()

	// Copy the builder binary to the remote machine
	logger.Debug("Deploying new builder binary", zap.String("vmID", vm.ID), zap.Int("size", len(builderData)))
	if err := CreateRemoteBinaryFile(client.Client, builderPath, builderData); err != nil {
		return fmt.Errorf("failed to copy builder binary to VM %s: %w", vm.ID, err)
	}

	// Make the binary executable
	cmd := fmt.Sprintf("chmod +x %q", builderPath)

	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Trace("chmod stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Trace("chmod stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	err = RunCommand(ctx, client.Client, vm.ID, cmd, stdoutCh, stderrCh)
	wg.Wait()

	if err != nil {
		return fmt.Errorf("failed to make builder binary executable on VM %s: %w", vm.ID, err)
	}

	// Verify the deployment by checking the new file
	verifyCmd := fmt.Sprintf("ls -la %q && echo \"--- Builder Help ---\" && %q --help | head -10", builderPath, builderPath)
	verifyStdoutCh := make(chan string)
	verifyStderrCh := make(chan string)
	var verifyWg sync.WaitGroup
	verifyWg.Add(2)
	go func() {
		defer verifyWg.Done()
		for line := range verifyStdoutCh {
			logger.Debug("builder verification stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer verifyWg.Done()
		for line := range verifyStderrCh {
			logger.Debug("builder verification stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	if err := RunCommand(ctx, client.Client, vm.ID, verifyCmd, verifyStdoutCh, verifyStderrCh); err != nil {
		logger.Warn("failed to verify builder deployment", zap.String("vmID", vm.ID), zap.Error(err))
	}
	verifyWg.Wait()

	logger.Trace("successfully copied and set permissions for builder binary",
		zap.String("vmID", vm.ID),
		zap.String("architecture", vm.Architecture))
	return nil
}

func generateLocalMelangeKey(ctx context.Context, vm types.BuilderVM, homeDir string) error {
	if vm.Type == "local" {
		return localGenerateMelangeKeyIfNeeded(ctx, homeDir, vm.ID)
	}

	logger.Trace("generating local melange key", zap.String("vmID", vm.ID), zap.String("ipAddress", vm.IPAddress), zap.Int("port", vm.Port))

	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	cmd := fmt.Sprintf("cd %q && melange keygen local-melange.rsa", homeDir)

	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Trace("melange keygen stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Trace("melange keygen stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	err = RunCommand(ctx, client.Client, vm.ID, cmd, stdoutCh, stderrCh)
	wg.Wait()

	if err != nil {
		return fmt.Errorf("failed to generate local melange key on VM %s: %w", vm.ID, err)
	}

	return nil
}

func installBasicDeps(ctx context.Context, vm types.BuilderVM) error {
	if vm.Type == "local" {
		logger.Info("skipping apt basic deps for local build machine", zap.String("vmID", vm.ID))
		return nil
	}

	logger.Trace("installing basic deps", zap.String("vmID", vm.ID), zap.String("ipAddress", vm.IPAddress), zap.Int("port", vm.Port))

	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	cmd := `sudo apt-get update && sudo apt-get install -y curl git tar bubblewrap binfmt-support cmake`

	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Trace("apt-get stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Trace("apt-get stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	err = RunCommand(ctx, client.Client, vm.ID, cmd, stdoutCh, stderrCh)
	wg.Wait()

	if err != nil {
		return fmt.Errorf("failed to install basic deps on VM %s: %w", vm.ID, err)
	}

	return nil
}

func getSigningKeys(ctx context.Context, vm types.BuilderVM, homeDir string) error {
	if err := getCve0SigningKey(ctx, vm, homeDir); err != nil {
		return fmt.Errorf("failed to get cve0 signing key for VM %s: %w", vm.ID, err)
	}

	return nil
}

func getCve0SigningKey(ctx context.Context, vm types.BuilderVM, homeDir string) error {
	logger.Trace("getting cve0 signing key", zap.String("vmID", vm.ID), zap.String("ipAddress", vm.IPAddress), zap.Int("port", vm.Port))

	raw := param.GetParam(ctx).APKPublicKeyData
	if raw == "" {
		return fmt.Errorf("apk_public_key_data is empty for VM %s", vm.ID)
	}
	decodedSigningPublicKey, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return fmt.Errorf("failed to decode signing public key for VM %s: %w", vm.ID, err)
	}

	if vm.Type == "local" {
		path := filepath.Join(homeDir, "cve0-signing.rsa.pub")
		if err := os.WriteFile(path, decodedSigningPublicKey, 0644); err != nil {
			return fmt.Errorf("failed to write %s: %w", path, err)
		}
		logger.Debug("wrote cve0 signing public key", zap.String("vmID", vm.ID), zap.String("path", path))
		return nil
	}

	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	path := homeDir + "/cve0-signing.rsa.pub"
	if err := CreateRemoteTextFile(client.Client, path, string(decodedSigningPublicKey)); err != nil {
		return fmt.Errorf("failed to create remote text file on VM %s: %w", vm.ID, err)
	}

	return nil
}

func installApko(ctx context.Context, vm types.BuilderVM) error {
	if vm.Type == "local" {
		return localInstallApko(ctx, vm)
	}

	// Select download link based on architecture
	var apkoDownloadLink string
	var apkoDirName string
	if vm.Architecture == "aarch64" {
		apkoDownloadLink = "https://github.com/chainguard-dev/apko/releases/download/v0.27.6/apko_0.27.6_linux_arm64.tar.gz"
		apkoDirName = "apko_0.27.6_linux_arm64"
	} else {
		apkoDownloadLink = "https://github.com/chainguard-dev/apko/releases/download/v0.27.6/apko_0.27.6_linux_amd64.tar.gz"
		apkoDirName = "apko_0.27.6_linux_amd64"
	}

	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	cmd := fmt.Sprintf(`
set -e

echo "Downloading apko..."
curl -sSL %s -o apko.tar.gz
echo "Extracting apko..."
tar -xzvf apko.tar.gz
echo "Moving apko binary..."
sudo mv %s/apko /usr/bin/apko
echo "Checking apko version..."
apko version
`, apkoDownloadLink, apkoDirName)

	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Trace("apko stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Trace("apko stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	err = RunCommand(ctx, client.Client, vm.ID, cmd, stdoutCh, stderrCh)
	wg.Wait()

	if err != nil {
		return fmt.Errorf("failed to run apko install script on VM %s: %w", vm.ID, err)
	}

	return nil
}

func installMelange(ctx context.Context, vm types.BuilderVM) error {
	if vm.Type == "local" {
		return localInstallMelange(ctx, vm)
	}

	// Select download link based on architecture
	var melangeDownloadLink string
	var melangeDirName string
	if vm.Architecture == "aarch64" {
		melangeDownloadLink = "https://github.com/chainguard-dev/melange/releases/download/v0.43.3/melange_0.43.3_linux_arm64.tar.gz"
		melangeDirName = "melange_0.43.3_linux_arm64"
	} else {
		melangeDownloadLink = "https://github.com/chainguard-dev/melange/releases/download/v0.43.3/melange_0.43.3_linux_amd64.tar.gz"
		melangeDirName = "melange_0.43.3_linux_amd64"
	}

	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	cmd := fmt.Sprintf(`
set -e

echo "Downloading melange..."
curl -sSL %s -o melange.tar.gz
echo "Extracting melange..."
tar -xzvf melange.tar.gz
echo "Moving melange binary..."
sudo mv %s/melange /usr/bin/melange
echo "Checking melange version..."
melange version
`, melangeDownloadLink, melangeDirName)

	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Trace("melange stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Trace("melange stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	err = RunCommand(ctx, client.Client, vm.ID, cmd, stdoutCh, stderrCh)
	wg.Wait()

	if err != nil {
		return fmt.Errorf("failed to run melange install script on VM %s: %w", vm.ID, err)
	}

	return nil
}

func installGrype(ctx context.Context, vm types.BuilderVM) error {
	if vm.Type == "local" {
		return localInstallGrype(ctx, vm)
	}

	logger.Trace("installing grype", zap.String("vmID", vm.ID), zap.String("ipAddress", vm.IPAddress), zap.Int("port", vm.Port))

	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	cmd := `
set -e

echo "Installing grype..."
curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sudo sh -s -- -b /usr/local/bin
echo "Checking grype version..."
grype version
`

	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Trace("grype stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Trace("grype stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	err = RunCommand(ctx, client.Client, vm.ID, cmd, stdoutCh, stderrCh)
	wg.Wait()

	if err != nil {
		return fmt.Errorf("failed to install grype on VM %s: %w", vm.ID, err)
	}

	return nil
}

func installSyft(ctx context.Context, vm types.BuilderVM) error {
	if vm.Type == "local" {
		return localInstallSyft(ctx, vm)
	}

	logger.Trace("installing syft", zap.String("vmID", vm.ID), zap.String("ipAddress", vm.IPAddress), zap.Int("port", vm.Port))

	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	cmd := `
set -e

echo "Installing syft..."
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sudo sh -s -- -b /usr/local/bin
echo "Checking syft version..."
syft version
`

	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Trace("syft stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Trace("syft stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	err = RunCommand(ctx, client.Client, vm.ID, cmd, stdoutCh, stderrCh)
	wg.Wait()

	if err != nil {
		return fmt.Errorf("failed to install syft on VM %s: %w", vm.ID, err)
	}

	return nil
}

func installDocker(ctx context.Context, vm types.BuilderVM) error {
	if vm.Type == "local" {
		return localInstallDocker(ctx, vm)
	}

	logger.Debug("installing docker", zap.String("vmID", vm.ID), zap.String("ipAddress", vm.IPAddress), zap.Int("port", vm.Port))

	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	// Install Docker using the official installation script.
	// Add the current SSH user ($USER) to the docker group, not hardcoded "builder", so static VMs work.
	cmd := `
set -e
if docker version; then
  echo "Docker already installed, skipping."
  exit 0
fi

echo "Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

echo "Adding current user to docker group..."
sudo usermod -aG docker "$USER"

echo "Starting Docker service..."
sudo systemctl start docker
sudo systemctl enable docker

echo "Verifying Docker installation..."
sudo docker --version
`

	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Debug("docker stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Debug("docker stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	err = RunCommand(ctx, client.Client, vm.ID, cmd, stdoutCh, stderrCh)
	wg.Wait()

	if err != nil {
		return fmt.Errorf("failed to install docker on VM %s: %w", vm.ID, err)
	}

	return nil
}

// configureSSHMaxSessions raises MaxSessions on CMX builder VMs so the
// scan poller can open many concurrent SSH sessions (for reading grype
// results, cleaning up scan dirs, etc.) without hitting the default
// limit of 10. Local and static VMs are skipped.
func configureSSHMaxSessions(ctx context.Context, vm types.BuilderVM) error {
	if vm.Type == "local" {
		return nil
	}

	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	cmd := `sudo sed -i 's/^#\?MaxSessions.*/MaxSessions 500/' /etc/ssh/sshd_config && sudo systemctl restart sshd`

	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Debug("configure MaxSessions stdout", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Debug("configure MaxSessions stderr", zap.String("vmID", vm.ID), zap.String("output", line))
		}
	}()

	err = RunCommand(ctx, client.Client, vm.ID, cmd, stdoutCh, stderrCh)
	wg.Wait()

	if err != nil {
		return fmt.Errorf("failed to configure MaxSessions on VM %s: %w", vm.ID, err)
	}

	logger.Info("configured MaxSessions on builder VM",
		zap.String("vmID", vm.ID),
		zap.String("type", vm.Type),
		zap.Int("maxSessions", 500))

	return nil
}

func generateKeyPair(ctx context.Context) (string, string, error) {
	// Generate ed25519 key pair
	publicKey, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate ed25519 key pair: %w", err)
	}

	// Format public key in SSH format with comment
	pub, err := ssh.NewPublicKey(publicKey)
	if err != nil {
		return "", "", fmt.Errorf("failed to create ssh public key: %w", err)
	}
	sshPubKey := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(pub))) + " builder@securebuild.com"

	// Encode private key in OpenSSH format using edkey
	privKeyBlock := pem.Block{
		Type:  "OPENSSH PRIVATE KEY",
		Bytes: edkey.MarshalED25519PrivateKey(privateKey),
	}
	privateKeyPEM := string(pem.EncodeToMemory(&privKeyBlock))

	return sshPubKey, privateKeyPEM, nil
}

func provisionVM(ctx context.Context, machineID string, architecture string, diskSizeGB int, isOnDemand bool) (types.BuilderVM, error) {
	logger.Info("provisioning VM", zap.String("architecture", architecture))

	// Set default disk size if not specified
	if diskSizeGB == 0 {
		diskSizeGB = 50
	}

	// VM TTL configuration:
	// - Pool VMs: Start with 4h, will be extended to configured VMTTLHours when assigned
	// - On-demand VMs: Use configured VMTTLHours immediately
	var vmTTLDuration time.Duration
	if isOnDemand {
		// On-demand VMs get the configured TTL since they're provisioned for a specific build
		var err error
		vmTTLDuration, err = dynamicparam.GetVMTTLDuration(ctx)
		if err != nil {
			logger.Warn("failed to get VM TTL from dynamic config, using default", zap.Error(err))
			vmTTLDuration = 24 * time.Hour
		}
	} else {
		// Pool VMs start with 4h, will be extended via extendVMTTL when assigned
		vmTTLDuration = 4 * time.Hour
	}

	// create a public key and private keypair for ssh
	publicKey, privateKey, err := generateKeyPair(ctx)
	if err != nil {
		return types.BuilderVM{}, fmt.Errorf("failed to generate key pair: %w", err)
	}

	publicKeyEncoded := base64.StdEncoding.EncodeToString([]byte(publicKey))
	privateKeyEncoded := base64.StdEncoding.EncodeToString([]byte(privateKey))

	// Get configurable instance types from params, with defaults
	var instanceType string
	switch architecture {
	case "x86_64":
		instanceType = param.GetParam(ctx).InstanceTypeX86
		if instanceType == "" {
			instanceType = "r1.large" // Default for x86_64
		}
	case "aarch64":
		instanceType = param.GetParam(ctx).InstanceTypeARM64
		if instanceType == "" {
			instanceType = "r1a.large" // Default for aarch64
		}
	default:
		return types.BuilderVM{}, fmt.Errorf("unsupported architecture: %s", architecture)
	}

	requestBody := map[string]interface{}{
		"instance_type": instanceType,
		"distribution":  "ubuntu",
		"version":       "24.04",
		"ttl":           vmTTLDuration.String(),
		"public_keys": []string{
			publicKeyEncoded,
		},
		"disk_gib": diskSizeGB,
	}

	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		return types.BuilderVM{}, fmt.Errorf("failed to marshal request body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/v3/vm", param.GetParam(ctx).ReplicatedAPIOrigin), bytes.NewBuffer(jsonBody))
	if err != nil {
		return types.BuilderVM{}, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", param.GetParam(ctx).ReplicatedAPIToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return types.BuilderVM{}, fmt.Errorf("failed to send request: %w", err)
	}

	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return types.BuilderVM{}, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode == http.StatusBadRequest {
		return types.BuilderVM{}, fmt.Errorf("bad request: %s", body)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return types.BuilderVM{}, fmt.Errorf("unexpected status code: %d, response: %s", resp.StatusCode, body)
	}

	type createVMResponse struct {
		VMs []types.CMXVM `json:"vms"`
	}

	var response createVMResponse
	err = json.Unmarshal(body, &response)
	if err != nil {
		return types.BuilderVM{}, fmt.Errorf("failed to unmarshal response body: %w", err)
	}

	// Check if the API returned any VMs
	if len(response.VMs) == 0 {
		logger.Error(fmt.Errorf("API returned empty VMs array - status_code: %d, architecture: %s, response_body: %s",
			resp.StatusCode, architecture, string(body)))
		return types.BuilderVM{}, fmt.Errorf("API returned no VMs in response")
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	vm := response.VMs[0]

	// Calculate expires_at based on TTL
	// - Pool VMs: Start with nil, will be set when extended via extendVMTTL
	// - On-demand VMs: Set to configured TTL immediately
	var expiresAt *time.Time
	if isOnDemand {
		expiresAtValue := time.Now().Add(vmTTLDuration).UTC()
		expiresAt = &expiresAtValue
		logger.Debug("setting on-demand VM expires_at",
			zap.String("vmID", vm.ID),
			zap.Time("expiresAt", expiresAtValue),
			zap.Duration("ttl", vmTTLDuration))
	}

	query := `insert into machine_pool (id, machine_id, created_at, expires_at, private_key, username, status, architecture, is_on_demand, type) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`
	_, err = conn.Exec(ctx, query, vm.ID, machineID, time.Now().UTC(), expiresAt, privateKeyEncoded, "builder", vm.Status, architecture, isOnDemand, "cmx")
	if err != nil {
		return types.BuilderVM{}, fmt.Errorf("failed to insert machine into database: %w", err)
	}

	builderVM := types.BuilderVM{
		ID:           vm.ID,
		CreatedAt:    time.Now().UTC(),
		ExpiresAt:    expiresAt,
		PrivateKey:   privateKeyEncoded,
		Username:     "builder",
		Status:       vm.Status,
		Architecture: architecture,
	}

	return builderVM, nil
}

func extendVMTTL(ctx context.Context, vmID string) error {
	logger.Trace("extending vm ttl", zap.String("vmID", vmID))

	// Get the configured VM TTL from dynamic config
	vmTTLDuration, err := dynamicparam.GetVMTTLDuration(ctx)
	if err != nil {
		logger.Warn("failed to get VM TTL from dynamic config, using default", zap.Error(err))
		vmTTLDuration = 24 * time.Hour // Default fallback
	}

	logger.Debug("extending vm ttl",
		zap.String("vmID", vmID),
		zap.Duration("ttl", vmTTLDuration))

	// Update the cloud provider VM TTL
	putBody := map[string]interface{}{
		"ttl": vmTTLDuration.String(),
	}

	jsonBody, err := json.Marshal(putBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request body: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, "PUT", fmt.Sprintf("%s/v3/vm/%s/ttl", param.GetParam(ctx).ReplicatedAPIOrigin, vmID), bytes.NewBuffer(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", param.GetParam(ctx).ReplicatedAPIToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		logger.Warn("failed to extend vm ttl", zap.Int("status code", resp.StatusCode), zap.String("body", string(body)))
	}

	// Update the expires_at time in the database
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	newExpiresAt := time.Now().Add(vmTTLDuration).UTC()

	query := `UPDATE machine_pool SET expires_at = $1 WHERE id = $2`
	_, err = conn.Exec(ctx, query, newExpiresAt, vmID)
	if err != nil {
		logger.Warn("failed to update VM expires_at in database",
			zap.String("vmID", vmID),
			zap.Error(err))
		// Do not error, the CMX VM was updated and this is used purely for
		// frontend reference.
	}

	logger.Debug("successfully extended VM TTL",
		zap.String("vmID", vmID),
		zap.Duration("ttl", vmTTLDuration),
		zap.Time("newExpiresAt", newExpiresAt))

	return nil
}

func archiveMachineToHistory(ctx context.Context, vmID string, terminationReason string) error {
	conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
	if err != nil {
		logger.Warn("failed to get database connection for archiving machine to history",
			zap.String("vmID", vmID),
			zap.String("terminationReason", terminationReason),
			zap.Error(err))
		return nil // Don't fail VM deletion if archiving fails
	}
	defer conn.Release()

	// First get the machine data
	machine, err := getMachine(ctx, vmID)
	if err != nil {
		if err == ErrMachineNotFound {
			// Check if it's already in history
			var existsInHistory bool
			checkQuery := `SELECT EXISTS(SELECT 1 FROM machine_pool_history WHERE id = $1)`
			err := conn.QueryRow(ctx, checkQuery, vmID).Scan(&existsInHistory)
			if err != nil {
				logger.Warn("failed to check if machine exists in history", zap.String("vmID", vmID), zap.Error(err))
				return nil
			}

			if existsInHistory {
				logger.Debug("machine already archived to history by another process", zap.String("vmID", vmID))
			} else {
				logger.Warn("machine not found in pool or history when trying to archive", zap.String("vmID", vmID))
			}
			return nil // Don't fail if machine doesn't exist
		}
		return fmt.Errorf("failed to get machine for archiving: %w", err)
	}

	// Get additional fields from machine_pool table
	var machineID string
	query := `SELECT machine_id FROM machine_pool WHERE id = $1`
	err = conn.QueryRow(ctx, query, vmID).Scan(&machineID)
	if err != nil {
		if err == pgx.ErrNoRows {
			logger.Debug("machine not found in machine_pool when archiving (likely already processed)", zap.String("vmID", vmID))
			return nil
		}
		return fmt.Errorf("failed to get machine details for archiving: %w", err)
	}

	// Get debug information from VM context
	var lastCommand, lastStdout, lastStderr, failureDetails string
	if vmCtx, exists := vmContexts[vmID]; exists {
		lastCommand, lastStdout, lastStderr, failureDetails = vmCtx.GetDebugInfo()
	}

	// Insert into machine_pool_history with conflict resolution that prioritizes failure reasons
	historyQuery := `
		INSERT INTO machine_pool_history (
			id, machine_id, created_at, expires_at, private_key, username, status,
			ip_address, port, assigned_task_type, assigned_task_id, architecture,
			deleted_at, termination_reason, last_command, last_stdout, last_stderr, failure_details
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15, $16, $17)
		ON CONFLICT (id, deleted_at) DO UPDATE SET
			termination_reason = CASE
				WHEN EXCLUDED.termination_reason IN ('task_failed', 'error', 'build_env_failed')
					AND machine_pool_history.termination_reason NOT IN ('task_failed', 'error', 'build_env_failed')
				THEN EXCLUDED.termination_reason
				WHEN machine_pool_history.termination_reason IN ('task_failed', 'error', 'build_env_failed')
				THEN machine_pool_history.termination_reason
				ELSE EXCLUDED.termination_reason
			END,
			last_command = COALESCE(EXCLUDED.last_command, machine_pool_history.last_command),
			last_stdout = COALESCE(EXCLUDED.last_stdout, machine_pool_history.last_stdout),
			last_stderr = COALESCE(EXCLUDED.last_stderr, machine_pool_history.last_stderr),
			failure_details = COALESCE(EXCLUDED.failure_details, machine_pool_history.failure_details)
	`

	// Get assignment from machine_assignment table
	var assignedTaskTypeStr, assignedTaskIDStr string
	assignment, assignErr := GetMachineAssignment(ctx, vmID)
	if assignErr != nil {
		logger.Warn("failed to get machine assignment for archiving", zap.String("vmID", vmID), zap.Error(assignErr))
	} else if assignment != nil {
		assignedTaskTypeStr = assignment.AssignedTaskType
		assignedTaskIDStr = assignment.AssignedTaskID
	}

	// Clean up machine_assignment when archiving
	if delErr := DeleteAllMachineAssignments(ctx, vmID); delErr != nil {
		logger.Warn("failed to delete machine assignments during archive", zap.String("vmID", vmID), zap.Error(delErr))
	}

	result, err := conn.Exec(ctx, historyQuery,
		machine.ID,
		machineID,
		machine.CreatedAt,
		machine.ExpiresAt,
		machine.PrivateKey,
		machine.Username,
		machine.Status,
		machine.IPAddress,
		machine.Port,
		assignedTaskTypeStr,
		assignedTaskIDStr,
		machine.Architecture,
		terminationReason,
		lastCommand,
		lastStdout,
		lastStderr,
		failureDetails,
	)
	if err != nil {
		return fmt.Errorf("failed to insert machine into history: %w", err)
	}

	rowsAffected := result.RowsAffected()
	if rowsAffected > 0 {
		logger.Info("archived machine to history",
			zap.String("vmID", vmID),
			zap.String("terminationReason", terminationReason),
			zap.String("status", machine.Status),
			zap.String("architecture", machine.Architecture),
			zap.String("lastCommand", lastCommand),
		)
	} else {
		logger.Debug("machine already archived to history (conflict avoided)", zap.String("vmID", vmID))
	}

	// Clean up the VM context
	CleanupVMContext(vmID)

	return nil
}

func DeleteVM(ctx context.Context, vmID string) error {
	return DeleteVMWithReason(ctx, vmID, TerminationReasonManualDeletion)
}

// lockVMForCleanup attempts to lock a VM for cleanup, returns true if successful
func lockVMForCleanup(ctx context.Context, vmID string) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Try to set cleanup_locked_at to NOW() only if it's currently NULL
	query := `UPDATE machine_pool SET cleanup_locked_at = NOW() WHERE id = $1 AND cleanup_locked_at IS NULL`
	result, err := conn.Exec(ctx, query, vmID)
	if err != nil {
		return false, fmt.Errorf("failed to lock VM for cleanup: %w", err)
	}

	rowsAffected := result.RowsAffected()
	return rowsAffected > 0, nil
}

// unlockVMFromCleanup removes the cleanup lock from a VM
func unlockVMFromCleanup(ctx context.Context, vmID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `UPDATE machine_pool SET cleanup_locked_at = NULL WHERE id = $1`
	_, err := conn.Exec(ctx, query, vmID)
	if err != nil {
		return fmt.Errorf("failed to unlock VM from cleanup: %w", err)
	}

	return nil
}

// cleanupStaleLocks removes cleanup locks older than 5 minutes (in case of process crashes)
func cleanupStaleLocks(ctx context.Context) error {
	conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 5*time.Second)
	if err != nil {
		logger.Warn("failed to get database connection for cleanup stale locks", zap.Error(err))
		return err // Return error but don't panic
	}
	defer conn.Release()

	query := `UPDATE machine_pool SET cleanup_locked_at = NULL WHERE cleanup_locked_at < NOW() - INTERVAL '5 minutes'`
	result, err := conn.Exec(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to cleanup stale locks: %w", err)
	}

	rowsAffected := result.RowsAffected()
	if rowsAffected > 0 {
		logger.Info("cleaned up stale cleanup locks", zap.Int64("count", rowsAffected))
	}

	return nil
}

func DeleteVMWithReason(ctx context.Context, vmID string, terminationReason string) error {
	logger.Debug("attempting to delete vm",
		zap.String("vmID", vmID),
		zap.String("terminationReason", terminationReason),
	)

	// Try to acquire cleanup lock
	locked, err := lockVMForCleanup(ctx, vmID)
	if err != nil {
		return fmt.Errorf("failed to acquire cleanup lock for VM %s: %w", vmID, err)
	}

	if !locked {
		logger.Debug("VM already being cleaned up by another process",
			zap.String("vmID", vmID),
			zap.String("terminationReason", terminationReason),
		)
		return nil // Another process is handling this VM
	}

	// Ensure we unlock on exit (in case of early returns)
	defer func() {
		if unlockErr := unlockVMFromCleanup(ctx, vmID); unlockErr != nil {
			logger.Warn("failed to unlock VM after cleanup attempt",
				zap.String("vmID", vmID),
				zap.Error(unlockErr))
		}
	}()

	logger.Debug("deleting vm (cleanup lock acquired)",
		zap.String("vmID", vmID),
		zap.String("terminationReason", terminationReason),
	)

	// Archive to history before deletion
	if err := archiveMachineToHistory(ctx, vmID, terminationReason); err != nil {
		logger.Warn("failed to archive machine to history", zap.String("vmID", vmID), zap.Error(err))
		// Continue with deletion even if archiving fails
	}

	req, err := http.NewRequestWithContext(ctx, "DELETE", fmt.Sprintf("%s/v3/vm/%s", param.GetParam(ctx).ReplicatedAPIOrigin, vmID), nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", param.GetParam(ctx).ReplicatedAPIToken)
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode != http.StatusNotFound {
			return fmt.Errorf("failed to delete VM: %d", resp.StatusCode)
		}
	}

	conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
	if err != nil {
		logger.Warn("failed to get database connection for final VM cleanup",
			zap.String("vmID", vmID),
			zap.Error(err))
		// VM was deleted from cloud provider, but not from database
		// This is not ideal but better than blocking the system
		return fmt.Errorf("VM deleted from cloud but failed to cleanup database: %w", err)
	}
	defer conn.Release()

	query := `delete from machine_pool where id = $1`
	_, err = conn.Exec(ctx, query, vmID)
	if err != nil {
		return fmt.Errorf("failed to delete machine from database: %w", err)
	}

	logger.Info("successfully deleted VM",
		zap.String("vmID", vmID),
		zap.String("terminationReason", terminationReason),
	)

	return nil
}

// resolveWorkDirForAssignment returns the work dir for a machine assignment by runner type.
// Local: subdirectory under os.TempDir()/securebuild (same pattern as LocalBackend.createWorkDir).
// CMX: remote $HOME (single build at a time).
// Static: remote $HOME/builds/{taskID}-{architecture} (same pattern as static backend).
func resolveWorkDirForAssignment(ctx context.Context, vm types.BuilderVM, taskType, taskID, architecture string) (string, error) {
	switch vm.Type {
	case "local":
		var dirName string
		switch taskType {
		case "build_package":
			dirName = fmt.Sprintf("execution-%s-%s", taskID, architecture)
		case "build_image":
			dirName = fmt.Sprintf("build-%s", taskID)
		default:
			dirName = fmt.Sprintf("task-%s-%s", taskType, taskID)
		}
		return filepath.Join(os.TempDir(), "securebuild", dirName), nil
	case "cmx", "static", "":
		// Use a dedicated subdirectory under $HOME so melange's workspace
		// population (which copies the entire CWD) doesn't sweep up unrelated
		// $HOME contents like scans/, .ssh/, .cache/, or the builder binary.
		home, err := GetRemoteHome(ctx, vm)
		if err != nil {
			return "", err
		}
		return home + "/builds/" + taskID + "-" + architecture, nil
	default:
		home, err := GetRemoteHome(ctx, vm)
		if err != nil {
			return "", err
		}
		return home + "/builds/" + taskID + "-" + architecture, nil
	}
}

// tryTakeVMWithAssignment attempts to take a VM from the pool without blocking.
// Returns nil if no VM is available, or the assigned VM if successful.
// This function holds the architecture-specific mutex for the duration of the assignment.
func tryTakeVMWithAssignment(ctx context.Context, architecture string, taskType string, taskID string) (*types.BuilderVM, error) {
	// Use database-only approach - no mutex or in-memory pool needed
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Use a database transaction with row-level locking to prevent race conditions
	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Find an available VM: running, not locked, not on-demand, and has capacity
	// (fewer than MAX_PARALLEL_BUILDS assignments in machine_assignment)
	maxParallel := getMaxParallelBuilds(ctx)
	query := `
		SELECT id, created_at, expires_at, private_key, username, status, ip_address, port, architecture, type
		FROM machine_pool
		WHERE architecture = $1
		AND status = 'running'
		AND cleanup_locked_at IS NULL
		AND is_on_demand = false
		AND (SELECT COUNT(*) FROM machine_assignment WHERE machine_id = machine_pool.id) < $2
		ORDER BY created_at ASC
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`

	var vm types.BuilderVM
	var ipAddress sql.NullString
	var port sql.NullInt32
	var arch sql.NullString

	err = tx.QueryRow(ctx, query, architecture, maxParallel).Scan(
		&vm.ID, &vm.CreatedAt, &vm.ExpiresAt, &vm.PrivateKey,
		&vm.Username, &vm.Status, &ipAddress, &port, &arch, &vm.Type,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			// No available VMs
			logger.Trace("no available machines in database", zap.String("architecture", architecture))
			return nil, nil
		}
		return nil, fmt.Errorf("failed to find available VM: %w", err)
	}

	// Set optional fields so resolveWorkDirForAssignment can use them (e.g. GetRemoteHome for cmx/static)
	if ipAddress.Valid {
		vm.IPAddress = ipAddress.String
	}
	if port.Valid {
		vm.Port = int(port.Int32)
	}
	if arch.Valid {
		vm.Architecture = arch.String
	}
	vm.AssignedTaskType = taskType
	vm.AssignedTaskID = taskID

	// Resolve work_dir in the same transaction so we insert it with the assignment
	workDir, err := resolveWorkDirForAssignment(ctx, vm, taskType, taskID, architecture)
	if err != nil {
		return nil, fmt.Errorf("resolve work dir for assignment: %w", err)
	}

	assignQuery := `INSERT INTO machine_assignment (machine_id, assigned_task_type, assigned_task_id, work_dir, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (machine_id, assigned_task_type, assigned_task_id) DO UPDATE SET work_dir = EXCLUDED.work_dir`
	_, err = tx.Exec(ctx, assignQuery, vm.ID, taskType, taskID, workDir, time.Now().UTC())
	if err != nil {
		return nil, fmt.Errorf("failed to insert machine assignment: %w", err)
	}

	// Successfully assigned VM, commit transaction
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit VM assignment: %w", err)
	}

	// Extend the VM TTL to the configured value when assigned to a build
	if err := extendVMTTL(ctx, vm.ID); err != nil {
		logger.Warn("failed to extend VM TTL on assignment", zap.Error(err))
	}

	logger.Debug("successfully assigned VM",
		zap.String("vmID", vm.ID),
		zap.String("architecture", architecture),
		zap.String("taskType", taskType),
		zap.String("taskID", taskID))

	return &vm, nil
}

// getMaxParallelBuilds returns the configured max parallel builds, defaulting to 1.
// CMX is hardcoded to 1 (builds run in HOME; single build at a time).
func getMaxParallelBuilds(ctx context.Context) int {
	p := param.TryGetParam(ctx)
	if p != nil && p.BuildBackend == "cmx" {
		return 1
	}
	if p != nil && p.MaxParallelBuilds > 0 {
		return p.MaxParallelBuilds
	}
	return 1
}

// TakeVMWithAssignment atomically takes a VM from the pool and assigns it to a task
// This function blocks until a VM becomes available, the context is cancelled, or timeout is reached
func TakeVMWithAssignment(ctx context.Context, architecture string, taskType string, taskID string) (types.BuilderVM, error) {
	// Add a timeout to prevent infinite blocking
	timeoutCtx, cancel := context.WithTimeout(ctx, 1*time.Hour)
	defer cancel()

	startTime := time.Now()
	retryCount := 0

	for {
		retryCount++

		// Try to get a VM from the database
		vm, err := tryTakeVMWithAssignment(timeoutCtx, architecture, taskType, taskID)
		if err != nil {
			return types.BuilderVM{}, err
		}
		if vm != nil {
			logger.Debug("successfully assigned VM after retries",
				zap.String("vmID", vm.ID),
				zap.String("architecture", architecture),
				zap.String("taskType", taskType),
				zap.String("taskID", taskID),
				zap.Int("retryCount", retryCount),
				zap.Duration("totalWaitTime", time.Since(startTime)))
			return *vm, nil
		}

		// Log periodic status for debugging
		if retryCount%15 == 0 { // Every ~60 seconds (15 * 4s)
			logger.Warn("still waiting for VM assignment",
				zap.String("architecture", architecture),
				zap.String("taskType", taskType),
				zap.String("taskID", taskID),
				zap.Int("retryCount", retryCount),
				zap.Duration("waitTime", time.Since(startTime)))
		}

		// No VM available, wait and retry
		select {
		case <-timeoutCtx.Done():
			if timeoutCtx.Err() == context.DeadlineExceeded {
				logger.Error(fmt.Errorf("VM assignment timed out after 10 minutes: architecture=%s, taskType=%s, taskID=%s, retryCount=%d, totalWaitTime=%v",
					architecture, taskType, taskID, retryCount, time.Since(startTime)))
				return types.BuilderVM{}, fmt.Errorf("VM assignment timed out after 10 minutes for architecture %s", architecture)
			}
			return types.BuilderVM{}, timeoutCtx.Err()
		case <-time.After(4*time.Second + time.Duration(rand.Intn(2000))*time.Millisecond):
			continue
		}
	}
}

var ErrMachineNotFound = errors.New("machine not found")

func getMachine(ctx context.Context, machineID string) (types.BuilderVM, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id, created_at, expires_at, private_key, username, status, ip_address, port, architecture, last_uptime, last_uptime_updated_at, cleanup_locked_at, is_on_demand, type from machine_pool where id = $1`
	row := conn.QueryRow(ctx, query, machineID)

	var machine types.BuilderVM
	var ipAddress sql.NullString
	var port sql.NullInt32
	var architecture sql.NullString
	var lastUptime sql.NullString
	var lastUptimeUpdatedAt sql.NullTime
	var cleanupLockedAt sql.NullTime
	var isOnDemand sql.NullBool
	var machineType sql.NullString
	err := row.Scan(&machine.ID, &machine.CreatedAt, &machine.ExpiresAt, &machine.PrivateKey, &machine.Username, &machine.Status, &ipAddress, &port, &architecture, &lastUptime, &lastUptimeUpdatedAt, &cleanupLockedAt, &isOnDemand, &machineType)
	if err != nil {
		if err == pgx.ErrNoRows {
			return types.BuilderVM{}, ErrMachineNotFound
		}
		return types.BuilderVM{}, fmt.Errorf("failed to scan machine in getMachine: %w", err)
	}

	if ipAddress.Valid {
		machine.IPAddress = ipAddress.String
	}
	if port.Valid {
		machine.Port = int(port.Int32)
	}
	if architecture.Valid {
		machine.Architecture = architecture.String
	}
	if lastUptime.Valid {
		machine.LastUptime = lastUptime.String
	}
	if lastUptimeUpdatedAt.Valid {
		machine.LastUptimeUpdatedAt = &lastUptimeUpdatedAt.Time
	}
	if cleanupLockedAt.Valid {
		machine.CleanupLockedAt = &cleanupLockedAt.Time
	}
	if isOnDemand.Valid {
		machine.IsOnDemand = isOnDemand.Bool
	}
	if machineType.Valid {
		machine.Type = machineType.String
	}

	// Populate assignment from machine_assignment table
	assignment, err := GetMachineAssignment(ctx, machineID)
	if err != nil {
		logger.Warn("failed to get machine assignment", zap.String("machineID", machineID), zap.Error(err))
	} else if assignment != nil {
		machine.AssignedTaskType = assignment.AssignedTaskType
		machine.AssignedTaskID = assignment.AssignedTaskID
	}

	return machine, nil
}

func deleteExpiredMachines(ctx context.Context) error {
	conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 15*time.Second)
	if err != nil {
		logger.Warn("failed to get database connection for deleting expired machines", zap.Error(err))
		return err // Return error but don't panic
	}
	defer conn.Release()

	// First get the expired machines to archive them (use machine_assignment to check if assigned)
	selectQuery := `SELECT id FROM machine_pool
                    WHERE expires_at < now()
                    AND cleanup_locked_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM machine_assignment WHERE machine_id = machine_pool.id)`
	rows, err := conn.Query(ctx, selectQuery)
	if err != nil {
		return fmt.Errorf("failed to query expired machines: %w", err)
	}
	defer rows.Close()

	var expiredVMIDs []string
	for rows.Next() {
		var vmID string
		if err := rows.Scan(&vmID); err != nil {
			logger.Error(fmt.Errorf("failed to scan expired machine ID: %w", err))
			continue
		}
		expiredVMIDs = append(expiredVMIDs, vmID)
	}

	// Archive each expired machine to history
	for _, vmID := range expiredVMIDs {
		if err := archiveMachineToHistory(ctx, vmID, TerminationReasonExpired); err != nil {
			logger.Warn("failed to archive expired machine to history", zap.String("vmID", vmID), zap.Error(err))
		}
	}

	// Now delete the expired machines (use machine_assignment to check if assigned)
	deleteQuery := `DELETE FROM machine_pool
                    WHERE expires_at < now()
                    AND cleanup_locked_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM machine_assignment WHERE machine_id = machine_pool.id)`
	result, err := conn.Exec(ctx, deleteQuery)
	if err != nil {
		return fmt.Errorf("failed to delete expired machines: %w", err)
	}

	rowsAffected := result.RowsAffected()
	if rowsAffected > 0 {
		logger.Info("deleted expired unassigned machines", zap.Int64("count", rowsAffected))
	}

	return nil
}

func getVMsWithAssignmentStatus(ctx context.Context, vmIDs []string) (map[string]bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	if len(vmIDs) == 0 {
		return make(map[string]bool), nil
	}

	// Initialize all VMs as unassigned
	result := make(map[string]bool)
	for _, id := range vmIDs {
		result[id] = false
	}

	// Query machine_assignment to find which VMs have assignments
	placeholders := make([]string, len(vmIDs))
	args := make([]interface{}, len(vmIDs))
	for i, id := range vmIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT DISTINCT machine_id
		FROM machine_assignment
		WHERE machine_id IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := conn.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query VM assignment status: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var vmID string
		if err := rows.Scan(&vmID); err != nil {
			return nil, fmt.Errorf("failed to scan VM assignment status: %w", err)
		}
		result[vmID] = true
	}

	return result, nil
}

func unassignVM(ctx context.Context, vmID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Delete all assignments from machine_assignment (primary source of truth)
	assignQuery := `DELETE FROM machine_assignment WHERE machine_id = $1`
	_, err := conn.Exec(ctx, assignQuery, vmID)
	if err != nil {
		return fmt.Errorf("failed to delete machine assignments: %w", err)
	}

	return nil
}

func listMachines(ctx context.Context, machineID string) ([]types.BuilderVM, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id, created_at, expires_at, private_key, username, status, ip_address, port, architecture, last_uptime, last_uptime_updated_at, cleanup_locked_at, is_on_demand, type from machine_pool where machine_id = $1 and (expires_at > now() OR expires_at is NULL)`
	rows, err := conn.Query(ctx, query, machineID)
	if err != nil {
		return nil, fmt.Errorf("failed to query machines: %w", err)
	}
	defer rows.Close()

	machines := []types.BuilderVM{}
	for rows.Next() {
		var machine types.BuilderVM
		var ipAddress sql.NullString
		var port sql.NullInt32
		var architecture sql.NullString
		var lastUptime sql.NullString
		var lastUptimeUpdatedAt sql.NullTime
		var cleanupLockedAt sql.NullTime
		var isOnDemand sql.NullBool
		var machineType sql.NullString
		err := rows.Scan(&machine.ID, &machine.CreatedAt, &machine.ExpiresAt, &machine.PrivateKey, &machine.Username, &machine.Status, &ipAddress, &port, &architecture, &lastUptime, &lastUptimeUpdatedAt, &cleanupLockedAt, &isOnDemand, &machineType)
		if err != nil {
			return nil, fmt.Errorf("failed to scan machine in listMachines: %w", err)
		}

		if ipAddress.Valid {
			machine.IPAddress = ipAddress.String
		}
		if port.Valid {
			machine.Port = int(port.Int32)
		}
		if architecture.Valid {
			machine.Architecture = architecture.String
		}
		if lastUptime.Valid {
			machine.LastUptime = lastUptime.String
		}
		if lastUptimeUpdatedAt.Valid {
			machine.LastUptimeUpdatedAt = &lastUptimeUpdatedAt.Time
		}
		if cleanupLockedAt.Valid {
			machine.CleanupLockedAt = &cleanupLockedAt.Time
		}
		if isOnDemand.Valid {
			machine.IsOnDemand = isOnDemand.Bool
		}
		if machineType.Valid {
			machine.Type = machineType.String
		}

		// Populate assignment from machine_assignment table
		assignment, assignErr := GetMachineAssignment(ctx, machine.ID)
		if assignErr != nil {
			logger.Warn("failed to get machine assignment in listMachines", zap.String("machineID", machine.ID), zap.Error(assignErr))
		} else if assignment != nil {
			machine.AssignedTaskType = assignment.AssignedTaskType
			machine.AssignedTaskID = assignment.AssignedTaskID
		}

		machines = append(machines, machine)
	}

	return machines, nil
}

// GetMachineID returns a unique identifier for this worker machine based on its network interface
func GetMachineID() (string, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return "", err
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagLoopback == 0 && iface.HardwareAddr != nil {
			h := sha256.New()
			h.Write([]byte(iface.HardwareAddr.String()))
			return hex.EncodeToString(h.Sum(nil)), nil
		}
	}
	return "", fmt.Errorf("no suitable network interface found")
}

// getPrivateKeyBytes resolves vm.PrivateKey: "file:<path>" reads from disk (static backend), else base64-encoded (CMX).
func getPrivateKeyBytes(vm types.BuilderVM) ([]byte, error) {
	if strings.HasPrefix(vm.PrivateKey, "file:") {
		keyPath := strings.TrimPrefix(vm.PrivateKey, "file:")
		b, err := os.ReadFile(keyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read SSH key file %s: %w", keyPath, err)
		}
		return b, nil
	}
	return base64.StdEncoding.DecodeString(vm.PrivateKey)
}

// GetRemoteHome returns the VM home directory: $HOME from SSH for static/CMX, or os.UserHomeDir for local.
func GetRemoteHome(ctx context.Context, vm types.BuilderVM) (string, error) {
	if vm.Type == "local" {
		return os.UserHomeDir()
	}

	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return "", err
	}
	defer client.Close()
	sess, err := client.Client.NewSession()
	if err != nil {
		return "", fmt.Errorf("new session: %w", err)
	}
	defer sess.Close()
	out, err := sess.CombinedOutput("echo $HOME")
	if err != nil {
		return "", fmt.Errorf("echo $HOME: %w", err)
	}
	home := strings.TrimSpace(string(out))
	if home == "" {
		home = "/home/" + vm.Username
	}
	return home, nil
}

func GetSSHClient(ctx context.Context, vm types.BuilderVM) (*KeepAliveSSHClient, error) {
	privateKeyBytes, err := getPrivateKeyBytes(vm)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve private key for VM %s: %w", vm.ID, err)
	}
	key, err := ssh.ParsePrivateKey(privateKeyBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key for VM %s: %w", vm.ID, err)
	}

	config := &ssh.ClientConfig{
		User: vm.Username,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(key),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second, // Increased from 10 seconds
	}

	addr := fmt.Sprintf("%s:%d", vm.IPAddress, vm.Port)
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		logger.Info("SSH dial failed, checking VM status",
			zap.String("vmID", vm.ID),
			zap.String("addr", addr),
			zap.Error(err))
		DebugVMStatus(ctx, vm.ID)
		return nil, fmt.Errorf("failed to dial ssh to VM %s (%s): %w", vm.ID, addr, err)
	}

	// Create a child context that we can cancel when the client is no longer needed
	keepAliveCtx, cancel := context.WithCancel(ctx)

	// Send keep-alive packets every 30 seconds to maintain connection
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-keepAliveCtx.Done():
				return
			case <-ticker.C:
				// Send a keep-alive by requesting a new session and immediately closing it
				if sess, err := client.NewSession(); err == nil {
					sess.Close()
				}
			}
		}
	}()

	// Wrap the client with keep-alive management
	return &KeepAliveSSHClient{
		Client: client,
		cancel: cancel,
	}, nil
}

func copyBuildEnvFiles(ctx context.Context, vm types.BuilderVM, homeDir string) error {
	if vm.Type == "local" {
		return localCopyBuildEnvFiles(homeDir, vm.ID)
	}

	logger.Trace("copying build env files", zap.String("vmID", vm.ID), zap.String("ipAddress", vm.IPAddress), zap.Int("port", vm.Port))

	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	err = fs.WalkDir(EmbeddedFS(), "filesystem", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			logger.Debug("walk error", zap.String("path", path), zap.Error(walkErr))
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		// Compute the destination path under VM's $HOME
		relPath := strings.TrimPrefix(path, "filesystem/")
		destPath := homeDir + "/" + relPath
		// Ensure parent directory exists
		lastSlash := strings.LastIndex(destPath, "/")
		if lastSlash > 0 {
			parentDir := destPath[:lastSlash]
			logger.Trace("creating parent directory on remote", zap.String("parentDir", parentDir), zap.String("destPath", destPath))
			mkdirCmd := fmt.Sprintf("mkdir -p '%s'", parentDir)
			mkdirStdoutCh := make(chan string)
			mkdirStderrCh := make(chan string)
			var wg sync.WaitGroup
			wg.Add(2)
			go func() {
				defer wg.Done()
				for range mkdirStdoutCh {
					// Optionally handle output
				}
			}()
			go func() {
				defer wg.Done()
				for range mkdirStderrCh {
					// Optionally handle output
				}
			}()
			if err := RunCommand(ctx, client.Client, vm.ID, mkdirCmd, mkdirStdoutCh, mkdirStderrCh); err != nil {
				logger.Debug("failed to create parent directory", zap.String("parentDir", parentDir), zap.Error(err))
				wg.Wait()
				return fmt.Errorf("failed to create directory %s on VM %s: %w", parentDir, vm.ID, err)
			}
			wg.Wait()
			logger.Trace("successfully created parent directory", zap.String("parentDir", parentDir))
		}
		// Read file contents
		logger.Trace("reading embedded file", zap.String("path", path))
		contents, readErr := EmbeddedFS().ReadFile(path)
		if readErr != nil {
			logger.Debug("failed to read embedded file", zap.String("path", path), zap.Error(readErr))
			return fmt.Errorf("failed to read embedded file %s for VM %s: %w", path, vm.ID, readErr)
		}
		// Copy file to remote
		logger.Trace("copying file to remote", zap.String("src", path), zap.String("dest", destPath))
		if err := CreateRemoteTextFile(client.Client, destPath, string(contents)); err != nil {
			logger.Debug("failed to copy file to remote", zap.String("src", path), zap.String("dest", destPath), zap.Error(err))
			return fmt.Errorf("failed to copy file %s to remote VM %s: %w", path, vm.ID, err)
		}
		logger.Trace("successfully copied file to remote", zap.String("src", path), zap.String("dest", destPath))
		return nil
	})
	if err != nil {
		logger.Debug("error during WalkDir", zap.Error(err))
		return fmt.Errorf("failed to walk embedded filesystem for VM %s: %w", vm.ID, err)
	}

	return nil
}

func UnassignVM(ctx context.Context, vmID string) error {
	return unassignVM(ctx, vmID)
}

func ListMachinePoolHistory(ctx context.Context, limit int) ([]types.MachinePoolHistory, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, machine_id, created_at, expires_at, private_key, username, status,
		       ip_address, port, assigned_task_type, assigned_task_id, architecture,
		       deleted_at, termination_reason, last_command, last_stdout, last_stderr, failure_details
		FROM machine_pool_history
		ORDER BY deleted_at DESC
		LIMIT $1
	`

	rows, err := conn.Query(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query machine pool history: %w", err)
	}
	defer rows.Close()

	var history []types.MachinePoolHistory
	for rows.Next() {
		var record types.MachinePoolHistory
		var expiresAt sql.NullTime
		var ipAddress, assignedTaskType, assignedTaskID sql.NullString
		var lastCommand, lastStdout, lastStderr, failureDetails sql.NullString
		var port sql.NullInt32

		err := rows.Scan(
			&record.ID,
			&record.MachineID,
			&record.CreatedAt,
			&expiresAt,
			&record.PrivateKey,
			&record.Username,
			&record.Status,
			&ipAddress,
			&port,
			&assignedTaskType,
			&assignedTaskID,
			&record.Architecture,
			&record.DeletedAt,
			&record.TerminationReason,
			&lastCommand,
			&lastStdout,
			&lastStderr,
			&failureDetails,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan machine pool history record: %w", err)
		}

		if expiresAt.Valid {
			record.ExpiresAt = &expiresAt.Time
		}
		if ipAddress.Valid {
			record.IPAddress = ipAddress.String
		}
		if port.Valid {
			record.Port = int(port.Int32)
		}
		if assignedTaskType.Valid {
			record.AssignedTaskType = assignedTaskType.String
		}
		if assignedTaskID.Valid {
			record.AssignedTaskID = assignedTaskID.String
		}
		if lastCommand.Valid {
			record.LastCommand = lastCommand.String
		}
		if lastStdout.Valid {
			record.LastStdout = lastStdout.String
		}
		if lastStderr.Valid {
			record.LastStderr = lastStderr.String
		}
		if failureDetails.Valid {
			record.FailureDetails = failureDetails.String
		}

		history = append(history, record)
	}

	return history, nil
}

// DebugVMStatus helps debug VM lifecycle issues by checking both active pool and history
func DebugVMStatus(ctx context.Context, vmID string) {
	// conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 5 * time.Second)
	// if err != nil {
	// 	logger.Error(fmt.Errorf("failed to get Postgres session: %w", err))
	// 	return
	// }
	// defer conn.Release()

	// // Check if VM exists in active pool
	// var poolStatus, poolArch string
	// var poolCreatedAt time.Time
	// poolQuery := `SELECT status, architecture, created_at FROM machine_pool WHERE id = $1`
	// err = conn.QueryRow(ctx, poolQuery, vmID).Scan(&poolStatus, &poolArch, &poolCreatedAt)
	// if err == nil {
	// 	logger.Info("VM found in active pool",
	// 		zap.String("vmID", vmID),
	// 		zap.String("status", poolStatus),
	// 		zap.String("architecture", poolArch),
	// 		zap.Time("createdAt", poolCreatedAt),
	// 	)
	// } else if err == pgx.ErrNoRows {
	// 	logger.Info("VM not found in active pool", zap.String("vmID", vmID))
	// } else {
	// 	logger.Error(fmt.Errorf("error checking VM %s in active pool: %w", vmID, err))
	// }

	// // Check if VM exists in history
	// var historyReason, historyStatus string
	// var historyDeletedAt time.Time
	// historyQuery := `SELECT termination_reason, status, deleted_at FROM machine_pool_history WHERE id = $1 ORDER BY deleted_at DESC LIMIT 1`
	// err = conn.QueryRow(ctx, historyQuery, vmID).Scan(&historyReason, &historyStatus, &historyDeletedAt)
	// if err == nil {
	// 	logger.Info("VM found in history",
	// 		zap.String("vmID", vmID),
	// 		zap.String("terminationReason", historyReason),
	// 		zap.String("status", historyStatus),
	// 		zap.Time("deletedAt", historyDeletedAt),
	// 	)
	// } else if err == pgx.ErrNoRows {
	// 	logger.Info("VM not found in history", zap.String("vmID", vmID))
	// } else {
	// 	logger.Error(fmt.Errorf("error checking VM %s in history: %w", vmID, err))
	// }
}

func getUptimeViaSSH(ctx context.Context, vm types.BuilderVM) (string, error) {
	if vm.IPAddress == "" || vm.Port == 0 || vm.PrivateKey == "" {
		return "", fmt.Errorf("incomplete VM connection info")
	}

	privateKeyBytes, err := getPrivateKeyBytes(vm)
	if err != nil {
		return "", fmt.Errorf("failed to resolve private key: %w", err)
	}
	signer, err := ssh.ParsePrivateKey(privateKeyBytes)
	if err != nil {
		return "", fmt.Errorf("failed to parse private key: %w", err)
	}

	// Create SSH client config
	config := &ssh.ClientConfig{
		User: vm.Username,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // Note: In production, you should verify host keys
		Timeout:         10 * time.Second,
	}

	// Connect to the SSH server
	addr := fmt.Sprintf("%s:%d", vm.IPAddress, vm.Port)
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		logger.Info("SSH dial failed in getUptimeViaSSH, checking VM status",
			zap.String("vmID", vm.ID),
			zap.String("addr", addr),
			zap.Error(err))
		DebugVMStatus(ctx, vm.ID)
		return "", fmt.Errorf("failed to connect to SSH server: %w", err)
	}
	defer client.Close()

	// Create a session
	session, err := client.NewSession()
	if err != nil {
		logger.Info("SSH session creation failed in getUptimeViaSSH, checking VM status",
			zap.String("vmID", vm.ID),
			zap.Error(err))
		DebugVMStatus(ctx, vm.ID)
		return "", fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Run the uptime command
	output, err := session.Output("uptime")
	if err != nil {
		logger.Info("SSH uptime command failed, checking VM status",
			zap.String("vmID", vm.ID),
			zap.Error(err))
		DebugVMStatus(ctx, vm.ID)
		return "", fmt.Errorf("failed to run uptime command: %w", err)
	}

	return strings.TrimSpace(string(output)), nil
}

func UpdateMachineUptime(ctx context.Context, vmID string, uptime string) error {
	conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 5*time.Second)
	if err != nil {
		logger.Debug("failed to get database connection for uptime update",
			zap.String("vmID", vmID),
			zap.Error(err))
		return err // Return error but don't panic - uptime updates aren't critical
	}
	defer conn.Release()

	query := `UPDATE machine_pool SET last_uptime = $1, last_uptime_updated_at = NOW() WHERE id = $2`
	_, err = conn.Exec(ctx, query, uptime, vmID)
	if err != nil {
		return fmt.Errorf("failed to update machine uptime: %w", err)
	}

	return nil
}

// Helper function to count VMs by architecture from database
func countVMsByArchitecture(ctx context.Context, machineID string, architecture string) (int, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT COUNT(*) FROM machine_pool WHERE machine_id = $1 AND architecture = $2 AND (expires_at > now() OR expires_at IS NULL) AND cleanup_locked_at IS NULL`
	var count int
	err := conn.QueryRow(ctx, query, machineID, architecture).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count VMs for architecture %s: %w", architecture, err)
	}
	return count, nil
}

// Helper function to count available VMs by architecture from database
func countAvailableVMsByArchitecture(ctx context.Context, machineID string, architecture string) (int, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT COUNT(*) FROM machine_pool WHERE machine_id = $1 AND architecture = $2 AND status = 'running' AND cleanup_locked_at IS NULL AND (expires_at > now() OR expires_at IS NULL) AND NOT EXISTS (SELECT 1 FROM machine_assignment WHERE machine_id = machine_pool.id)`
	var count int
	err := conn.QueryRow(ctx, query, machineID, architecture).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count available VMs for architecture %s: %w", architecture, err)
	}
	return count, nil
}

// SelectBestArchitectureForImageBuild selects x86_64 or aarch64 based on available VM counts
// Returns the architecture with more available VMs, or random choice if equal
func SelectBestArchitectureForImageBuild(ctx context.Context) (string, error) {
	machineID, err := GetMachineID()
	if err != nil {
		return "", fmt.Errorf("failed to get machine ID: %w", err)
	}

	x86Count, err := countAvailableVMsByArchitecture(ctx, machineID, "x86_64")
	if err != nil {
		return "", fmt.Errorf("failed to count available x86_64 VMs: %w", err)
	}

	aarch64Count, err := countAvailableVMsByArchitecture(ctx, machineID, "aarch64")
	if err != nil {
		return "", fmt.Errorf("failed to count available aarch64 VMs: %w", err)
	}

	logger.Debug("VM availability for image build architecture selection",
		zap.Int("x86_64_available", x86Count),
		zap.Int("aarch64_available", aarch64Count))

	// Choose architecture with more available VMs
	if x86Count > aarch64Count {
		logger.Debug("selected x86_64 architecture (more VMs available)")
		return "x86_64", nil
	} else if aarch64Count > x86Count {
		logger.Debug("selected aarch64 architecture (more VMs available)")
		return "aarch64", nil
	} else {
		// Equal counts or both zero - choose randomly
		if rand.Intn(2) == 0 {
			logger.Debug("selected x86_64 architecture (random choice, equal availability)")
			return "x86_64", nil
		} else {
			logger.Debug("selected aarch64 architecture (random choice, equal availability)")
			return "aarch64", nil
		}
	}
}

// Helper function to get VMs by architecture from database for deletion
func getVMsByArchitectureForDeletion(ctx context.Context, machineID string, architecture string, limit int) ([]types.BuilderVM, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, created_at, expires_at, private_key, username, status, ip_address, port, architecture,
		       last_uptime, last_uptime_updated_at, cleanup_locked_at,
		       EXISTS(SELECT 1 FROM machine_assignment WHERE machine_id = machine_pool.id) as is_assigned
		FROM machine_pool
		WHERE machine_id = $1 AND architecture = $2 AND (expires_at > now() OR expires_at IS NULL) AND cleanup_locked_at IS NULL
		ORDER BY
			CASE WHEN NOT EXISTS(SELECT 1 FROM machine_assignment WHERE machine_id = machine_pool.id) THEN 0 ELSE 1 END,
			CASE status
				WHEN 'queued' THEN 1
					WHEN 'provisioning' THEN 1
					WHEN 'installing' THEN 2
					WHEN 'error' THEN 3
					WHEN 'running' THEN 4
					ELSE 0
			END,
			created_at ASC
		LIMIT $3
	`

	rows, err := conn.Query(ctx, query, machineID, architecture, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query VMs for deletion: %w", err)
	}
	defer rows.Close()

	var vms []types.BuilderVM
	for rows.Next() {
		var vm types.BuilderVM
		var ipAddress sql.NullString
		var port sql.NullInt32
		var arch sql.NullString
		var lastUptime sql.NullString
		var lastUptimeUpdatedAt sql.NullTime
		var cleanupLockedAt sql.NullTime
		var isAssigned bool

		err := rows.Scan(
			&vm.ID, &vm.CreatedAt, &vm.ExpiresAt, &vm.PrivateKey, &vm.Username, &vm.Status,
			&ipAddress, &port, &arch, &lastUptime, &lastUptimeUpdatedAt, &cleanupLockedAt, &isAssigned,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan VM: %w", err)
		}

		// Skip assigned VMs
		if isAssigned {
			continue
		}

		if ipAddress.Valid {
			vm.IPAddress = ipAddress.String
		}
		if port.Valid {
			vm.Port = int(port.Int32)
		}
		if arch.Valid {
			vm.Architecture = arch.String
		}
		if lastUptime.Valid {
			vm.LastUptime = lastUptime.String
		}
		if lastUptimeUpdatedAt.Valid {
			vm.LastUptimeUpdatedAt = &lastUptimeUpdatedAt.Time
		}
		if cleanupLockedAt.Valid {
			vm.CleanupLockedAt = &cleanupLockedAt.Time
		}

		vms = append(vms, vm)
	}

	return vms, nil
}

// ProvisionVMForBuild provisions a new VM with the specified parameters.
// This is a wrapper around provisionVM to make it accessible to other packages.
func ProvisionVMForBuild(ctx context.Context, machineID string, architecture string, diskSizeGB int, isOnDemand bool) (types.BuilderVM, error) {
	return provisionVM(ctx, machineID, architecture, diskSizeGB, isOnDemand)
}

// AssignVMToTask assigns a VM to a specific task by inserting into machine_assignment.
// workDir is optional; CMX uses the VM's $HOME (see GetRemoteHome).
func AssignVMToTask(ctx context.Context, vmID string, taskType string, taskID string, workDir string) error {
	if workDir != "" {
		return InsertMachineAssignmentWithWorkDir(ctx, vmID, taskType, taskID, workDir)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	assignQuery := `INSERT INTO machine_assignment (machine_id, assigned_task_type, assigned_task_id, created_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (machine_id, assigned_task_type, assigned_task_id) DO NOTHING`
	_, err := conn.Exec(ctx, assignQuery, vmID, taskType, taskID, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("failed to insert machine assignment: %w", err)
	}
	return nil
}
