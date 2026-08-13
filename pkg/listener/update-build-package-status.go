package listener

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/builder"
	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/execution"
	executiontypes "github.com/securebuildhq/securebuild/pkg/execution/types"
	"github.com/securebuildhq/securebuild/pkg/image"
	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	sbpackagetypes "github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

const (
	// DefaultPublishingTimeout is the maximum time allowed for publishing packages to R2
	// This prevents stuck uploads from blocking the system indefinitely
	DefaultPublishingTimeout = 30 * time.Minute

	// StatusFileTimeout is the maximum time to wait for the builder to create output/status.
	// If the file does not appear within this duration after build start, the execution is marked failed and logs are collected.
	StatusFileTimeout = 60 * time.Second
)

func StartBuildPackageStatusChecker(ctx context.Context) error {
	for {
		if err := handleUpdateBuildPackageStatus(ctx, `{}`); err != nil {
			return fmt.Errorf("failed to handle update build package status: %w", err)
		}

		time.Sleep(time.Second * 10)
	}
}

type UpdateBuildPackageStatusPayload struct{}

func handleUpdateBuildPackageStatus(ctx context.Context, payload string) error {
	executionIDs, err := execution.GetExecutionIDsWithStatus(ctx, executiontypes.ExecutionStatusBuilding)
	if err != nil {
		return fmt.Errorf("failed to get execution ids with status building: %w", err)
	}

	buildingExecutionIDs := []string{}
	for _, executionID := range executionIDs {
		buildingExecutionIDs = append(buildingExecutionIDs, executionID)
	}

	testingIDs, err := execution.GetExecutionIDsWithStatus(ctx, executiontypes.ExecutionStatusTesting)
	if err != nil {
		return fmt.Errorf("failed to get execution ids with status testing: %w", err)
	}

	publishingIDs, err := execution.GetExecutionIDsWithStatus(ctx, executiontypes.ExecutionStatusPublishing)
	if err != nil {
		return fmt.Errorf("failed to get execution ids with status publishing: %w", err)
	}

	executionIDs = append(buildingExecutionIDs, testingIDs...)
	executionIDs = append(executionIDs, publishingIDs...)

	var wg sync.WaitGroup
	wg.Add(len(executionIDs))

	for _, executionID := range executionIDs {
		go func(executionID string) {
			defer wg.Done()
			if err := updateBuildPackageStatus(ctx, executionID); err != nil {
				if errors.Is(err, builder.ErrMachineNotFound) {
					return
				}

				logger.Warn("failed to update build package status", zap.Error(err))
			}
		}(executionID)
	}

	wg.Wait()

	return nil
}

func updateBuildPackageStatus(ctx context.Context, executionID string) error {
	logger.Debug("updating build package status", zap.String("executionID", executionID))

	pkgVersionID, err := execution.GetPackageVersionIDForExecutionID(ctx, executionID)
	if err != nil {
		return fmt.Errorf("failed to get package version id: %w", err)
	}

	pkgVersion, err := sbpackage.GetPackageVersion(ctx, pkgVersionID)
	if err != nil {
		return fmt.Errorf("failed to get package version: %w", err)
	}

	x86BuilderID, err := execution.GetExecutionVMIDForArch(ctx, executionID, "x86_64")
	if err != nil {
		return fmt.Errorf("failed to get x86_64 builder id: %w", err)
	}
	x86Builder, err := builder.GetBuilderVM(ctx, x86BuilderID)
	if err != nil && !errors.Is(err, builder.ErrMachineNotFound) {
		return fmt.Errorf("failed to get x86_64 builder: %w", err)
	}
	logger.Debug("update-build-package-status: x86 builder lookup",
		zap.String("executionID", executionID),
		zap.String("x86BuilderID", x86BuilderID),
		zap.String("x86BuilderType", x86Builder.Type),
		zap.Bool("x86PrivateKeyEmpty", x86Builder.PrivateKey == ""),
		zap.Bool("x86ErrMachineNotFound", errors.Is(err, builder.ErrMachineNotFound)))

	aarch64BuilderID, err := execution.GetExecutionVMIDForArch(ctx, executionID, "aarch64")
	if err != nil {
		return fmt.Errorf("failed to get aarch64 builder id: %w", err)
	}
	aarch64Builder, err := builder.GetBuilderVM(ctx, aarch64BuilderID)
	if err != nil && !errors.Is(err, builder.ErrMachineNotFound) {
		return fmt.Errorf("failed to get aarch64 builder: %w", err)
	}
	logger.Debug("update-build-package-status: aarch64 builder lookup",
		zap.String("executionID", executionID),
		zap.String("aarch64BuilderID", aarch64BuilderID),
		zap.String("aarch64BuilderType", aarch64Builder.Type),
		zap.Bool("aarch64PrivateKeyEmpty", aarch64Builder.PrivateKey == ""),
		zap.Bool("aarch64ErrMachineNotFound", errors.Is(err, builder.ErrMachineNotFound)))

	x86BuildStatus, err := execution.GetExecutionBuildStatus(ctx, executionID, "x86_64")
	if err != nil {
		return fmt.Errorf("failed to get x86_64 build status: %w", err)
	}

	aarch64BuildStatus, err := execution.GetExecutionBuildStatus(ctx, executionID, "aarch64")
	if err != nil {
		return fmt.Errorf("failed to get aarch64 build status: %w", err)
	}

	// Look up work dirs from machine assignments for each arch
	assignments, err := builder.GetAssignmentsByTask(ctx, "build_package", executionID)
	if err != nil {
		logger.Warn("failed to get machine assignments for execution", zap.String("executionID", executionID), zap.Error(err))
	}
	assignmentWorkDirs := map[string]string{}
	for _, a := range assignments {
		assignmentWorkDirs[a.MachineID] = a.WorkDir
	}
	logger.Debug("update-build-package-status: assignments and work dirs",
		zap.String("executionID", executionID),
		zap.Int("assignmentCount", len(assignments)),
		zap.Any("assignmentWorkDirs", assignmentWorkDirs),
		zap.String("x86BuildStatus", x86BuildStatus),
		zap.String("aarch64BuildStatus", aarch64BuildStatus))

	// Only run build status checks for architectures that are actually assigned to this execution.
	// Local backend may have only one arch (e.g. aarch64); static may have one or two; CMX has both.
	if x86BuilderID != "" && x86BuildStatus != "success" {
		// Skip status check only for CMX VMs that don't have a private key yet (still provisioning).
		// Local and static VMs have no SSH key or use key path; they are ready immediately.
		if (x86Builder.Type == "cmx" || x86Builder.Type == "") && x86Builder.PrivateKey == "" {
			logger.Debug("skipping x86_64 build status check - VM still provisioning",
				zap.String("executionID", executionID),
				zap.String("vmID", x86BuilderID),
				zap.String("vmType", x86Builder.Type))
		} else {
			x86WorkDir := assignmentWorkDirs[x86BuilderID]
			logger.Debug("update-build-package-status: checking x86_64 build status",
				zap.String("executionID", executionID),
				zap.String("x86WorkDir", x86WorkDir))
			x86BuildComplete, buildErr := isBuildStatusComplete(ctx, x86Builder, executionID, "x86_64", pkgVersion, x86WorkDir)
			if buildErr != nil && buildErr != ErrBuildFailed {
				return fmt.Errorf("failed to check x86_64 build status: %w", buildErr)
			}

			if x86BuildComplete {
				if err := execution.SetExecutionBuildFinishedAt(ctx, executionID, "x86_64"); err != nil {
					logger.Warn("failed to set execution build finished at", zap.Error(err))
				}
			}
		}
	}

	if aarch64BuilderID != "" && aarch64BuildStatus != "success" {
		// Skip status check only for CMX VMs that don't have a private key yet (still provisioning).
		// Local and static VMs have no SSH key or use key path; they are ready immediately.
		if (aarch64Builder.Type == "cmx" || aarch64Builder.Type == "") && aarch64Builder.PrivateKey == "" {
			logger.Debug("skipping aarch64 build status check - VM still provisioning",
				zap.String("executionID", executionID),
				zap.String("vmID", aarch64BuilderID),
				zap.String("vmType", aarch64Builder.Type))
		} else {
			aarch64WorkDir := assignmentWorkDirs[aarch64BuilderID]
			logger.Debug("update-build-package-status: checking aarch64 build status",
				zap.String("executionID", executionID),
				zap.String("aarch64WorkDir", aarch64WorkDir))
			aarch64BuildComplete, buildErr := isBuildStatusComplete(ctx, aarch64Builder, executionID, "aarch64", pkgVersion, aarch64WorkDir)
			if buildErr != nil && buildErr != ErrBuildFailed {
				return fmt.Errorf("failed to check aarch64 build status: %w", buildErr)
			}

			if aarch64BuildComplete {
				if err := execution.SetExecutionBuildFinishedAt(ctx, executionID, "aarch64"); err != nil {
					logger.Warn("failed to set execution build finished at", zap.Error(err))
				}
			}
		}
	}

	updatedX86BuildStatus, err := execution.GetExecutionBuildStatus(ctx, executionID, "x86_64")
	if err != nil {
		return fmt.Errorf("failed to get x86_64 build status: %w", err)
	}

	updatedAarch64BuildStatus, err := execution.GetExecutionBuildStatus(ctx, executionID, "aarch64")
	if err != nil {
		return fmt.Errorf("failed to get aarch64 build status: %w", err)
	}

	// Check for publishing timeouts (builds have no timeout, but publishing can hang)
	// Uses DefaultPublishingTimeout constant defined at package level
	if updatedX86BuildStatus == "publishing" {
		lastStatusUpdatedAt, err := execution.GetExecutionBuildStatusUpdatedAt(ctx, executionID, "x86_64")
		if err != nil {
			return fmt.Errorf("failed to get x86_64 build status updated at: %w", err)
		}

		if lastStatusUpdatedAt != nil && time.Since(*lastStatusUpdatedAt) > DefaultPublishingTimeout {
			logger.Warn("EXECUTION FAILED: x86_64 publishing timeout exceeded",
				zap.String("executionID", executionID),
				zap.String("arch", "x86_64"),
				zap.Time("lastStatusUpdatedAt", *lastStatusUpdatedAt),
				zap.Duration("timeStuck", time.Since(*lastStatusUpdatedAt)),
				zap.Duration("timeout", DefaultPublishingTimeout))

			if err := execution.UpdateExecutionStatus(ctx, executionID, executiontypes.ExecutionStatusFailed); err != nil {
				return fmt.Errorf("failed to update execution status: %w", err)
			}

			return nil
		}
	}

	if updatedAarch64BuildStatus == "publishing" {
		lastStatusUpdatedAt, err := execution.GetExecutionBuildStatusUpdatedAt(ctx, executionID, "aarch64")
		if err != nil {
			return fmt.Errorf("failed to get aarch64 build status updated at: %w", err)
		}

		if lastStatusUpdatedAt != nil && time.Since(*lastStatusUpdatedAt) > DefaultPublishingTimeout {
			logger.Warn("EXECUTION FAILED: aarch64 publishing timeout exceeded",
				zap.String("executionID", executionID),
				zap.String("arch", "aarch64"),
				zap.Time("lastStatusUpdatedAt", *lastStatusUpdatedAt),
				zap.Duration("timeStuck", time.Since(*lastStatusUpdatedAt)),
				zap.Duration("timeout", DefaultPublishingTimeout))

			if err := execution.UpdateExecutionStatus(ctx, executionID, executiontypes.ExecutionStatusFailed); err != nil {
				return fmt.Errorf("failed to update execution status: %w", err)
			}

			return nil
		}
	}

	// All assigned arches must be success. Unassigned arch (no VM for that arch) counts as done.
	x86Done := x86BuilderID == "" || updatedX86BuildStatus == "success"
	aarch64Done := aarch64BuilderID == "" || updatedAarch64BuildStatus == "success"
	if x86Done && aarch64Done && (x86BuilderID != "" || aarch64BuilderID != "") {
		if err := execution.UpdateExecutionStatus(ctx, executionID, executiontypes.ExecutionStatusSuccess); err != nil {
			return fmt.Errorf("failed to set execution status: %w", err)
		}

		// Check if this execution is part of a custom build request
		customBuildRequestID, err := sbpackage.GetCustomBuildRequestIDForPackageVersion(ctx, pkgVersionID)
		if err != nil {
			return fmt.Errorf("failed to get custom build request id: %w", err)
		}

		if customBuildRequestID != "" {
			// This package build is part of a custom build request
			// Check if all packages for this custom_build_request_id are complete
			packageVersions, err := sbpackage.GetPackageVersionsByCustomBuildRequestID(ctx, customBuildRequestID)
			if err != nil {
				return fmt.Errorf("failed to get package versions for custom build request: %w", err)
			}

			allPackagesComplete := true
			for _, pkgVer := range packageVersions {
				// Check if this package version has a successful execution
				executions, err := execution.GetExecutionsByPackageVersionID(ctx, pkgVer.ID)
				if err != nil {
					return fmt.Errorf("failed to get executions for package version: %w", err)
				}

				hasSuccessfulExecution := false
				for _, exec := range executions {
					if exec.Status == string(executiontypes.ExecutionStatusSuccess) {
						hasSuccessfulExecution = true
						break
					}
				}

				if !hasSuccessfulExecution {
					allPackagesComplete = false
					break
				}
			}

			if allPackagesComplete {
				// All packages built successfully, trigger image build
				logger.Info("all packages complete for custom build request, triggering image build",
					zap.String("customBuildRequestID", customBuildRequestID),
					zap.String("executionID", executionID))

				if err := triggerCustomImageBuild(ctx, customBuildRequestID); err != nil {
					logger.Warn("failed to trigger custom image build",
						zap.String("customBuildRequestID", customBuildRequestID),
						zap.Error(err))
				}
			}
		}

		// Update all build and runtime dependencies to the most recently built versions
		runtimeDeps, err := sbpackage.ListPackageVersionRuntimeDependencies(ctx, pkgVersion.ID)
		if err != nil {
			return fmt.Errorf("failed to list package version runtime dependencies: %w", err)
		}

		buildDeps, err := sbpackage.ListPackageVersionBuildDependencies(ctx, pkgVersion.ID)
		if err != nil {
			return fmt.Errorf("failed to list package version build dependencies: %w", err)
		}
		resolvedProviders, err := sbpackage.GetPreferredAvailableProviderVersions(ctx, append(append([]string{}, runtimeDeps...), buildDeps...))
		if err != nil {
			return fmt.Errorf("failed to resolve dependency providers: %w", err)
		}

		for _, dep := range runtimeDeps {
			latestPackageVersion, ok := resolvedProviders[dep]
			if !ok {
				logger.Debug("failed to resolve runtime dependency provider", zap.String("dependency", dep))
				continue
			}

			if err := sbpackage.SetPackageVersionRuntimeDependencyVersion(ctx, pkgVersion, dep, latestPackageVersion); err != nil {
				return fmt.Errorf("failed to set package version runtime dependency version: %w", err)
			}
		}

		for _, dep := range buildDeps {
			latestPackageVersion, ok := resolvedProviders[dep]
			if !ok {
				logger.Debug("failed to resolve build dependency provider", zap.String("dependency", dep))
				continue
			}

			if err := sbpackage.SetPackageVersionBuildDependencyVersion(ctx, pkgVersion, dep, latestPackageVersion); err != nil {
				return fmt.Errorf("failed to set package version build dependency version: %w", err)
			}
		}

		// Queue build_image_with_vm_assigned events for images that depend on this package
		if err := queueBuildApkoEventsForPackage(ctx, pkgVersion.PackageID, pkgVersion.Version); err != nil {
			logger.Error(fmt.Errorf("failed to queue build_image_with_vm_assigned events for dependent images: %w", err),
				zap.String("packageID", pkgVersion.PackageID),
				zap.Error(err))
		}

		return nil
	}

	if updatedX86BuildStatus == "failed" || updatedAarch64BuildStatus == "failed" {
		logger.Warn("EXECUTION FAILED: one or both architectures reported build failure",
			zap.String("executionID", executionID),
			zap.String("x86_64_status", updatedX86BuildStatus),
			zap.String("aarch64_status", updatedAarch64BuildStatus))

		if err := execution.UpdateExecutionStatus(ctx, executionID, executiontypes.ExecutionStatusFailed); err != nil {
			return fmt.Errorf("failed to set execution status: %w", err)
		}

		return nil
	}

	if updatedX86BuildStatus == "testing" || updatedAarch64BuildStatus == "testing" {
		if err := execution.UpdateExecutionStatus(ctx, executionID, executiontypes.ExecutionStatusTesting); err != nil {
			return fmt.Errorf("failed to set execution status: %w", err)
		}

		return nil
	}

	if updatedX86BuildStatus == "publishing" || updatedAarch64BuildStatus == "publishing" {
		if err := execution.UpdateExecutionStatus(ctx, executionID, executiontypes.ExecutionStatusPublishing); err != nil {
			return fmt.Errorf("failed to set execution status: %w", err)
		}

		return nil
	}

	return nil
}

var ErrBuildFailed = errors.New("build failed")

// earliestBuildStartedAt returns the earlier of x86_64 and aarch64 build started at, or nil if both are nil.
func earliestBuildStartedAt(exe *executiontypes.Execution) *time.Time {
	if exe == nil {
		return nil
	}
	if exe.X86_64BuildStartedAt != nil && exe.Aarch64BuildStartedAt != nil {
		if exe.X86_64BuildStartedAt.Before(*exe.Aarch64BuildStartedAt) {
			return exe.X86_64BuildStartedAt
		}
		return exe.Aarch64BuildStartedAt
	}
	if exe.X86_64BuildStartedAt != nil {
		return exe.X86_64BuildStartedAt
	}
	return exe.Aarch64BuildStartedAt
}

// returns true if build is complete, false if not, and an error if there is an error
func isBuildStatusComplete(ctx context.Context, vm buildertypes.BuilderVM, exeID string, arch string, pkgVersion *sbpackagetypes.PackageVersion, workDir string) (bool, error) {
	// Resolve work directory: use provided value, fall back to assignment lookup
	if workDir == "" {
		wd, err := builder.GetWorkDirForTask(ctx, "build_package", exeID, vm.ID)
		if err != nil {
			return false, fmt.Errorf("failed to get work dir for build %s: %w", exeID, err)
		}
		workDir = wd
	}

	runner, err := buildbackend.NewRunner(ctx, vm)
	if err != nil {
		logger.Warn("EXECUTION FAILED: failed to create runner for build status check",
			zap.String("executionID", exeID),
			zap.String("arch", arch),
			zap.String("vmID", vm.ID),
			zap.Error(err))

		if updateErr := execution.UpdateExecutionStatus(ctx, exeID, executiontypes.ExecutionStatusFailed); updateErr != nil {
			logger.Warn("failed to update execution status", zap.Error(updateErr))
		}

		return false, fmt.Errorf("failed to create runner: %w", err)
	}
	defer runner.Close()

	statusFilePath := filepath.Join(workDir, "output", "status")
	statusContent, err := runner.ReadFile(statusFilePath)
	if err != nil {
		// If status file has not appeared after StatusFileTimeout, abort and collect logs
		exe, getErr := execution.GetExecution(ctx, exeID)
		earliestStarted := earliestBuildStartedAt(exe)
		if getErr == nil && exe != nil && earliestStarted != nil && time.Since(*earliestStarted) >= StatusFileTimeout {
			logger.Warn("EXECUTION FAILED: status file did not appear within timeout - aborting and collecting logs",
				zap.String("executionID", exeID),
				zap.String("arch", arch),
				zap.String("statusFilePath", statusFilePath),
				zap.Duration("timeout", StatusFileTimeout),
				zap.Time("buildStartedAt", *earliestStarted))

			collectBuildOutput(ctx, runner, arch, exeID, workDir)
			collectPublishOutput(ctx, runner, arch, exeID, workDir)
			_ = execution.SetArchStatus(ctx, exeID, arch, "failed")
			_ = execution.SetExecutionBuildExitCode(ctx, exeID, arch, 1)
			if updateErr := execution.UpdateExecutionStatus(ctx, exeID, executiontypes.ExecutionStatusFailed); updateErr != nil {
				logger.Warn("failed to update execution status to failed after status file timeout", zap.Error(updateErr))
			}
			return false, nil
		}
		return false, fmt.Errorf("failed to read status file: %w", err)
	}

	// Trim whitespace for status comparisons
	statusContent = strings.TrimSpace(statusContent)

	collectBuildOutput(ctx, runner, arch, exeID, workDir)

	collectPublishOutput(ctx, runner, arch, exeID, workDir)

	// Update arch status immediately after reading the status file
	if err := execution.SetArchStatus(ctx, exeID, arch, statusContent); err != nil {
		logger.Warn("failed to set arch status", zap.Error(err))
	}

	if statusContent == "" || statusContent == "building" || statusContent == "testing" || statusContent == "publishing" {
		return false, nil
	}

	completionFile := filepath.Join(workDir, "output", fmt.Sprintf("melange_done_%s.txt", arch))
	exitCode, err := checkBuildCompletion(runner, completionFile)
	if err != nil {
		return false, fmt.Errorf("failed to check build completion: %w", err)
	}

	// Check test completion file if build succeeded
	if exitCode == 0 {
		testCompletionFile := filepath.Join(workDir, "output", fmt.Sprintf("melange_test_done_%s.txt", arch))
		testExitCode, testErr := checkBuildCompletion(runner, testCompletionFile)
		if testErr != nil {
			return false, fmt.Errorf("failed to check test completion: %w", testErr)
		}
		// Use test exit code if tests were run
		if testExitCode != 0 {
			exitCode = testExitCode
		}
	}

	// Collect final output
	collectBuildOutput(ctx, runner, arch, exeID, workDir)

	collectPublishOutput(ctx, runner, arch, exeID, workDir)

	if err := execution.SetExecutionBuildExitCode(ctx, exeID, arch, exitCode); err != nil {
		logger.Warn("failed to set execution build exit code", zap.Error(err))
	}

	if exitCode != 0 || statusContent == "failed" {
		return true, ErrBuildFailed
	}

	return true, nil
}

func checkBuildCompletion(runner buildbackend.Runner, completionFile string) (int, error) {
	content, err := runner.ReadFile(completionFile)
	if err != nil {
		return 0, nil // File doesn't exist yet
	}

	outputStr := strings.TrimSpace(content)
	if outputStr == "" {
		return 0, nil // File is empty
	}

	exitCode, err := strconv.Atoi(outputStr)
	if err != nil {
		return 0, fmt.Errorf("failed to parse exit code: %w", err)
	}

	return exitCode, nil
}

func collectBuildOutput(ctx context.Context, runner buildbackend.Runner, arch string, executionID string, workDir string) {
	bootstrapLogFile := filepath.Join(workDir, fmt.Sprintf("builder_output_%s.log", arch))
	if content, err := runner.ReadFileTail(bootstrapLogFile, 10240); err == nil && content != "" {
		// Bootstrap build: use the combined output from builder_output_{arch}.log
		// This contains both the melange stdout and stderr combined
		content = strings.TrimRight(content, "\n\r")
		if err := execution.SetExecutionBuildStdout(ctx, executionID, arch, content); err != nil {
			logger.Warn("failed to set bootstrap stdout", zap.Error(err))
		}
		// For bootstrap builds, stderr is empty since everything goes to the combined log
		if err := execution.SetExecutionBuildStderr(ctx, executionID, arch, ""); err != nil {
			logger.Warn("failed to set bootstrap stderr", zap.Error(err))
		}
		logger.Debug("collected bootstrap build output",
			zap.String("arch", arch),
			zap.String("executionID", executionID),
			zap.Int("contentLength", len(content)))
	} else if err != nil {
		logger.Warn("failed to read bootstrap build output", zap.String("bootstrapLogFile", bootstrapLogFile), zap.Error(err))
	}

	stdoutFile := filepath.Join(workDir, "output", fmt.Sprintf("melange_stdout_%s.log", arch))
	if content, err := runner.ReadFileTail(stdoutFile, 10240); err == nil && content != "" {
		// Only trim trailing newlines from build logs to preserve internal formatting
		content = strings.TrimRight(content, "\n\r")
		if err := execution.SetExecutionBuildStdout(ctx, executionID, arch, content); err != nil {
			logger.Warn("failed to set stdout", zap.Error(err))
		}
	} else if err != nil {
		logger.Warn("failed to read melange stdout file", zap.String("stdoutFile", stdoutFile), zap.Error(err))
	}

	stderrFile := filepath.Join(workDir, "output", fmt.Sprintf("melange_stderr_%s.log", arch))
	if content, err := runner.ReadFileTail(stderrFile, 10240); err == nil && content != "" {
		// Only trim trailing newlines from build logs to preserve internal formatting
		content = strings.TrimRight(content, "\n\r")
		if err := execution.SetExecutionBuildStderr(ctx, executionID, arch, content); err != nil {
			logger.Warn("failed to set stderr", zap.Error(err))
		}
	} else if err != nil {
		logger.Warn("failed to read melange stderr file", zap.String("stderrFile", stderrFile), zap.Error(err))
	}
}

func collectPublishOutput(ctx context.Context, runner buildbackend.Runner, arch string, executionID string, workDir string) {
	combinedFile := filepath.Join(workDir, "output", "publishing-log.txt")
	if content, err := runner.ReadFile(combinedFile); err == nil && content != "" {
		if err := execution.SetExecutionPublishOutput(ctx, executionID, arch, content); err != nil {
			logger.Warn("failed to append publish stdout", zap.Error(err))
		}
	}
}

// queueBuildApkoEventsForPackage enqueues build_apko events for APKOs that depend on the given package.
// VM assignment and image build creation happen asynchronously in the build_apko handler, so the status checker is not blocked.
func queueBuildApkoEventsForPackage(ctx context.Context, packageID string, version string) error {
	// Get the package info for logging
	pkg, err := sbpackage.GetPackage(ctx, packageID)
	if err != nil {
		return fmt.Errorf("failed to get package: %w", err)
	}

	// Get APKOs that depend on this package with this specific version
	logger.Debug("Checking for APKOs depending on package",
		zap.String("packageID", packageID),
		zap.String("packageName", pkg.Name),
		zap.String("version", version))

	apkoIDs, err := image.GetAPKOsDependingOnPackage(ctx, packageID, version)
	if err != nil {
		return fmt.Errorf("failed to get APKOs depending on package: %w", err)
	}

	logger.Debug("Found APKOs depending on package",
		zap.String("packageID", packageID),
		zap.String("version", version),
		zap.Int("apkoCount", len(apkoIDs)),
		zap.Strings("apkoIDs", apkoIDs))

	for _, apkoID := range apkoIDs {
		// Get image ID for this APKO (build_apko handler expects imageId + apkoId)
		_, imageID, err := image.GetAPKO(ctx, apkoID)
		if err != nil {
			logger.Warn("failed to get APKO for dependent image build",
				zap.String("apkoID", apkoID),
				zap.Error(err))
			continue
		}

		payload := BuildAPKOPayload{
			ImageID: imageID,
			APKOID:  apkoID,
		}
		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			logger.Warn("failed to marshal build_apko payload",
				zap.String("apkoID", apkoID),
				zap.Error(err))
			continue
		}

		if err := persistence.EnqueueWork(ctx, "build_apko", string(payloadJSON)); err != nil {
			logger.Warn("failed to enqueue build_apko event",
				zap.String("packageID", packageID),
				zap.String("apkoID", apkoID),
				zap.Error(err))
			continue
		}

		logger.Info("queued build_apko event for dependent APKO",
			zap.String("packageID", packageID),
			zap.String("apkoID", apkoID))
	}

	return nil
}

// triggerCustomImageBuild creates image builds and enqueues build_image_with_vm_assigned events
// for all image_apko_versions associated with a custom build request
func triggerCustomImageBuild(ctx context.Context, customBuildRequestID string) error {
	// Find image_apko_version records created for this custom build request
	apkoVersions, err := image.GetImageAPKOVersionsByCustomBuildRequestID(ctx, customBuildRequestID)
	if err != nil {
		updateCustomBuildRequestError(ctx, customBuildRequestID, "failed", fmt.Sprintf("failed to get APKO versions: %v", err))
		return fmt.Errorf("failed to get APKO versions: %w", err)
	}

	if len(apkoVersions) == 0 {
		logger.Warn("no image apko versions found for custom build request",
			zap.String("customBuildRequestID", customBuildRequestID))
		return nil
	}

	logger.Info("found image apko versions for custom build request",
		zap.String("customBuildRequestID", customBuildRequestID),
		zap.Int("count", len(apkoVersions)))

	// Create image_build records for each APKO version and enqueue builds
	for _, apkoVersion := range apkoVersions {
		imageBuild, err := image.CreateImageBuild(ctx, apkoVersion.ID)
		if err != nil {
			updateCustomBuildRequestError(ctx, customBuildRequestID, "failed", fmt.Sprintf("failed to create image build: %v", err))
			return fmt.Errorf("failed to create image build: %w", err)
		}

		// Update build status to queued
		if err := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusQueued); err != nil {
			logger.Warn("failed to update image build status to queued", zap.Error(err))
		}

		// Assign VM for image building using the build backend
		logger.Debug("assigning VM for custom image build",
			zap.String("buildID", imageBuild.ID),
			zap.String("apkoVersionID", apkoVersion.ID))

		vmID, _, err := assignVMForImageBuild(ctx, imageBuild.ID)
		if err != nil {
			logger.Warn("IMAGE BUILD FAILED: VM assignment failure - could not assign VM for custom image build",
				zap.String("buildID", imageBuild.ID),
				zap.String("apkoVersionID", apkoVersion.ID),
				zap.String("customBuildRequestID", customBuildRequestID),
				zap.Error(err))

			// Mark build as failed
			if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("VM assignment failure: %w", err)); statusErr != nil {
				logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
			}
			continue
		}

		// Update build record with VM ID
		if err := image.SetImageBuildBuilderID(ctx, imageBuild.ID, vmID); err != nil {
			logger.Warn("failed to set image build builder ID", zap.Error(err))
		}

		// Create payload for build_image_with_vm_assigned event
		payload := BuildImageWithVMAssignedPayload{
			VMID:    vmID,
			BuildID: imageBuild.ID,
		}

		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			logger.Warn("failed to marshal build_image_with_vm_assigned payload",
				zap.String("apkoVersionID", apkoVersion.ID),
				zap.String("customBuildRequestID", customBuildRequestID),
				zap.Error(err))

			// Mark build as failed
			if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("JSON marshalling failure: %w", err)); statusErr != nil {
				logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
			}
			continue
		}

		if err := persistence.EnqueueWork(ctx, "build_image_with_vm_assigned", string(payloadJSON)); err != nil {
			logger.Warn("failed to enqueue build_image_with_vm_assigned event",
				zap.String("apkoVersionID", apkoVersion.ID),
				zap.String("customBuildRequestID", customBuildRequestID),
				zap.Error(err))

			// Mark build as failed
			if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("work queue enqueue failure: %w", err)); statusErr != nil {
				logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
			}
			continue
		}

		logger.Info("queued build_image_with_vm_assigned event for custom build request",
			zap.String("customBuildRequestID", customBuildRequestID),
			zap.String("apkoVersionID", apkoVersion.ID),
			zap.String("imageBuildID", imageBuild.ID))
	}

	return nil
}
