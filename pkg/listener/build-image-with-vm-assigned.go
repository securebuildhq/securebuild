package listener

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/securebuildhq/securebuild/builder-cmd/cli"
	"github.com/securebuildhq/securebuild/pkg/builder"
	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/image"
	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/oci"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/pipeline"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"go.uber.org/zap"
	"golang.org/x/crypto/ssh"
	"gopkg.in/yaml.v3"
)

// HandleBuildImageWithVMAssigned handles the build-image-with-vm-assigned task.
func HandleBuildImageWithVMAssigned(ctx context.Context, payload string) error {
	logger.Debug("handling build image with VM assigned", zap.String("payload", payload))

	var p BuildImageWithVMAssignedPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}

	// CRITICAL: Check if VM exists before proceeding
	// This prevents worker leaks from retrying with deleted VMs
	_, err := builder.GetBuilderVM(ctx, p.VMID)
	if err != nil {
		if errors.Is(err, builder.ErrMachineNotFound) {
			// VM was deleted, mark this as non-retryable to prevent worker leak
			logger.Warn("VM not found for image build, failing task immediately",
				zap.String("vmID", p.VMID),
				zap.String("buildID", p.BuildID),
				zap.Error(err))

			// Mark the image build as failed
			if statusErr := image.UpdateImageBuildStatus(ctx, p.BuildID, imagetypes.ImageBuildStatusFailed,
				fmt.Errorf("VM %s no longer exists", p.VMID)); statusErr != nil {
				logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
			}
			if finishedErr := image.SetImageBuildFinishedAt(ctx, p.BuildID); finishedErr != nil {
				logger.Warn("failed to set image build finished timestamp", zap.Error(finishedErr))
			}

			// Return non-retryable error to prevent endless retries
			return NewNonRetryableError(fmt.Errorf("VM %s not found (deleted)", p.VMID))
		}
		return fmt.Errorf("failed to get VM: %w", err)
	}

	// Get the image build record to get the image APKO version ID
	imageBuild, err := image.GetImageBuildByID(ctx, p.BuildID)
	if err != nil {
		return fmt.Errorf("failed to get image build: %w", err)
	}

	// Get the image APKO version to find the associated image and APKO
	apkoVersion, err := image.GetImageApkoVersion(ctx, imageBuild.ImageApkoVersionID)
	if err != nil {
		return fmt.Errorf("failed to get image APKO version: %w", err)
	}

	// Get the APKO and image ID
	apko, imageID, err := image.GetAPKO(ctx, apkoVersion.ImageApkoID)
	if err != nil {
		return fmt.Errorf("failed to get APKO: %w", err)
	}

	// Get the image to get the name
	img, err := image.GetImage(ctx, imageID)
	if err != nil {
		return fmt.Errorf("failed to get image: %w", err)
	}

	// Update build status to building and set start time
	if err := image.UpdateImageBuildStatus(ctx, p.BuildID, imagetypes.ImageBuildStatusBuilding); err != nil {
		logger.Warn("failed to update image build status to building", zap.Error(err))
	}
	if err := image.SetImageBuildStartedAt(ctx, p.BuildID); err != nil {
		logger.Warn("failed to set image build started timestamp", zap.Error(err))
	}

	logger.Debug("starting image build process",
		zap.String("buildID", p.BuildID),
		zap.String("apkoID", apko.ID),
		zap.String("vmID", p.VMID))

	// Start background build job for the specific APKO version
	err = buildAndPushAPKOWithVM(ctx, img, apko.ID, apkoVersion.ID, apko.Tags, apkoVersion.APKOYAML, p.VMID)
	if err != nil {
		logger.Warn("IMAGE BUILD FAILED: buildAndPushAPKOWithVM failed",
			zap.String("buildID", p.BuildID),
			zap.String("apkoID", apko.ID),
			zap.Error(err))

		// Mark build as failed and set finished time with error details
		if statusErr := image.UpdateImageBuildStatus(ctx, p.BuildID, imagetypes.ImageBuildStatusFailed, err); statusErr != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
		}
		if finishedErr := image.SetImageBuildFinishedAt(ctx, p.BuildID); finishedErr != nil {
			logger.Warn("failed to set image build finished timestamp", zap.Error(finishedErr))
		}

		return fmt.Errorf("failed to build and push APKO %s: %w", apko.ID, err)
	}

	// Background job has been started. The monitoring process will handle:
	// - Detecting completion of build
	// - Downloading results from VM
	// - Processing SBOMs and creating catalog entries
	// - Publishing catalog images
	// - Queueing external registry pushes
	// - Marking build as successful and setting finished time

	logger.Info("IMAGE BUILD JOB STARTED - monitoring process will handle completion",
		zap.String("buildID", p.BuildID),
		zap.String("apkoID", apko.ID),
		zap.String("vmID", p.VMID))

	return nil
}

// hasReferenceImageInTestYAML checks if a test YAML defines a referenceImage field.
// Returns true if referenceImage is defined and non-empty.
func hasReferenceImageInTestYAML(testYAML string) bool {
	if testYAML == "" {
		return false
	}
	var testDef cli.ImageTestDefinition
	if err := yaml.Unmarshal([]byte(testYAML), &testDef); err != nil {
		// If we can't parse it, assume no reference image
		return false
	}
	return testDef.ReferenceImage != ""
}

// VMScanResults contains all scan results and SBOMs from the VM
type VMScanResults struct {
	// Standard database scans (for WWW display)
	// Includes NVD + GitHub + SecureOS provider (useCustomDB=false)
	// Shows vulnerabilities with SecureBuild fixes applied
	GrypeScanStandardX86     string
	GrypeScanStandardAarch64 string

	// Custom database scans (for SecDB feed generation)
	// Includes NVD + GitHub only, NO SecureOS (useCustomDB=true)
	// Pure upstream vulnerability data to avoid circular dependency
	GrypeScanCustomX86     string
	GrypeScanCustomAarch64 string

	// Alternate image scan results (optional)
	AlternateScanX86     string
	AlternateScanAarch64 string

	// Syft SBOMs
	SyftSBOMX86     string
	SyftSBOMAarch64 string
}

// readVMScanResults reads the Syft SBOMs generated on the VM and scans them with Grype
func readVMScanResults(ctx context.Context, tmpDir string) (*VMScanResults, error) {
	results := &VMScanResults{}

	// Read x86_64 SBOM (required)
	x86SBOMPath := filepath.Join(tmpDir, "syft-sbom-x86_64.json")
	sbomX86Raw, err := os.ReadFile(x86SBOMPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read x86_64 SBOM: %w", err)
	}
	results.SyftSBOMX86 = string(sbomX86Raw)

	// Read aarch64 SBOM (required)
	aarch64SBOMPath := filepath.Join(tmpDir, "syft-sbom-aarch64.json")
	sbomAarch64Raw, err := os.ReadFile(aarch64SBOMPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read aarch64 SBOM: %w", err)
	}
	results.SyftSBOMAarch64 = string(sbomAarch64Raw)

	// Run both scans in parallel for better performance
	logger.Info("scanning SBOMs with both standard and custom Grype databases")

	var standardScanResults, customScanResults map[string]string
	var standardErr, customErr error
	var wg sync.WaitGroup

	wg.Add(2)

	// Scan 1: Standard database (includes SecureOS provider) for WWW display
	// This will show vulnerabilities with SecureBuild fixes applied
	go func() {
		defer wg.Done()
		standardScanResults, standardErr = scan.ScanCatalogImageSBOMsStandard(ctx, results.SyftSBOMX86, results.SyftSBOMAarch64)
	}()

	// Scan 2: Custom database (NO SecureOS provider) for SecDB feed generation
	// This uses only NVD + GitHub to avoid circular dependency
	go func() {
		defer wg.Done()
		customScanResults, customErr = scan.ScanCatalogImageSBOMsCustom(ctx, results.SyftSBOMX86, results.SyftSBOMAarch64)
	}()

	wg.Wait()

	if standardErr != nil {
		return nil, fmt.Errorf("failed to scan SBOMs with standard database: %w", standardErr)
	}
	if customErr != nil {
		return nil, fmt.Errorf("failed to scan SBOMs with custom database: %w", customErr)
	}

	results.GrypeScanStandardX86 = standardScanResults["x86_64"]
	results.GrypeScanStandardAarch64 = standardScanResults["aarch64"]
	results.GrypeScanCustomX86 = customScanResults["x86_64"]
	results.GrypeScanCustomAarch64 = customScanResults["aarch64"]

	// Read alternate image scan results (optional)
	x86AlternateScanPath := filepath.Join(tmpDir, "grype-alternate-scan-x86_64.json")
	if alternateScanResultX86Data, err := os.ReadFile(x86AlternateScanPath); err == nil {
		results.AlternateScanX86 = string(alternateScanResultX86Data)
	}

	aarch64AlternateScanPath := filepath.Join(tmpDir, "grype-alternate-scan-aarch64.json")
	if alternateScanResultAarch64Data, err := os.ReadFile(aarch64AlternateScanPath); err == nil {
		results.AlternateScanAarch64 = string(alternateScanResultAarch64Data)
	}

	return results, nil
}

// buildAndPushAPKOWithVM starts a background build job on the VM for the given APKO configuration
func buildAndPushAPKOWithVM(ctx context.Context, img *imagetypes.Image, apkoID string, apkoVersionID string, apkoTags []string, apkoYAML, vmID string) error {
	logger.Debug("Building APKO with VM",
		zap.String("imageID", img.ID),
		zap.String("apkoID", apkoID),
		zap.String("vmID", vmID))

	// Get packages for APKO (same as original)
	packages, err := image.GetAPKOOperations().ListPackages(ctx, apkoYAML)
	if err != nil {
		return fmt.Errorf("failed to list packages for apko: %w", err)
	}

	if err := image.StoreImagePackages(ctx, img.ID, apkoID, packages); err != nil {
		return fmt.Errorf("failed to store image packages: %w", err)
	}

	// Execute tag templates (same as original)
	actualTags := []string{}
	for _, tag := range apkoTags {
		actualTag, err := executeTemplate(tag, packages)
		if err != nil {
			return fmt.Errorf("failed to execute template: %w", err)
		}
		actualTags = append(actualTags, actualTag)
	}

	// Create temporary directory on host for receiving VM output
	tmpDir, err := os.MkdirTemp("", "securebuild-image-build")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Build and push the image on VM - this starts a background job
	ociPathWithoutTag := fmt.Sprintf("%s/%s/%s", param.GetParam(ctx).ReplicatedRegistryHost, param.GetParam(ctx).ReplicatedAppSlug, img.Name)
	if err := buildAndPushImageOnVM(ctx, vmID, img.Name, img, apkoID, apkoVersionID, apkoYAML, tmpDir, ociPathWithoutTag, actualTags); err != nil {
		return fmt.Errorf("failed to build and push image on VM: %w", err)
	}

	// Background job has been started. The monitoring process will handle:
	// 1. Detecting completion
	// 2. Downloading results from VM
	// 3. Processing SBOMs and creating catalog entries
	// 4. Updating APKO last built timestamp
	// 5. Storing multi-arch index manifest

	// Background job started successfully
	return nil
}

func buildAndPushImageOnVM(ctx context.Context, vmID string, imageName string, img *imagetypes.Image, apkoID string, apkoVersionID string, apkoYAML, hostTmpDir string, ociPathWithoutTag string, actualTags []string) error {
	logger.Debug("Building and pushing image on VM", zap.String("vmID", vmID), zap.String("apkoID", apkoID))

	// Get VM connection
	vm, err := builder.GetBuilderVM(ctx, vmID)
	if err != nil {
		return fmt.Errorf("failed to get VM: %w", err)
	}

	client, err := getSSHClientForVM(ctx, vm)
	if err != nil {
		return fmt.Errorf("failed to get SSH client: %w", err)
	}
	defer client.Close()

	// Create working directory on VM
	vmWorkDir := fmt.Sprintf("/home/builder/image-build-%s", apkoID)
	if err := createWorkingDirectory(ctx, client, vm.ID, vmWorkDir); err != nil {
		return fmt.Errorf("failed to create working directory: %w", err)
	}

	// Copy all pipeline types to VM (both package and image pipelines)
	if err := pipeline.CopyAllPipelinesToVM(ctx, client, &vm); err != nil {
		return fmt.Errorf("failed to copy pipelines to VM: %w", err)
	}

	// Write APKO YAML to VM
	if err := writeAPKOYAML(client, vm.ID, vmWorkDir, apkoYAML); err != nil {
		return fmt.Errorf("failed to write APKO YAML: %w", err)
	}

	// Get test YAML and write to VM if it exists
	testYAML, err := image.GetImageTest(ctx, apkoID, apkoVersionID)
	if err != nil {
		return fmt.Errorf("failed to get image test: %w", err)
	}
	if testYAML != "" {
		if err := writeImageTestYAML(client, vm.ID, vmWorkDir, testYAML); err != nil {
			return fmt.Errorf("failed to write image test YAML: %w", err)
		}
	}

	// Get alternate image reference if it exists.
	// Skip this entirely if the test YAML defines a referenceImage, since the
	// CLI will use that instead of the alternate image.
	alternateImageRef := ""
	if img.AlternateImage != "" && len(actualTags) > 0 && !hasReferenceImageInTestYAML(testYAML) {
		// Try each tag until we find one that exists
		for _, tag := range actualTags {
			ref, err := getAlternateImageRef(ctx, img.AlternateImage, tag)
			if err != nil {
				// Warn but continue trying other tags
				logger.Warnf("failed to check if alternate image %s exists for tag %s: %v", img.AlternateImage, tag, err)
				continue
			}
			if ref != "" {
				alternateImageRef = ref
				break
			}
		}

		// If no alternate image was found for any tag and we intend to test
		// this image, return an error since there's no referenceImage fallback.
		if alternateImageRef == "" && testYAML != "" {
			return fmt.Errorf("alternate image %s does not exist for any of the tags %v. Specify a referenceImage in your test definition to override this", img.AlternateImage, actualTags)
		}
	}

	// Create build configuration
	buildConfig := map[string]interface{}{
		"registry_username":    "serviceaccount",
		"registry_password":    param.GetParam(ctx).ReplicatedAPIToken,
		"registry_host":        strings.Split(ociPathWithoutTag, "/")[0],
		"apko_yaml_path":       filepath.Join(vmWorkDir, "apko.yaml"),
		"work_dir":             vmWorkDir,
		"build_date":           time.Now().Format(time.RFC3339),
		"sbom_path":            vmWorkDir,
		"oci_path_without_tag": ociPathWithoutTag,
		"tags":                 actualTags,
		"log_dir":              vmWorkDir,
	}

	// Add alternate image reference if it exists
	if alternateImageRef != "" {
		buildConfig["alternate_image_ref"] = alternateImageRef
	}

	// Add external registries if configured
	externalRegistries, err := image.ListImageExternalRegistries(ctx, img.ID)
	if err != nil {
		logger.Warn("failed to list external registries", zap.String("imageID", img.ID), zap.Error(err))
	} else if len(externalRegistries) > 0 {
		// Convert external registries to the format expected by CLI
		externalRegistryConfigs := make([]map[string]interface{}, 0, len(externalRegistries))
		for _, registry := range externalRegistries {
			externalRegistryConfigs = append(externalRegistryConfigs, map[string]interface{}{
				"registry_url": registry.RegistryURL,
				"username":     registry.Username,
				"password":     registry.Password,
			})
		}
		buildConfig["external_registries"] = externalRegistryConfigs
		logger.Debug("added external registries to build config", zap.Int("count", len(externalRegistryConfigs)))
	}

	// Write config file to VM
	configFile := filepath.Join(vmWorkDir, "build-config.json")
	if err := writeConfigFile(client, vm.ID, configFile, buildConfig); err != nil {
		return fmt.Errorf("failed to write build config: %w", err)
	}

	// Run the build-image command on VM using nohup (similar to package builds)
	// The builder writes its status to builder-status file (building/testing/publishing/success/failed)
	buildCmd := fmt.Sprintf(`set -euo pipefail
cd %s
echo "Starting image build for %s at $(date)";
nohup bash -c '
/home/builder/builder build-image \
		--config %s \
		--work-dir %s \
		--sbom-path %s \
		--log-dir %s
' > %s/builder-output.log 2>&1 &
echo "Image build backgrounded for %s at $(date)";
`,
		vmWorkDir, apkoID,
		configFile, vmWorkDir, vmWorkDir, vmWorkDir, vmWorkDir, apkoID)

	if err := runSyncCommand(client, vm.ID, buildCmd); err != nil {
		return fmt.Errorf("failed to run build-image command: %w", err)
	}

	// Note: Build monitoring is handled by the existing monitoring process
	// No need to wait for completion here since we have periodic status checks
	// The monitoring process will download SBOMs and metadata when the build completes

	return nil
}

func runSyncCommand(client *ssh.Client, vmID string, command string) error {
	sess, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	defer sess.Close()

	logger.Debug("Running sync command on VM", zap.String("vmID", vmID), zap.String("command", command))

	output, err := sess.CombinedOutput(command)
	logger.Debug("Command output", zap.String("vmID", vmID), zap.String("output", string(output)))

	if err != nil {
		return fmt.Errorf("command failed: %w (output: %s)", err, string(output))
	}

	return nil
}

func downloadSBOMsAndMetadata(client *ssh.Client, vmID string, vmWorkDir string, hostTmpDir string) error {
	logger.Debug("Downloading SBOMs and scan results from VM", zap.String("vmID", vmID))

	// Create a tar archive with all files in the work directory, excluding build artifacts
	tarCmd := fmt.Sprintf(`cd %s && tar -czf /tmp/sboms-metadata.tar.gz --exclude='index.json' --exclude='oci-layout' --exclude='blobs' --exclude='image' .`, vmWorkDir)
	if err := runSyncCommand(client, vmID, tarCmd); err != nil {
		return fmt.Errorf("failed to create SBOM and scan results tar archive: %w", err)
	}

	// Read the tar file and write to host
	sess, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	defer sess.Close()

	output, err := sess.Output("cat /tmp/sboms-metadata.tar.gz")
	if err != nil {
		return fmt.Errorf("failed to read SBOM and scan results tar archive: %w", err)
	}

	// Write to host tmp directory
	tarPath := filepath.Join(hostTmpDir, "sboms-metadata.tar.gz")
	if err := os.WriteFile(tarPath, output, 0o644); err != nil {
		return fmt.Errorf("failed to write SBOM and scan results tar file to host: %w", err)
	}

	// Extract in host tmp directory
	if err := extractTarFile(tarPath, hostTmpDir); err != nil {
		return fmt.Errorf("failed to extract SBOM and scan results tar file: %w", err)
	}

	// Clean up tar file
	os.Remove(tarPath)

	return nil
}

func downloadBuildResults(client *ssh.Client, vmID string, vmWorkDir string, hostTmpDir string) error {
	logger.Debug("Downloading build results from VM", zap.String("vmID", vmID))

	// Create an SCP-like function using SSH
	// For now, we'll use a simple approach with tar to transfer the entire directory
	tarCmd := fmt.Sprintf("cd %s && tar -czf /tmp/build-results.tar.gz .", vmWorkDir)
	if err := runSyncCommand(client, vmID, tarCmd); err != nil {
		return fmt.Errorf("failed to create tar archive: %w", err)
	}

	// Read the tar file and write to host
	sess, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	defer sess.Close()

	output, err := sess.Output("cat /tmp/build-results.tar.gz")
	if err != nil {
		return fmt.Errorf("failed to read tar archive: %w", err)
	}

	// Write to host tmp directory
	tarPath := filepath.Join(hostTmpDir, "build-results.tar.gz")
	if err := os.WriteFile(tarPath, output, 0o644); err != nil {
		return fmt.Errorf("failed to write tar file to host: %w", err)
	}

	// Extract in host tmp directory
	if err := extractTarFile(tarPath, hostTmpDir); err != nil {
		return fmt.Errorf("failed to extract tar file: %w", err)
	}

	// Clean up tar file
	os.Remove(tarPath)

	return nil
}

func extractTarFile(tarPath string, destDir string) error {
	cmd := fmt.Sprintf("cd %s && tar -xzf %s", destDir, tarPath)
	if err := runHostCommand(cmd); err != nil {
		return fmt.Errorf("failed to extract tar file: %w", err)
	}
	return nil
}

func runHostCommand(command string) error {
	logger.Debug("Running host command", zap.String("command", command))

	// Execute the command on the host using exec
	cmd := exec.Command("bash", "-c", command)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("command failed: %w (output: %s)", err, string(output))
	}

	logger.Debug("Host command output", zap.String("output", string(output)))
	return nil
}

// Helper functions that match the original buildAndPushAPKO process
func storeMultiArchIndexManifest(ctx context.Context, ociPathWithoutTag string, actualTags []string) error {
	// Implementation matches the original function from build-image.go
	if len(actualTags) == 0 {
		return nil
	}

	// Store the multi-arch index manifest in oci_artifact_blob
	fullRef := fmt.Sprintf("%s:%s", ociPathWithoutTag, actualTags[0])
	auth := authn.FromConfig(authn.AuthConfig{
		Username: "serviceaccount",
		Password: param.GetParam(ctx).ReplicatedAPIToken,
	})
	ref, err := name.ParseReference(fullRef)
	if err == nil {
		imageIndex, err := remote.Index(ref, remote.WithAuth(auth), remote.WithContext(ctx))
		if err == nil {
			hash, err := imageIndex.Digest()
			if err == nil {
				indexDigest := hash.String()
				manifestBytes, err := imageIndex.RawManifest()
				if err == nil {
					mediaType := "application/vnd.oci.image.index.v1+json"
					err = oci.StoreArtifactBlob(ctx, indexDigest, mediaType, manifestBytes)
					if err != nil {
						logger.Warn("failed to store multi-arch index manifest in oci_artifact_blob",
							zap.String("digest", indexDigest),
							zap.Error(err))
					} else {
						logger.Debug("stored multi-arch index manifest in oci_artifact_blob",
							zap.String("digest", indexDigest))
					}
				}
			}
		}
	}

	return nil
}

func getSSHClientForVM(ctx context.Context, vm buildertypes.BuilderVM) (*ssh.Client, error) {
	privateKeyBytes, err := base64.StdEncoding.DecodeString(vm.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to base64 decode private key: %w", err)
	}
	key, err := ssh.ParsePrivateKey(privateKeyBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	config := &ssh.ClientConfig{
		User: vm.Username,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(key),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", vm.IPAddress, vm.Port)

	// SSH connection with retry logic
	var client *ssh.Client
	maxRetries := 3
	baseDelay := time.Second * 2

	for attempt := 0; attempt < maxRetries; attempt++ {
		client, err = ssh.Dial("tcp", addr, config)
		if err == nil {
			break
		}

		if attempt < maxRetries-1 {
			delay := baseDelay * time.Duration(1<<attempt)
			logger.Warn("SSH connection failed during image build setup, retrying",
				zap.String("vmID", vm.ID),
				zap.String("addr", addr),
				zap.Int("attempt", attempt+1),
				zap.Int("maxRetries", maxRetries),
				zap.Duration("retryDelay", delay),
				zap.Error(err))

			builder.DebugVMStatus(ctx, vm.ID)

			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("context cancelled during SSH retry: %w", ctx.Err())
			case <-time.After(delay):
			}
		}
	}

	if err != nil {
		return nil, fmt.Errorf("failed to dial SSH after %d attempts: %w", maxRetries, err)
	}

	return client, nil
}

func createWorkingDirectory(ctx context.Context, client *ssh.Client, vmID string, workDir string) error {
	cmd := fmt.Sprintf("mkdir -p %s", workDir)

	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Debug("mkdir stdout", zap.String("vmID", vmID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Debug("mkdir stderr", zap.String("vmID", vmID), zap.String("output", line))
		}
	}()

	err := builder.RunCommand(ctx, client, vmID, cmd, stdoutCh, stderrCh)
	wg.Wait()

	if err != nil {
		return fmt.Errorf("failed to create working directory: %w", err)
	}

	return nil
}

func writeAPKOYAML(client *ssh.Client, vmID string, workDir string, apkoYAML string) error {
	apkoFile := fmt.Sprintf("%s/apko.yaml", workDir)

	if err := builder.CreateRemoteTextFile(client, apkoFile, apkoYAML); err != nil {
		return fmt.Errorf("failed to create APKO YAML file: %w", err)
	}

	logger.Debug("APKO YAML file created", zap.String("vmID", vmID), zap.String("file", apkoFile))
	return nil
}

func writeImageTestYAML(client *ssh.Client, vmID string, workDir string, testYAML string) error {
	testFile := fmt.Sprintf("%s/apko.test.yaml", workDir)

	if err := builder.CreateRemoteTextFile(client, testFile, testYAML); err != nil {
		return fmt.Errorf("failed to create image test YAML file: %w", err)
	}

	logger.Debug("Image test YAML file created", zap.String("vmID", vmID), zap.String("file", testFile))
	return nil
}

func writeConfigFile(client *ssh.Client, vmID string, configFile string, config map[string]interface{}) error {
	configBytes, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := builder.CreateRemoteTextFile(client, configFile, string(configBytes)); err != nil {
		return fmt.Errorf("failed to create config file: %w", err)
	}

	logger.Debug("Config file created", zap.String("vmID", vmID), zap.String("file", configFile))
	return nil
}
