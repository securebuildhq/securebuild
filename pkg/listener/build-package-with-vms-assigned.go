package listener

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/builder"
	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/dynamicparam"
	"github.com/securebuildhq/securebuild/pkg/execution"
	executiontypes "github.com/securebuildhq/securebuild/pkg/execution/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	sbpackagetypes "github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/pipeline"
	"go.uber.org/zap"
	"golang.org/x/crypto/ssh"
	"gopkg.in/yaml.v3"
)

type BuildPackageWithVMsAssignedPayload struct {
	PackageID        string `json:"packageId"`
	PackageVersionID string `json:"packageVersionId"`
	X86VMID          string `json:"x86VmId"`
	ARMVMID          string `json:"armVmId"`
	ExecutionID      string `json:"executionId"`
	X86WorkDir       string `json:"x86WorkDir,omitempty"`
	ARMWorkDir       string `json:"armWorkDir,omitempty"`
}

func handleBuildPackageWithVmsAssigned(ctx context.Context, payload string) error {
	logger.Debug("handling build package with vms assigned", zap.String("payload", payload))

	var p BuildPackageWithVMsAssignedPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return fmt.Errorf("failed to unmarshal build package with vms assigned payload: %w", err)
	}

	executionID := p.ExecutionID

	// CRITICAL: Check if both VMs exist before proceeding
	// This prevents worker leaks from retrying with deleted VMs
	logger.Debug("validating VM availability",
		zap.String("x86VMID", p.X86VMID),
		zap.String("armVMID", p.ARMVMID),
		zap.String("executionID", executionID))

	// Check x86 VM exists (only if assigned)
	if p.X86VMID != "" {
		_, err := builder.GetBuilderVM(ctx, p.X86VMID)
		if err != nil {
			if errors.Is(err, builder.ErrMachineNotFound) {
				logger.Warn("x86 VM not found for package build, failing task immediately",
					zap.String("x86VMID", p.X86VMID),
					zap.String("executionID", executionID),
					zap.Error(err))

				// Mark the execution as failed
				if statusErr := execution.UpdateExecutionStatus(ctx, executionID, executiontypes.ExecutionStatusVMDeleted); statusErr != nil {
					logger.Warn("failed to update execution status to VM deleted", zap.Error(statusErr))
				}

				// Return non-retryable error to prevent endless retries
				return NewNonRetryableError(fmt.Errorf("x86 VM %s not found (deleted)", p.X86VMID))
			}
			return fmt.Errorf("failed to get x86 VM: %w", err)
		}
	}

	// Check ARM VM exists (only if assigned)
	if p.ARMVMID != "" {
		_, err := builder.GetBuilderVM(ctx, p.ARMVMID)
		if err != nil {
			if errors.Is(err, builder.ErrMachineNotFound) {
				logger.Warn("ARM VM not found for package build, failing task immediately",
					zap.String("armVMID", p.ARMVMID),
					zap.String("executionID", executionID),
					zap.Error(err))

				// Mark the execution as failed
				if statusErr := execution.UpdateExecutionStatus(ctx, executionID, executiontypes.ExecutionStatusVMDeleted); statusErr != nil {
					logger.Warn("failed to update execution status to VM deleted", zap.Error(statusErr))
				}

				// Return non-retryable error to prevent endless retries
				return NewNonRetryableError(fmt.Errorf("ARM VM %s not found (deleted)", p.ARMVMID))
			}
			return fmt.Errorf("failed to get ARM VM: %w", err)
		}
	}

	pkgVersion, err := sbpackage.GetPackageVersion(ctx, p.PackageVersionID)
	if err != nil {
		return fmt.Errorf("failed to get package version: %w", err)
	}

	pkg, err := sbpackage.GetPackage(ctx, p.PackageID)
	if err != nil {
		return fmt.Errorf("failed to get package: %w", err)
	}

	useRoot, err := execution.GetExecutionUseRoot(ctx, p.ExecutionID)
	if err != nil {
		return fmt.Errorf("failed to get execution use root: %w", err)
	}

	if err := startBuildPackage(ctx, pkgVersion, pkg, p.ExecutionID, p.X86VMID, p.ARMVMID, p.X86WorkDir, p.ARMWorkDir, useRoot); err != nil {
		logger.Warn("EXECUTION FAILED: startBuildPackage failed - error during build package initialization",
			zap.String("executionID", p.ExecutionID),
			zap.String("packageID", p.PackageID),
			zap.String("packageVersionID", p.PackageVersionID),
			zap.String("x86VMID", p.X86VMID),
			zap.String("armVMID", p.ARMVMID),
			zap.Error(err))

		if err := execution.UpdateExecutionStatus(ctx, p.ExecutionID, executiontypes.ExecutionStatusFailed); err != nil {
			logger.Warn("failed to set execution status to failed", zap.Error(err))
		}
	}

	return nil
}

func runBackgroundCommand(client *ssh.Client, vmID string, command string) error {
	sess, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create ssh session: %w", err)
	}
	defer sess.Close()

	logger.Debug("Starting background command", zap.String("vmID", vmID))

	// Set up stdout and stderr pipes to capture output
	stdout, err := sess.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := sess.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start goroutines to read and log output
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			logger.Debug("background command stdout",
				zap.String("vmID", vmID),
				zap.String("output", scanner.Text()))
		}
		if err := scanner.Err(); err != nil {
			logger.Warn("error reading stdout from background command",
				zap.String("vmID", vmID),
				zap.Error(err))
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			logger.Debug("background command stderr",
				zap.String("vmID", vmID),
				zap.String("output", scanner.Text()))
		}
		if err := scanner.Err(); err != nil {
			logger.Warn("error reading stderr from background command",
				zap.String("vmID", vmID),
				zap.Error(err))
		}
	}()

	if err := sess.Start(command); err != nil {
		return fmt.Errorf("failed to start background command: %w", err)
	}

	return nil
}

var ErrVMNotFound = errors.New("vm not found")

func startBuildPackage(ctx context.Context, pkgVersion *sbpackagetypes.PackageVersion, pkg *sbpackagetypes.Package, executionID string, x86VMID string, armVMID string, x86WorkDir string, armWorkDir string, useRoot bool) error {
	logger.Debug("Building package with VMs assigned",
		zap.String("pkgVersionID", pkgVersion.ID),
		zap.String("pkgID", pkg.ID),
		zap.String("pkgName", pkg.Name),
		zap.String("pkgVersion", pkgVersion.Version),
		zap.Int("apkRelease", pkgVersion.APKRelease),
		zap.String("executionID", executionID),
		zap.String("x86VMID", x86VMID),
		zap.String("armVMID", armVMID),
		zap.String("x86WorkDir", x86WorkDir),
		zap.String("armWorkDir", armWorkDir),
		zap.Bool("useRoot", useRoot),
	)

	additionalFiles, err := sbpackage.ListPackageVersionAdditionalFiles(ctx, pkgVersion.ID)
	if err != nil {
		return fmt.Errorf("failed to get package version additional files: %w", err)
	}

	type archEntry struct {
		vm      *buildertypes.BuilderVM
		workDir string
	}
	arches := map[string]*archEntry{}

	if x86VMID != "" {
		x86VM, err := builder.GetBuilderVM(ctx, x86VMID)
		if err != nil {
			return fmt.Errorf("failed to get vm context: %w", err)
		}
		// On-demand VMs are provisioned without a work dir (the VM isn't
		// SSH-reachable at provision time). Resolve it to the remote $HOME now
		// that the VM is running, and persist it to the assignment so the build
		// status checker and cleanup can find it.
		if x86WorkDir == "" {
			x86WorkDir, err = builder.GetRemoteHome(ctx, x86VM)
			if err != nil {
				return fmt.Errorf("failed to resolve x86_64 work dir: %w", err)
			}
			if err := builder.AssignVMToTask(ctx, x86VMID, "build_package", executionID, x86WorkDir); err != nil {
				return fmt.Errorf("failed to persist x86_64 work dir: %w", err)
			}
		}
		arches["x86_64"] = &archEntry{vm: &x86VM, workDir: x86WorkDir}
	}

	if armVMID != "" {
		armVM, err := builder.GetBuilderVM(ctx, armVMID)
		if err != nil {
			return fmt.Errorf("failed to get vm context: %w", err)
		}
		if armWorkDir == "" {
			armWorkDir, err = builder.GetRemoteHome(ctx, armVM)
			if err != nil {
				return fmt.Errorf("failed to resolve aarch64 work dir: %w", err)
			}
			if err := builder.AssignVMToTask(ctx, armVMID, "build_package", executionID, armWorkDir); err != nil {
				return fmt.Errorf("failed to persist aarch64 work dir: %w", err)
			}
		}
		arches["aarch64"] = &archEntry{vm: &armVM, workDir: armWorkDir}
	}

	wg := sync.WaitGroup{}
	errChan := make(chan error, len(arches))

	// Track VMs and their build results
	type vmResult struct {
		vm      buildertypes.BuilderVM
		arch    string
		success bool
	}
	vmResults := make([]vmResult, 0, len(arches))
	vmResultsMutex := sync.Mutex{}

	if err := execution.UpdateExecutionStatus(ctx, executionID, executiontypes.ExecutionStatusBuilding); err != nil {
		return fmt.Errorf("failed to set execution status: %w", err)
	}

	for arch, entry := range arches {
		wg.Add(1)

		// Add VM to results tracking
		vmResultsMutex.Lock()
		vmResults = append(vmResults, vmResult{vm: *entry.vm, arch: arch, success: false})
		vmResultsMutex.Unlock()

		go func(arch string, entry *archEntry) {
			defer wg.Done()

			if err := execution.SetExecutionBuildStartedAt(ctx, executionID, arch); err != nil {
				logger.Warn("failed to set execution build started at", zap.Error(err))
			}

			if err := execution.SetExecutionBuilderID(ctx, executionID, arch, entry.vm.ID); err != nil {
				logger.Warn("failed to set execution builder ID", zap.Error(err))
			}

			if err := startBuildPackageForArch(ctx, *entry.vm, pkgVersion, pkg, arch, additionalFiles, executionID, entry.workDir, useRoot); err != nil {
				logger.Warn("failed to start build package for arch", zap.Error(err))
				errChan <- err
				return
			}
		}(arch, entry)
	}

	wg.Wait()
	close(errChan)

	// Check if any goroutines failed
	var errs []error
	for err := range errChan {
		errs = append(errs, err)
		logger.Warn("EXECUTION FAILED: startBuildPackageForArch failed - error during build package initialization for architecture",
			zap.String("executionID", executionID),
			zap.Error(err))
	}

	if len(errs) > 0 {
		logger.Warn("EXECUTION FAILED: one or more architectures failed during build package initialization",
			zap.String("executionID", executionID),
			zap.Int("failedArchitectures", len(errs)))

		if updateErr := execution.UpdateExecutionStatus(ctx, executionID, executiontypes.ExecutionStatusFailed); updateErr != nil {
			logger.Warn("failed to set execution status to failed", zap.Error(updateErr))
		}
		return fmt.Errorf("build failed to start for %d architecture(s): %v", len(errs), errs)
	}

	return nil
}

func startBuildPackageForArch(ctx context.Context, vm buildertypes.BuilderVM, pkgVersion *sbpackagetypes.PackageVersion, pkg *sbpackagetypes.Package, arch string, additionalFiles []sbpackagetypes.AdditionalFile, executionID string, workDir string, useRoot bool) error {
	logger.Debug("Building package for arch",
		zap.String("pkgVersionID", pkgVersion.ID),
		zap.String("pkgID", pkg.ID),
		zap.String("pkgName", pkg.Name),
		zap.String("pkgVersion", pkgVersion.Version),
		zap.Int("apkRelease", pkgVersion.APKRelease),
		zap.String("arch", arch),
		zap.String("workDir", workDir),
		zap.Bool("useRoot", useRoot),
	)

	runner, err := buildbackend.NewRunner(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to create runner for VM %s: %w", vm.ID, err)
	}
	defer runner.Close()

	// Ensure work dir exists on the build machine (required for SSH/remote; no-op for local)
	if err := runner.MkdirAll(workDir); err != nil {
		return fmt.Errorf("failed to create work dir: %w", err)
	}

	// write the execution id to the filesystem
	logger.Debug("writing execution id to filesystem", zap.String("vmID", vm.ID), zap.String("executionID", executionID), zap.String("arch", arch))
	if err := runner.WriteFile(filepath.Join(workDir, "execution_id"), executionID); err != nil {
		return fmt.Errorf("failed to create execution id file: %w", err)
	}

	if len(additionalFiles) > 0 {
		logger.Info("Applying additional files", zap.Int("count", len(additionalFiles)))

		for _, additionalFile := range additionalFiles {
			remotePaths := []string{
				filepath.Join(workDir, "patches", additionalFile.Path),
				filepath.Join(workDir, additionalFile.Path),
			}

			for _, remotePath := range remotePaths {
				dir := filepath.Dir(remotePath)

				// Create directory for each path
				if err := runner.MkdirAll(dir); err != nil {
					return fmt.Errorf("failed to create directory: %w", err)
				}

				logger.Debug("creating text file", zap.String("vmID", vm.ID), zap.String("path", remotePath))
				if err := runner.WriteFile(remotePath, additionalFile.Content); err != nil {
					return fmt.Errorf("failed to create additional file: %w", err)
				}
			}
		}
	}

	// Replace epoch in melange YAML with the actual release version
	melangeWithCorrectEpoch, err := replaceEpochInMelangeYAML(pkgVersion.MelangeYaml, pkgVersion.APKRelease)
	if err != nil {
		// Log warning but continue with original YAML if parsing fails
		logger.Warn("failed to replace epoch in melange YAML, using original",
			zap.String("packageVersionID", pkgVersion.ID),
			zap.Error(err))
		melangeWithCorrectEpoch = pkgVersion.MelangeYaml
	}

	if err := runner.WriteFile(filepath.Join(workDir, "melange.yaml"), melangeWithCorrectEpoch); err != nil {
		return err
	}

	if sshRunner, ok := runner.(*buildbackend.SSHRunner); ok {
		if err := pipeline.CopyAllPipelinesToVM(ctx, sshRunner.SSHClient(), &vm, workDir); err != nil {
			return fmt.Errorf("failed to copy pipelines: %w", err)
		}
	} else {
		if err := pipeline.CopyAllPipelinesLocal(ctx, workDir); err != nil {
			return fmt.Errorf("failed to copy pipelines: %w", err)
		}
	}

	// Builder binary path: CMX runs in HOME where builder is already installed; others copy into work dir.
	builderBin := filepath.Join(workDir, "builder")
	if vm.Type != "cmx" {
		// Copy the builder binary into the work dir so the build command can run it.
		// Local runner (Mac/Linux host): use binary for current runtime. Remote (static): use Linux for VM arch.
		var builderData []byte
		if _, isLocal := runner.(*buildbackend.LocalRunner); isLocal {
			if !builder.IsBuilderEmbeddedForRuntime() {
				return fmt.Errorf("builder binary is not embedded for current runtime (GOOS=%s GOARCH=%s)", runtime.GOOS, runtime.GOARCH)
			}
			builderData = builder.GetEmbeddedBuilderForRuntime()
		} else {
			if !builder.IsBuilderEmbedded(vm.Architecture) {
				return fmt.Errorf("builder binary is not embedded for architecture %s", vm.Architecture)
			}
			builderData = builder.GetEmbeddedBuilder(vm.Architecture)
		}
		if len(builderData) == 0 {
			return fmt.Errorf("embedded builder binary is empty")
		}
		if err := runner.WriteBinaryFile(builderBin, builderData); err != nil {
			return fmt.Errorf("failed to copy builder binary to work dir: %w", err)
		}
		if _, err := runner.RunCommand(ctx, fmt.Sprintf("chmod +x %s", builderBin)); err != nil {
			return fmt.Errorf("failed to make builder binary executable: %w", err)
		}

		if err := runner.RunSetup(ctx, workDir, builderBin, arch); err != nil {
			return fmt.Errorf("failed to run runner setup: %w", err)
		}
	}

	// 4. Run builder build
	apkRepositories := []string{}
	keyringAppends := []string{}

	// Handle bootstrap mode: user can override, set, or remove flags
	if pkgVersion.BootstrapEnabled {
		// Bootstrap mode: only use values if explicitly provided
		// Empty/null fields mean remove the flags entirely

		if pkgVersion.BootstrapApkRepository != nil && *pkgVersion.BootstrapApkRepository != "" {
			// Parse space-separated repositories
			repos := strings.Fields(strings.TrimSpace(*pkgVersion.BootstrapApkRepository))
			apkRepositories = repos
		}

		if pkgVersion.BootstrapKeyringAppend != nil && *pkgVersion.BootstrapKeyringAppend != "" {
			// Parse space-separated keyrings
			keyrings := strings.Fields(strings.TrimSpace(*pkgVersion.BootstrapKeyringAppend))
			keyringAppends = keyrings
		}

		if len(apkRepositories) == 0 {
			return fmt.Errorf("bootstrap apk repository is not set")
		}
	} else {
		apkRepo := param.GetParam(ctx).ApkRepository
		apkRepositories = []string{apkRepo}
		keyringAppends = []string{apkRepo + "/key/" + param.GetParam(ctx).APKPublicKeyName}
	}

	r2Directory := ""
	if param.GetParam(ctx).R2UseDynamicFolder {
		r2Directory, err = dynamicparam.GetDynamicParam(ctx, "r2_directory")
		if err != nil {
			return fmt.Errorf("failed to get r2 directory: %w", err)
		}
	}

	r2DirectoryFlag := ""
	if r2Directory != "" {
		r2DirectoryFlag = fmt.Sprintf(" --r2-directory %s", r2Directory)
	}

	// Build the command with conditional apk-repository and keyring-append flags
	apkRepositoryFlags := ""
	keyringAppendFlags := ""

	// Generate multiple --apk-repository flags
	for _, repo := range apkRepositories {
		if repo != "" {
			apkRepositoryFlags += fmt.Sprintf("--apk-repository %s ", repo)
		}
	}
	apkRepositoryFlags = strings.TrimSpace(apkRepositoryFlags)

	// Generate multiple --keyring-append flags
	for _, keyring := range keyringAppends {
		if keyring != "" {
			keyringAppendFlags += fmt.Sprintf("--keyring-append %s ", keyring)
		}
	}
	keyringAppendFlags = strings.TrimSpace(keyringAppendFlags)

	// Build command with conditional debug logging for bootstrap mode
	var cmd string
	if pkgVersion.BootstrapEnabled {
		// Bootstrap mode: show debug information
		debugApkRepos := "none"
		debugKeyrings := "none"
		if len(apkRepositories) > 0 {
			debugApkRepos = strings.Join(apkRepositories, ", ")
		}
		if len(keyringAppends) > 0 {
			debugKeyrings = strings.Join(keyringAppends, ", ")
		}

		// Build the flags section carefully to avoid empty lines
		flagsSection := ""
		if apkRepositoryFlags != "" {
			// Split multiple flags and add proper indentation
			for _, repo := range apkRepositories {
				if repo != "" {
					flagsSection += fmt.Sprintf("  --apk-repository %s \\\n", repo)
				}
			}
		}
		if keyringAppendFlags != "" {
			// Split multiple flags and add proper indentation
			for _, keyring := range keyringAppends {
				if keyring != "" {
					flagsSection += fmt.Sprintf("  --keyring-append %s \\\n", keyring)
				}
			}
		}

		builderBin := filepath.Join(workDir, "builder")
		builderLog := filepath.Join(workDir, fmt.Sprintf("builder_output_%s.log", arch))
		workDirEscaped := strings.ReplaceAll(workDir, "'", "'\\''")
		r2Region := param.GetParam(ctx).R2Region
		if r2Region == "" {
			r2Region = "auto"
		}
		cmd = fmt.Sprintf(`set -euo pipefail
cd '%s'
echo "Starting builder build for %s architecture at $(date)";
echo "BOOTSTRAP DEBUG: Bootstrap mode enabled";
echo "BOOTSTRAP DEBUG: APK Repositories: %s";
echo "BOOTSTRAP DEBUG: Keyring Appends: %s";
echo "BOOTSTRAP DEBUG: Use Root Mode: %t";
echo "BOOTSTRAP DEBUG: Bootstrap Flags: --empty-workspace --strip-origin-name --runner bubblewrap";
echo "BOOTSTRAP DEBUG: About to execute builder binary with flags";
nohup bash -c '
%s build --work-dir '%s' \
%s  --cloudflare-zone-id %s \
  --cloudflare-cache-purge-token %s \
  --r2-bucket-name %s \
  --r2-access-key %s \
  --r2-secret-key %s \
  --r2-endpoint %s \
  --r2-region %s \
  --enable-root-mode %t%s \
  --bootstrap-mode \
  %s
' > %s 2>&1 &
echo "Builder build backgrounded for %s architecture at $(date)";
echo "Builder output will be written to %s";
`, workDirEscaped, arch, debugApkRepos, debugKeyrings, useRoot, builderBin, workDirEscaped, flagsSection,
			param.GetParam(ctx).CloudflareZoneID, param.GetParam(ctx).CloudflareCachePurgeToken,
			param.GetParam(ctx).R2BucketName, param.GetParam(ctx).R2AccessKey, param.GetParam(ctx).R2SecretKey, param.GetParam(ctx).R2Endpoint, r2Region,
			useRoot, r2DirectoryFlag, arch, builderLog, arch, builderLog)
	} else {
		// Standard mode: no debug logging
		builderBin := filepath.Join(workDir, "builder")
		builderLog := filepath.Join(workDir, fmt.Sprintf("builder_output_%s.log", arch))
		workDirEscaped := strings.ReplaceAll(workDir, "'", "'\\''")
		r2Region := param.GetParam(ctx).R2Region
		if r2Region == "" {
			r2Region = "auto"
		}
		cmd = fmt.Sprintf(`set -euo pipefail
cd '%s'
echo "Starting builder build for %s architecture at $(date)";
nohup bash -c '
%s build --work-dir '%s' \
  %s \
  %s \
  --cloudflare-zone-id %s \
  --cloudflare-cache-purge-token %s \
  --r2-bucket-name %s \
  --r2-access-key %s \
  --r2-secret-key %s \
  --r2-endpoint %s \
  --r2-region %s \
  --enable-root-mode %t%s \
  %s
' > %s 2>&1 &
echo "Builder build backgrounded for %s architecture at $(date)";
echo "Builder output will be written to %s";
`, workDirEscaped, arch, builderBin, workDirEscaped,
			apkRepositoryFlags, keyringAppendFlags,
			param.GetParam(ctx).CloudflareZoneID, param.GetParam(ctx).CloudflareCachePurgeToken,
			param.GetParam(ctx).R2BucketName, param.GetParam(ctx).R2AccessKey, param.GetParam(ctx).R2SecretKey, param.GetParam(ctx).R2Endpoint, r2Region,
			useRoot, r2DirectoryFlag, arch, builderLog, arch, builderLog)
	}

	if err := execution.SetExecutionBuildCommand(ctx, executionID, arch, cmd, pkgVersion.BootstrapEnabled); err != nil {
		return fmt.Errorf("failed to set execution build command: %w", err)
	}

	// Log with conditional command details based on bootstrap mode
	if pkgVersion.BootstrapEnabled {
		// Bootstrap mode: show full command details with redacted secrets
		redactedCmd := cmd
		redactedCmd = strings.ReplaceAll(redactedCmd, param.GetParam(ctx).CloudflareCachePurgeToken, "***REDACTED***")
		redactedCmd = strings.ReplaceAll(redactedCmd, param.GetParam(ctx).R2AccessKey, "***REDACTED***")
		redactedCmd = strings.ReplaceAll(redactedCmd, param.GetParam(ctx).R2SecretKey, "***REDACTED***")

		logger.Info("Starting backgrounded builder build (Bootstrap Mode)",
			zap.String("vmID", vm.ID),
			zap.String("arch", arch),
			zap.String("package", pkg.Name),
			zap.String("version", pkgVersion.Version),
			zap.String("buildCommand", redactedCmd))
	} else {
		// Standard mode: minimal logging without command details
		logger.Info("Starting backgrounded builder build",
			zap.String("vmID", vm.ID),
			zap.String("arch", arch),
			zap.String("package", pkg.Name),
			zap.String("version", pkgVersion.Version))
	}

	// Update VM context with conditional command details
	vmCtx := builder.GetVMContext(vm.ID)
	if pkgVersion.BootstrapEnabled {
		// Bootstrap mode: store redacted command for debugging
		redactedCmd := cmd
		redactedCmd = strings.ReplaceAll(redactedCmd, param.GetParam(ctx).CloudflareCachePurgeToken, "***REDACTED***")
		redactedCmd = strings.ReplaceAll(redactedCmd, param.GetParam(ctx).R2AccessKey, "***REDACTED***")
		redactedCmd = strings.ReplaceAll(redactedCmd, param.GetParam(ctx).R2SecretKey, "***REDACTED***")
		vmCtx.UpdateLastCommand(redactedCmd)
	} else {
		// Standard mode: store generic message
		vmCtx.UpdateLastCommand("build command")
	}

	if err := runner.RunBackgroundCommand(ctx, cmd, executionID); err != nil {
		return fmt.Errorf("failed to start background builder build: %w", err)
	}

	return nil
}

// replaceEpochInMelangeYAML parses the melange YAML and replaces the epoch value with the actual APK release
func replaceEpochInMelangeYAML(melangeYAML string, apkRelease int) (string, error) {
	var data map[string]interface{}
	if err := yaml.Unmarshal([]byte(melangeYAML), &data); err != nil {
		return "", fmt.Errorf("failed to parse melange YAML: %w", err)
	}

	// Check if package section exists
	if pkg, ok := data["package"].(map[string]interface{}); ok {
		// Log the epoch replacement
		if oldEpoch, exists := pkg["epoch"]; exists {
			logger.Debug("replacing epoch in melange YAML",
				zap.Any("oldEpoch", oldEpoch),
				zap.Int("newEpoch", apkRelease))
		}
		// Replace epoch with the actual APK release
		pkg["epoch"] = apkRelease
	}

	// Marshal back to YAML
	result, err := yaml.Marshal(data)
	if err != nil {
		return "", fmt.Errorf("failed to marshal melange YAML: %w", err)
	}

	return string(result), nil
}
