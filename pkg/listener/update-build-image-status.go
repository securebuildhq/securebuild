package listener

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/anchore/grype/grype/presenter/models"
	"github.com/anchore/syft/syft/format/syftjson"
	syftpkg "github.com/anchore/syft/syft/pkg"
	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote"

	cosign "github.com/securebuildhq/securebuild/pkg/cosign"
	oidc "github.com/securebuildhq/securebuild/pkg/oidc"
	"google.golang.org/api/option"

	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/builder"
	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/image"
	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	oci "github.com/securebuildhq/securebuild/pkg/oci"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/registry"
	"github.com/securebuildhq/securebuild/pkg/security"
	"go.uber.org/zap"
)

func StartBuildImageStatusChecker(ctx context.Context) error {
	for {
		if err := handleUpdateBuildImageStatus(ctx, `{}`); err != nil {
			return fmt.Errorf("failed to handle update build image status: %w", err)
		}

		time.Sleep(time.Second * 10)
	}
}

type UpdateBuildImageStatusPayload struct{}

func handleUpdateBuildImageStatus(ctx context.Context, payload string) error {
	// Get builds in all active statuses (building, testing, publishing)
	activeStatuses := []imagetypes.ImageBuildStatus{
		imagetypes.ImageBuildStatusBuilding,
		imagetypes.ImageBuildStatusTesting,
		imagetypes.ImageBuildStatusPublishing,
	}

	buildIDs, err := image.GetImageBuildIDsWithStatuses(ctx, activeStatuses)
	if err != nil {
		return fmt.Errorf("failed to get image build ids with active statuses: %w", err)
	}

	// Check for builds that have been running for too long
	timedOutBuilds, err := image.GetTimedOutImageBuilds(ctx)
	if err != nil {
		return fmt.Errorf("failed to get timed out image builds: %w", err)
	}

	// Fail any timed out builds
	for _, buildID := range timedOutBuilds {
		logger.Warn("IMAGE BUILD FAILED: build timeout - image build has been in building status for over 30 minutes",
			zap.String("buildID", buildID))

		if err := image.UpdateImageBuildStatus(ctx, buildID, imagetypes.ImageBuildStatusTimedOut); err != nil {
			logger.Warn("failed to update timed out image build status to failed", zap.Error(err), zap.String("buildID", buildID))
		}
	}

	activeBuildIDs := []string{}
	for _, buildID := range buildIDs {
		if !slices.Contains(timedOutBuilds, buildID) {
			activeBuildIDs = append(activeBuildIDs, buildID)
		}
	}

	var wg sync.WaitGroup
	wg.Add(len(activeBuildIDs))

	for _, buildID := range activeBuildIDs {
		go func(buildID string) {
			defer wg.Done()
			if err := updateBuildImageStatus(ctx, buildID); err != nil {
				if errors.Is(err, builder.ErrMachineNotFound) {
					return
				}

				logger.Warn("failed to update build image status", zap.Error(err))
			}
		}(buildID)
	}

	wg.Wait()

	return nil
}

func updateBuildImageStatus(ctx context.Context, buildID string) error {
	imageBuild, err := image.GetImageBuildByID(ctx, buildID)
	if err != nil {
		return fmt.Errorf("failed to get image build: %w", err)
	}

	if imageBuild.BuilderID == nil {
		// Build hasn't been assigned to a builder yet
		return nil
	}

	builderVM, err := builder.GetBuilderVM(ctx, *imageBuild.BuilderID)
	if err != nil {
		if errors.Is(err, builder.ErrMachineNotFound) {
			// VM was deleted, mark build as failed
			logger.Warn("IMAGE BUILD FAILED: VM was deleted",
				zap.String("buildID", buildID),
				zap.String("builderID", *imageBuild.BuilderID))

			if err := image.UpdateImageBuildStatus(ctx, buildID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("VM was deleted")); err != nil {
				logger.Warn("failed to update image build status to failed", zap.Error(err), zap.String("buildID", buildID))
			}
			return nil
		}
		return fmt.Errorf("failed to get builder VM: %w", err)
	}

	// Check if build is still running by checking VM status
	// This is a simplified check - in a real implementation you might check for specific processes
	if builderVM.Status != "running" {
		logger.Warn("IMAGE BUILD FAILED: VM is not running",
			zap.String("buildID", buildID),
			zap.String("builderID", *imageBuild.BuilderID),
			zap.String("vmStatus", builderVM.Status))

		if err := image.UpdateImageBuildStatus(ctx, buildID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("VM is not running (status: %s)", builderVM.Status)); err != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(err))
		}
		return nil
	}

	// Capture builder logs before completion handling so the machine assignment still exists
	// (cleanup deletes the assignment when we mark the build success)
	if err := captureBuilderLogs(ctx, buildID, &builderVM); err != nil {
		logger.Warn("failed to capture builder logs", zap.Error(err), zap.String("buildID", buildID))
	}

	// Check if build has completed and download results if so
	if err := checkAndHandleBuildCompletion(ctx, buildID, &builderVM); err != nil {
		logger.Warn("failed to check and handle build completion", zap.Error(err), zap.String("buildID", buildID))
	}

	return nil
}

// checkAndHandleBuildCompletion checks if the build has completed and downloads results if so
func checkAndHandleBuildCompletion(ctx context.Context, buildID string, builderVM *buildertypes.BuilderVM) error {
	runner, err := buildbackend.NewRunner(ctx, *builderVM)
	if err != nil {
		return fmt.Errorf("failed to create runner: %w", err)
	}
	defer runner.Close()

	// Resolve the work directory (where builder wrote builder-status, SBOMs, etc.)
	buildDir, err := builder.GetWorkDirForTask(ctx, "build_image", buildID, builderVM.ID)
	if err != nil {
		return fmt.Errorf("failed to get work dir for image build %s: %w", buildID, err)
	}

	// Check for build status by reading the status file written by builder
	// Status values: building, testing, publishing, success, failed
	statusFile := filepath.Join(buildDir, "builder-status")
	exists, err := runner.FileExists(statusFile)
	if err != nil {
		return nil
	}

	var status string
	var isStatusFileMissing bool
	if !exists {
		status = "building"
		isStatusFileMissing = true
	} else {
		statusContent, err := runner.ReadFile(statusFile)
		if err != nil {
			return nil
		}
		status = strings.TrimSpace(statusContent)
		isStatusFileMissing = false
	}

	// If builder-status file is still missing long after the build started, the builder
	// likely failed to start (e.g. binary not found). Mark the build failed so it does not stay stuck.
	// This is an edge case when process fails to start, but the exist code is 0 (because of nohup and shell wrappers). On average, we are not going to be waiting for 5 minutes.
	if status == "building" && isStatusFileMissing {
		imageBuild, err := image.GetImageBuildByID(ctx, buildID)
		if err == nil && imageBuild.BuildStartedAt != nil {
			elapsed := time.Since(*imageBuild.BuildStartedAt)
			if elapsed > 5*time.Minute {
				logger.Warn("IMAGE BUILD FAILED: builder-status file still missing 5 minutes after build start — marking build failed.",
					zap.String("buildID", buildID),
					zap.String("vmID", builderVM.ID),
					zap.Duration("elapsed", elapsed))
				if err := image.UpdateImageBuildStatus(ctx, buildID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("builder did not create status file within 5 minutes (elapsed: %v)", elapsed)); err != nil {
					logger.Warn("failed to update image build status to failed", zap.Error(err), zap.String("buildID", buildID))
				}
				return nil
			}
		}
	}

	// Update database with current status for in-progress builds
	switch status {
	case "building":
		// Already in building status, nothing to update
		return nil
	case "testing":
		if err := image.UpdateImageBuildStatus(ctx, buildID, imagetypes.ImageBuildStatusTesting); err != nil {
			logger.Warn("failed to update image build status to testing", zap.Error(err))
		}
		return nil
	case "publishing":
		if err := image.UpdateImageBuildStatus(ctx, buildID, imagetypes.ImageBuildStatusPublishing); err != nil {
			logger.Warn("failed to update image build status to publishing", zap.Error(err))
		}
		return nil
	}

	// Build has completed (success or failure) - capture logs now while we still have runner and buildDir
	if err := captureBuilderLogsWithRunner(ctx, runner, buildID, buildDir); err != nil {
		logger.Warn("failed to capture builder logs on completion", zap.Error(err), zap.String("buildID", buildID))
	}

	logger.Info("Build completed, downloading results",
		zap.String("buildID", buildID),
		zap.String("vmID", builderVM.ID),
		zap.String("status", status))

	// Create temporary directory for downloaded results
	tmpDir, err := os.MkdirTemp("", "securebuild-image-build-download")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Download SBOMs and metadata from VM to host
	if err := downloadSBOMsAndMetadata(ctx, runner, buildDir, tmpDir); err != nil {
		logger.Warn("failed to download SBOMs and metadata", zap.Error(err))
		// Don't return error here - we still want to update the build status
	}

	// Update build status based on completion
	if status == "success" {
		// Process the downloaded results and create catalog entries
		if err := processImageBuildResults(ctx, buildID, tmpDir); err != nil {
			logger.Warn("failed to process image build results", zap.Error(err))
			// Mark build as failed if processing fails
			if err := image.UpdateImageBuildStatus(ctx, buildID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("failed to process build results: %w", err)); err != nil {
				logger.Warn("failed to update image build status to failed", zap.Error(err))
			}
		} else {
			if err := image.UpdateImageBuildStatus(ctx, buildID, imagetypes.ImageBuildStatusSuccess); err != nil {
				logger.Warn("failed to update image build status to success", zap.Error(err))
			}
		}
	} else {
		if err := image.UpdateImageBuildStatus(ctx, buildID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("build failed on VM (status: %s)", status)); err != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(err))
		}
	}

	return nil
}

// processImageBuildResults processes the downloaded VM results and creates catalog entries
func processImageBuildResults(ctx context.Context, buildID string, tmpDir string) error {
	logger.Debug("processing image build results", zap.String("buildID", buildID))

	// Get the image build information
	imageBuild, err := image.GetImageBuildByID(ctx, buildID)
	if err != nil {
		return fmt.Errorf("failed to get image build: %w", err)
	}

	// Get the image APKO version to find the associated image and APKO
	apkoVersion, err := image.GetImageApkoVersion(ctx, imageBuild.ImageApkoVersionID)
	if err != nil {
		return fmt.Errorf("failed to get image APKO version: %w", err)
	}

	// Get the APKO
	apko, imageID, err := image.GetAPKO(ctx, apkoVersion.ImageApkoID)
	if err != nil {
		return fmt.Errorf("failed to get APKO: %w", err)
	}

	// Get the image
	img, err := image.GetImage(ctx, imageID)
	if err != nil {
		return fmt.Errorf("failed to get image: %w", err)
	}

	imageCatalogIDs := []string{}

	// Process the APKO configuration
	logger.Debug("processing APKO results", zap.String("apkoID", apko.ID))

	// Get packages for APKO
	packages, err := image.ListPackagesForAPKO(ctx, apko.LatestVersion.APKOYAML)
	if err != nil {
		return fmt.Errorf("failed to list packages for apko: %w", err)
	}

	// Execute tag templates
	actualTags := []string{}
	for _, tag := range apko.Tags {
		actualTag, err := executeTemplate(tag, packages)
		if err != nil {
			return fmt.Errorf("failed to execute template: %w", err)
		}
		actualTags = append(actualTags, actualTag)
	}

	// Read VM-generated SBOMs and scan them with Grype
	scanResults, err := readVMScanResults(ctx, tmpDir)
	if err != nil {
		return fmt.Errorf("failed to read and scan VM SBOMs: %w", err)
	}

	// Save SBOMs to image_sbom table
	if err := image.SaveImageSBOMs(ctx, apko.ID, scanResults.SyftSBOMX86, scanResults.SyftSBOMAarch64); err != nil {
		return fmt.Errorf("failed to save Syft SBOMs: %w", err)
	}

	// Save vulnerability feed data (CVE matches to cve_package_fix table)
	// Use CUSTOM database scan results (NO SecureOS provider) to avoid circular dependency
	if err := saveVulnerabilityFeedData(ctx, apko.ID, scanResults.GrypeScanCustomX86, scanResults.SyftSBOMX86); err != nil {
		// Log error but don't fail the build
		logger.Errorf("failed to save vulnerability feed data (apkoID: %s): %v", apko.ID, err)
	}

	// Get OCI path
	ociPathWithoutTag := registry.ImageRef(param.GetParam(ctx).RegistryImagePrefix, img.Name)

	// Process each tag
	scanAt := time.Now()

	for _, actualTag := range actualTags {
		imageCatalogID, err := processImageTag(ctx, img, apko, actualTag, ociPathWithoutTag, scanAt,
			scanResults.GrypeScanStandardX86, scanResults.GrypeScanStandardAarch64,
			scanResults.AlternateScanX86, scanResults.AlternateScanAarch64,
			tmpDir, imageBuild)
		if err != nil {
			return fmt.Errorf("failed to process image tag %s: %w", actualTag, err)
		}
		imageCatalogIDs = append(imageCatalogIDs, imageCatalogID)
	}

	// Update APKO last built timestamp
	if err := image.UpdateAPKOLastBuilt(ctx, apko.ID); err != nil {
		logger.Warn("failed to update APKO last built timestamp", zap.String("apko_id", apko.ID), zap.Error(err))
	}

	// Store multi-arch index manifest
	if err := storeMultiArchIndexManifest(ctx, ociPathWithoutTag, actualTags); err != nil {
		logger.Warn("failed to store multi-arch index manifest", zap.Error(err))
	}

	// Publish all catalog images
	if err := image.PublishCatalogImage(ctx, img.Name, imageCatalogIDs, apko.ID); err != nil {
		return fmt.Errorf("failed to publish catalog image: %w", err)
	}

	// Queue push to external registry
	externalRegistries, err := image.ListImageExternalRegistries(ctx, img.ID)
	if err != nil {
		logger.Warn("failed to list image external registries", zap.String("buildID", buildID), zap.Error(err))
		// Don't fail the build for this - just log the warning
	} else {
		for _, registry := range externalRegistries {
			pushPayload := map[string]string{
				"imageId":          img.ID,
				"externalRegistry": registry.ID,
			}

			pushPayloadBytes, err := json.Marshal(pushPayload)
			if err != nil {
				logger.Warn("failed to marshal push payload", zap.String("buildID", buildID), zap.Error(err))
				continue
			}

			if err := persistence.EnqueueWork(ctx, "push_image_to_external_registry", string(pushPayloadBytes)); err != nil {
				logger.Warn("failed to enqueue push to external registry", zap.String("buildID", buildID), zap.Error(err))
			}
		}
	}

	// Set build finished timestamp
	if err := image.SetImageBuildFinishedAt(ctx, buildID); err != nil {
		logger.Warn("failed to set image build finished timestamp", zap.Error(err))
	}

	logger.Info("IMAGE BUILD COMPLETED successfully", zap.String("buildID", buildID), zap.String("imageName", img.Name))

	// Enqueue GitHub sync event (payload is ignored, just triggers sync)
	if err := persistence.EnqueueWork(ctx, "github_sync", []byte("{}")); err != nil {
		logger.Warn("failed to enqueue GitHub sync for image", zap.Error(err))
	}

	return nil
}

// captureBuilderLogs captures stdout and stderr from build log files on the VM (looks up work dir from assignment).
func captureBuilderLogs(ctx context.Context, buildID string, builderVM *buildertypes.BuilderVM) error {
	runner, err := buildbackend.NewRunner(ctx, *builderVM)
	if err != nil {
		return fmt.Errorf("failed to create runner: %w", err)
	}
	defer runner.Close()

	buildDir, err := builder.GetWorkDirForTask(ctx, "build_image", buildID, builderVM.ID)
	if err != nil {
		return fmt.Errorf("failed to get work dir for image build %s: %w", buildID, err)
	}

	return captureBuilderLogsWithRunner(ctx, runner, buildID, buildDir)
}

// captureBuilderLogsWithRunner captures builder log files using an existing runner and build dir.
// Use this when the assignment may already be gone (e.g. inside completion handling).
func captureBuilderLogsWithRunner(ctx context.Context, runner buildbackend.Runner, buildID, buildDir string) error {
	logFiles := []struct {
		process string
		stdout  string
		stderr  string
	}{
		{"apko", "apko-build.stdout", "apko-build.stderr"},
		{"syft_aarch64", "", "syft-sbom-aarch64.stderr"},
		{"syft_x86_64", "", "syft-sbom-x86_64.stderr"},
		{"grype_aarch64", "", "grype-scan-aarch64.stderr"},
		{"grype_x86_64", "", "grype-scan-x86_64.stderr"},
		{"grype_alternate_aarch64", "", "grype-alternate-scan-aarch64.stderr"},
		{"grype_alternate_x86_64", "", "grype-alternate-scan-x86_64.stderr"},
	}

	builderOutputFile := filepath.Join(buildDir, "builder-output.log")
	if err := captureLogFileWithRunner(ctx, runner, buildID, "builder", "stdout", builderOutputFile); err != nil {
		logger.Debug("failed to capture builder output log",
			zap.String("buildID", buildID),
			zap.Error(err))
	}

	for _, logFile := range logFiles {
		if logFile.stdout != "" {
			if err := captureLogFileWithRunner(ctx, runner, buildID, logFile.process, "stdout", filepath.Join(buildDir, logFile.stdout)); err != nil {
				logger.Debug("failed to capture stdout log",
					zap.String("buildID", buildID),
					zap.String("process", logFile.process),
					zap.Error(err))
			}
		}
		if logFile.stderr != "" {
			if err := captureLogFileWithRunner(ctx, runner, buildID, logFile.process, "stderr", filepath.Join(buildDir, logFile.stderr)); err != nil {
				logger.Debug("failed to capture stderr log",
					zap.String("buildID", buildID),
					zap.String("process", logFile.process),
					zap.Error(err))
			}
		}
	}

	return nil
}

// captureLogFileWithRunner captures a single log file using a Runner and updates the database
func captureLogFileWithRunner(ctx context.Context, runner buildbackend.Runner, buildID, process, logType, filePath string) error {
	// Handle wildcard files
	if strings.Contains(filePath, "*") {
		findCmd := fmt.Sprintf("find %s -name '%s' 2>/dev/null | head -1", filepath.Dir(filePath), filepath.Base(filePath))
		output, err := runner.RunCommand(ctx, findCmd)
		if err != nil || strings.TrimSpace(output) == "" {
			// No matching file found
			return nil
		}
		filePath = strings.TrimSpace(output)
	}

	// Check if file exists
	exists, err := runner.FileExists(filePath)
	if err != nil || !exists {
		return nil
	}

	// Read the last 10KB of the file to avoid overwhelming the database
	logContent, err := runner.ReadFileTail(filePath, 10240)
	if err != nil {
		return fmt.Errorf("failed to read log file: %w", err)
	}

	if logContent == "" {
		return nil
	}

	// Update the database
	if logType == "stdout" {
		return image.UpdateImageBuildStdout(ctx, buildID, process, logContent)
	} else if logType == "stderr" {
		return image.UpdateImageBuildStderr(ctx, buildID, process, logContent)
	}

	return nil
}

// processImageTag processes a single image tag and creates catalog entries
func processImageTag(ctx context.Context, img *imagetypes.Image, apko *imagetypes.ImageAPKO, actualTag string, ociPathWithoutTag string, scanAt time.Time, scanResultX86Raw, scanResultAarch64Raw, alternateScanResultX86Raw, alternateScanResultAarch64Raw string, tmpDir string, imageBuild *imagetypes.ImageBuild) (string, error) {
	// ----------------------------------------------------
	// Resolve digest for the just-pushed image tag FIRST
	// ----------------------------------------------------

	fullRef := fmt.Sprintf("%s:%s", ociPathWithoutTag, actualTag)
	auth := authn.FromConfig(authn.AuthConfig{
		Username: param.GetParam(ctx).RegistryUsername,
		Password: param.GetParam(ctx).RegistryPassword,
	})
	ref, err := name.ParseReference(fullRef)
	if err != nil {
		logger.Warn("failed to parse reference for digest resolution", zap.String("ref", fullRef), zap.Error(err))
		return "", err
	}
	desc, err := remote.Get(ref, remote.WithAuth(auth), remote.WithContext(ctx))
	if err != nil {
		logger.Warn("failed to resolve digest for signing", zap.String("ref", fullRef), zap.Error(err))
		return "", err
	}
	digest := desc.Digest.String()

	// ----------------------------------------------
	// Create catalog image, now including indexDigest
	// ----------------------------------------------

	imageCatalogID, err := image.CreateCatalogImage(ctx,
		img.Name, actualTag, img.ID, apko.ID, apko.LatestVersion.ID,
		"", "", digest,
		scanAt, scanResultX86Raw, scanResultAarch64Raw,
		alternateScanResultX86Raw, alternateScanResultAarch64Raw)
	if err != nil {
		return "", fmt.Errorf("failed to create catalog image: %w", err)
	}

	// Write scan results to database
	ociPrefix := registry.NormalizePrefix(param.GetParam(ctx).OCIImagePrefix)
	if ociPrefix == "" {
		ociPrefix = registry.NormalizePrefix(param.GetParam(ctx).RegistryImagePrefix)
	}
	fullImageName := registry.ImageRef(ociPrefix, img.Name)

	// Parse scan results
	scanResultX86, err := image.ParseScanResult(scanResultX86Raw)
	if err != nil {
		return "", fmt.Errorf("failed to parse x86 scan result: %w", err)
	}

	scanResultAarch64, err := image.ParseScanResult(scanResultAarch64Raw)
	if err != nil {
		return "", fmt.Errorf("failed to parse aarch64 scan result: %w", err)
	}

	if err := image.WriteScanResult(ctx, fullImageName, actualTag, "x86_64", *scanResultX86, scanResultX86Raw); err != nil {
		return "", fmt.Errorf("failed to write x86 scan result: %w", err)
	}

	if err := image.WriteScanResult(ctx, fullImageName, actualTag, "aarch64", *scanResultAarch64, scanResultAarch64Raw); err != nil {
		return "", fmt.Errorf("failed to write aarch64 scan result: %w", err)
	}

	// Write alternate scan results to database (if they exist)
	// Note: The actual tag used for scanning was already resolved in build-image-with-vm-assigned.go
	// Here we write the results under the actual tag being processed (latest, v1.16, v1.16.2, etc.)
	if alternateScanResultX86Raw != "" {
		alternateScanResultX86, err := image.ParseScanResult(alternateScanResultX86Raw)
		if err != nil {
			return "", fmt.Errorf("failed to parse alternate x86 scan result: %w", err)
		}

		// Use img.Name for alternate scans (canonical image name)
		if err := image.WriteScanResult(ctx, img.AlternateImage, actualTag, "x86_64", *alternateScanResultX86, alternateScanResultX86Raw); err != nil {
			return "", fmt.Errorf("failed to write alternate x86 scan result: %w", err)
		}
	}

	if alternateScanResultAarch64Raw != "" {
		alternateScanResultAarch64, err := image.ParseScanResult(alternateScanResultAarch64Raw)
		if err != nil {
			return "", fmt.Errorf("failed to parse alternate aarch64 scan result: %w", err)
		}

		// Use img.Name for alternate scans (canonical image name)
		if err := image.WriteScanResult(ctx, img.AlternateImage, actualTag, "aarch64", *alternateScanResultAarch64, alternateScanResultAarch64Raw); err != nil {
			return "", fmt.Errorf("failed to write alternate aarch64 scan result: %w", err)
		}
	}

	// ------------------------------------------------------------------
	//  Keyless signing + SBOM attestation
	// ------------------------------------------------------------------

	// (digest already resolved above)

	// Re-write reference to go through our unauthenticated OCI proxy host
	ociPrefixForDigest := registry.NormalizePrefix(param.GetParam(ctx).OCIImagePrefix)
	if ociPrefixForDigest == "" {
		ociPrefixForDigest = registry.NormalizePrefix(param.GetParam(ctx).RegistryImagePrefix)
	}
	digestRef := fmt.Sprintf("%s@%s", registry.ImageRef(ociPrefixForDigest, img.Name), digest)

	// Fetch and store the index manifest so downstream helper can look it up
	{
		upstreamRefStr := fmt.Sprintf("%s@%s", ociPathWithoutTag, digest)
		ref, _ := name.ParseReference(upstreamRefStr)
		desc, err := remote.Get(ref, remote.WithAuth(auth), remote.WithContext(ctx))
		if err == nil {
			_ = oci.StoreArtifactBlob(ctx, digest, "application/vnd.oci.image.index.v1+json", desc.Manifest)
		}
	}

	// Build OIDC provider (fail hard if not configured; required for keyless functions)
	provider, err := oidc.NewGCPProvider(ctx, param.GetParam(ctx).OIDCGCPAttestorAccount, option.WithCredentialsJSON([]byte(param.GetParam(ctx).OIDCGCPAttestorKeyJSON)))
	if err != nil {
		logger.Warn("OIDC provider not configured – skipping keyless signing", zap.Error(err))
		return imageCatalogID, nil
	}
	// Ensure underlying IAM Credentials client is closed to avoid socket leaks
	defer func() {
		_ = provider.Close()
	}()

	// Keyless signature
	if err := cosign.CosignSignKeylessWithCustomSubject(ctx, digestRef, provider, imageCatalogID); err != nil {
		logger.Warn("keyless cosign sign failed", zap.Error(err))
	} else {
		logger.Debug("keyless cosign sign completed", zap.String("ref", digestRef))
	}

	// Keyless SBOM attestation (index SBOM)
	indexSBOMPath := filepath.Join(tmpDir, "sbom-index-with-securebuild.spdx.json")
	if _, err := os.Stat(indexSBOMPath); os.IsNotExist(err) {
		indexSBOMPath = filepath.Join(tmpDir, "sbom-index.spdx.json")
	}
	if err := cosign.CosignAttestKeylessWithCustomSubject(ctx, indexSBOMPath, "https://spdx.dev/Document", digestRef, provider, imageCatalogID); err != nil {
		logger.Warn("keyless SBOM attestation failed", zap.Error(err))
	}

	// Keyless SLSA provenance attestation
	if imageBuild != nil {
		slsaInput := cosign.SLSAProvenanceInput{
			BuildID:    imageBuild.ID,
			BuilderID:  "",
			StartedOn:  imageBuild.BuildStartedAt,
			FinishedOn: imageBuild.BuildFinishedAt,
			ApkoYAML:   apko.LatestVersion.APKOYAML,
			Tags:       []string{actualTag},
		}
		if imageBuild.BuilderID != nil {
			slsaInput.BuilderID = *imageBuild.BuilderID
		}
		slsaPredicateBytes, err := cosign.BuildSLSAProvenancePredicate(slsaInput)
		if err != nil {
			logger.Warn("failed to build SLSA provenance predicate", zap.Error(err))
		} else {
			slsaPath := filepath.Join(tmpDir, "slsa-provenance.json")
			if err := os.WriteFile(slsaPath, slsaPredicateBytes, 0644); err != nil {
				logger.Warn("failed to write SLSA provenance file", zap.Error(err))
			} else if err := cosign.CosignAttestKeylessWithCustomSubject(ctx, slsaPath, cosign.PredicateSLSAProvenance, digestRef, provider, imageCatalogID); err != nil {
				logger.Warn("keyless SLSA provenance attestation failed", zap.Error(err))
			}
		}
	}

	return imageCatalogID, nil
}

// saveVulnerabilityFeedData stores CVE matches from x86 grype scan result into cve_package_fix table
// This data is used to generate the SecureOS vulnerability feed
func saveVulnerabilityFeedData(ctx context.Context, apkoID string, grypeScanX86 string, sbomX86 string) error {
	if grypeScanX86 == "" {
		return fmt.Errorf("x86 grype scan result is empty")
	}
	if sbomX86 == "" {
		return fmt.Errorf("x86 SBOM is empty")
	}

	// Parse the SBOM using official Syft decoder
	decoder := syftjson.NewFormatDecoder()
	sbomData, _, _, err := decoder.Decode(strings.NewReader(sbomX86))
	if err != nil {
		return fmt.Errorf("failed to parse SBOM: %w", err)
	}

	// Parse Grype's official JSON format using models.Document
	var grypeDoc models.Document
	if err := json.Unmarshal([]byte(grypeScanX86), &grypeDoc); err != nil {
		return fmt.Errorf("failed to parse Grype document: %w", err)
	}

	// Convert Grype's official Match type to security.CVEPackageFix
	cveMatches := make([]security.CVEPackageFix, 0, len(grypeDoc.Matches))
	for _, match := range grypeDoc.Matches {
		cveMatches = append(cveMatches, security.CVEPackageFix{
			CVEID: match.Vulnerability.ID,

			// Initially populate package fields with artifact data
			// Correlation algorithm will update these if needed
			PackageName:    match.Artifact.Name,
			PackageVersion: match.Artifact.Version,

			// Artifact fields (original vulnerable artifact from Grype)
			ArtifactName:     match.Artifact.Name,
			ArtifactVersion:  match.Artifact.Version,
			ArtifactType:     string(match.Artifact.Type),
			ArtifactLanguage: string(match.Artifact.Language),

			// CVE details
			ArtifactFixedVersion: match.Vulnerability.Fix.Versions,
			Severity:             match.Vulnerability.Severity,
			Namespace:            match.Vulnerability.Namespace,
		})
	}

	// Store CVE matches in cve_package_fix table
	// This will run correlation algorithm to map language packages to APK packages
	if err := security.StoreCVEMatches(ctx, apkoID, cveMatches, sbomData); err != nil {
		return fmt.Errorf("failed to store CVE matches: %w", err)
	}

	// Update package fixed versions for APK packages in this SBOM
	// This discovers which package versions contain fixed artifact versions
	for pkg := range sbomData.Artifacts.Packages.Enumerate() {
		// Only process APK packages (OS packages), not language dependencies
		if pkg.Type != syftpkg.ApkPkg {
			continue
		}

		err := security.UpdatePackageFixVersions(ctx, sbomData, pkg)
		if err != nil {
			logger.Warn("failed to update package fix versions",
				zap.String("apkoID", apkoID),
				zap.String("package", pkg.Name),
				zap.String("version", pkg.Version),
				zap.Error(err))
			// Continue processing other packages even if one fails
		}
	}

	return nil
}
