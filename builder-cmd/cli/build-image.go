package cli

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
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/layout"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/google/go-containerregistry/pkg/v1/remote/transport"
	"github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/spf13/cobra"
)

// ImageBuildConfig represents the configuration for image building
type ImageBuildConfig struct {
	// Registry credentials (secrets)
	RegistryUsername string `json:"registry_username"`
	RegistryPassword string `json:"registry_password"`
	RegistryHost     string `json:"registry_host"`

	// Build parameters (non-secrets, can be on command line)
	APKOYAMLPath      string   `json:"apko_yaml_path"`
	WorkDir           string   `json:"work_dir"`
	BuildDate         string   `json:"build_date"`
	SBOMPath          string   `json:"sbom_path"`
	OCIPathWithoutTag string   `json:"oci_path_without_tag"`
	Tags              []string `json:"tags"`
	AlternateImageRef string   `json:"alternate_image_ref,omitempty"`

	// Output directories
	LogDir string `json:"log_dir"`

	// External registries configuration
	ExternalRegistries []ExternalRegistryConfig `json:"external_registries,omitempty"`

	// Skip main registry push - for custom images that should only go to external registries
	SkipMainRegistryPush bool `json:"skip_main_registry_push,omitempty"`
}

// ExternalRegistryConfig represents an external registry configuration for pushing
type ExternalRegistryConfig struct {
	RegistryURL string `json:"registry_url"`
	Username    string `json:"username"`
	Password    string `json:"password"`
}

// registryRetryBackoff configures retry options for transient registry failures
// (including Cloudflare 524 timeouts). Backoff: 1s -> 2s -> 4s -> 8s -> 16s
var registryRetryBackoff = remote.Backoff{
	Duration: 1 * time.Second,
	Factor:   2.0,
	Jitter:   0.1,
	Steps:    5,
}

// registryRetryStatusCodes are HTTP status codes that should trigger a retry
var registryRetryStatusCodes = []int{
	408, // Request Timeout
	429, // Too Many Requests (rate limiting)
	500, // Internal Server Error
	502, // Bad Gateway
	503, // Service Unavailable
	504, // Gateway Timeout
	524, // Cloudflare timeout
}

// registryRetryPredicate determines if an error should trigger a retry at the blob level.
// This is needed because WithRetryStatusCodes only handles transport-level retries,
// but blob uploads need a predicate to retry the entire upload sequence.
func registryRetryPredicate(err error) bool {
	if err == nil {
		return false
	}

	// Check if it's a transport error with a retryable status code (unwrap if needed)
	var te *transport.Error
	if errors.As(err, &te) {
		for _, code := range registryRetryStatusCodes {
			if te.StatusCode == code {
				logger.Infof("Retrying blob upload due to HTTP %d: %v", te.StatusCode, err)
				return true
			}
		}
	}

	return false
}

func BuildImageCmd() *cobra.Command {
	var configFile string
	var workDir string
	var sbomPath string
	var logDir string

	buildImageCmd := cobra.Command{
		Use:   "build-image",
		Short: "Build and test a container image",
		Long:  `Build a container image using apko, test the image, scan with grype, and push to registries`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runBuildAndTestImage(cmd.Context(), configFile, workDir, sbomPath, logDir)
		},
	}

	buildImageCmd.Flags().StringVar(&configFile, "config", "", "Path to JSON config file containing secrets and parameters")
	buildImageCmd.Flags().StringVar(&workDir, "work-dir", "", "Working directory for the build")
	buildImageCmd.Flags().StringVar(&sbomPath, "sbom-path", "", "Path to store SBOM files")
	buildImageCmd.Flags().StringVar(&logDir, "log-dir", "", "Directory to store command logs")

	buildImageCmd.MarkFlagRequired("config")
	buildImageCmd.MarkFlagRequired("work-dir")
	buildImageCmd.MarkFlagRequired("sbom-path")
	buildImageCmd.MarkFlagRequired("log-dir")

	return &buildImageCmd
}

func runBuildAndTestImage(ctx context.Context, configFile, workDir, sbomPath, logDir string) error {
	logger.Info("Starting image build process")

	// Load configuration
	config, err := loadImageBuildConfig(configFile)
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// Override with command line parameters
	if workDir != "" {
		config.WorkDir = workDir
	}
	if sbomPath != "" {
		config.SBOMPath = sbomPath
	}
	if logDir != "" {
		config.LogDir = logDir
	}

	// Create necessary directories
	if err := createDirectories(config); err != nil {
		return fmt.Errorf("failed to create directories: %w", err)
	}

	// Status file for tracking build progress
	statusFile := filepath.Join(config.WorkDir, "builder-status")
	if err := WriteStatus(statusFile, types.ImageBuildStatusBuilding); err != nil {
		return err
	}

	// Create Docker config for registry authentication
	if err := createDockerConfig(config); err != nil {
		WriteStatus(statusFile, types.ImageBuildStatusFailed)
		return fmt.Errorf("failed to create Docker config: %w", err)
	}

	// Step 1: Run apko build
	logger.Info("Step 1: Running apko build")
	if err := runApkoBuild(ctx, config); err != nil {
		WriteStatus(statusFile, types.ImageBuildStatusFailed)
		return fmt.Errorf("apko build failed: %w", err)
	}

	// Step 1.5: Add SecureBuild attribution to SBOMs
	logger.Info("Step 1.5: Adding SecureBuild attribution to SBOMs")
	if err := attributeSBOMs(ctx, config); err != nil {
		WriteStatus(statusFile, types.ImageBuildStatusFailed)
		return fmt.Errorf("SBOM attribution failed: %w", err)
	}

	// Step 1.7: Run image tests (if test file exists)
	logger.Info("Step 1.7: Checking for image tests")
	testFilePath := strings.TrimSuffix(config.APKOYAMLPath, ".yaml") + ".test.yaml"
	testDef, err := loadImageTestDefinition(testFilePath)
	if err != nil {
		// No test file or parse error
		if os.IsNotExist(err) {
			logger.Info("No test file found, skipping image tests")
		} else {
			WriteStatus(statusFile, types.ImageBuildStatusFailed)
			return fmt.Errorf("failed to load test definition: %w", err)
		}
	} else {
		if err := WriteStatus(statusFile, types.ImageBuildStatusTesting); err != nil {
			return err
		}
		logger.Info("Test file found, running image tests")
		if err := executeImageTest(ctx, config, testDef); err != nil {
			WriteStatus(statusFile, types.ImageBuildStatusFailed)
			return fmt.Errorf("image tests failed: %w", err)
		}
		logger.Info("Image tests passed")
	}

	// Transition to publishing status
	if err := WriteStatus(statusFile, types.ImageBuildStatusPublishing); err != nil {
		return err
	}

	// Step 2: Push image to main registry (unless skipped for custom images)
	if !config.SkipMainRegistryPush {
		logger.Info("Step 2: Pushing image to main registry")
		if err := pushImageToMainRegistry(ctx, config); err != nil {
			WriteStatus(statusFile, types.ImageBuildStatusFailed)
			return fmt.Errorf("main registry push failed: %w", err)
		}
	} else {
		logger.Info("Step 2: Skipping main registry push (custom image mode)")
	}

	// Step 2.5: Push to external registries if configured
	if len(config.ExternalRegistries) > 0 {
		logger.Info("Step 2.5: Pushing images to external registries")
		if err := pushToExternalRegistries(ctx, config); err != nil {
			WriteStatus(statusFile, types.ImageBuildStatusFailed)
			return fmt.Errorf("external registry push failed: %w", err)
		}
	}

	// Step 3: Scan pushed images with syft
	logger.Info("Step 3: Scanning images with syft")
	if err := scanPushedImagesWithSyft(ctx, config); err != nil {
		WriteStatus(statusFile, types.ImageBuildStatusFailed)
		return fmt.Errorf("syft SBOM generation failed: %w", err)
	}

	// Step 4: Scan alternate image if specified
	if config.AlternateImageRef != "" {
		logger.Info("Step 4: Scanning alternate image with grype")
		if err := scanAlternateImage(ctx, config); err != nil {
			logger.Warnf("alternate image scan failed: %v", err)
		}
	}

	if err := WriteStatus(statusFile, types.ImageBuildStatusSuccess); err != nil {
		return err
	}
	logger.Info("Image build process completed successfully")
	return nil
}

func loadImageBuildConfig(configFile string) (*ImageBuildConfig, error) {
	data, err := os.ReadFile(configFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var config ImageBuildConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return &config, nil
}

func createDirectories(config *ImageBuildConfig) error {
	dirs := []string{
		config.WorkDir,
		config.SBOMPath,
		config.LogDir,
	}

	for _, dir := range dirs {
		if dir == "" {
			continue
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}

	return nil
}

func runApkoBuild(ctx context.Context, config *ImageBuildConfig) error {
	stdoutFile := filepath.Join(config.LogDir, "apko-build.stdout")
	stderrFile := filepath.Join(config.LogDir, "apko-build.stderr")

	args := []string{
		"build",
		"--log-level", "debug",
		"--build-date", config.BuildDate,
		"--sbom-path", config.SBOMPath,
		"--arch", "aarch64,x86_64",
		config.APKOYAMLPath,
		"image",
		config.WorkDir,
	}

	return runCommandWithSeparateLogging(ctx, "apko", args, config.WorkDir, stdoutFile, stderrFile)
}

func scanPushedImagesWithSyft(ctx context.Context, config *ImageBuildConfig) error {
	// Use the first tag since all tags point to the same image
	if len(config.Tags) == 0 {
		return fmt.Errorf("no tags specified for scanning")
	}

	firstTag := config.Tags[0]
	var imageRef string

	// For custom images (when SkipMainRegistryPush is true), use the first external registry
	if config.SkipMainRegistryPush {
		if len(config.ExternalRegistries) == 0 {
			return fmt.Errorf("no external registries specified for custom image scanning")
		}
		// Use the first external registry and first tag
		firstRegistry := config.ExternalRegistries[0]
		imageRef = fmt.Sprintf("%s:%s", firstRegistry.RegistryURL, firstTag)
	} else {
		// For regular images, use the main registry
		imageRef = fmt.Sprintf("%s:%s", config.OCIPathWithoutTag, firstTag)
	}

	arches := []string{"aarch64", "x86_64"}

	var wg sync.WaitGroup
	errChan := make(chan error, len(arches))

	for _, arch := range arches {
		wg.Add(1)
		go func(arch string) {
			defer wg.Done()

			// First generate SBOM with syft
			sbomFile := fmt.Sprintf("syft-sbom-%s.json", arch)
			sbomPath := filepath.Join(config.WorkDir, sbomFile)
			sbomStderrFile := filepath.Join(config.LogDir, fmt.Sprintf("syft-sbom-%s.stderr", arch))

			// Run syft to generate SBOM
			syftArgs := []string{
				"--quiet",
				"--output", "json",
				"--platform", fmt.Sprintf("linux/%s", arch),
				imageRef,
			}

			// Create SBOM file
			sbomFileHandle, err := os.Create(sbomPath)
			if err != nil {
				errChan <- fmt.Errorf("failed to create SBOM file for %s: %w", arch, err)
				return
			}
			defer sbomFileHandle.Close()

			// Create stderr file for syft
			sbomStderrHandle, err := os.Create(sbomStderrFile)
			if err != nil {
				errChan <- fmt.Errorf("failed to create stderr file for syft %s: %w", arch, err)
				return
			}
			defer sbomStderrHandle.Close()

			// Run syft command
			syftCmd := exec.CommandContext(ctx, "syft", syftArgs...)
			syftCmd.Dir = config.WorkDir
			syftCmd.Stdout = sbomFileHandle
			syftCmd.Stderr = sbomStderrHandle

			logger.Infof("Running: %s %s", "syft", strings.Join(syftArgs, " "))

			if err := syftCmd.Run(); err != nil {
				errChan <- fmt.Errorf("syft SBOM generation failed for %s: %w", arch, err)
				return
			}

			logger.Infof("Syft SBOM generation completed for %s architecture", arch)

			// Note: Grype scanning is now performed in the worker (not on builder VM)
			// to use the custom vulnerability database. The worker will scan the
			// SBOM files generated above after downloading them from the VM.
		}(arch)
	}

	// Wait for all goroutines to complete
	wg.Wait()
	close(errChan)

	// Check for errors
	errors := []error{}
	for err := range errChan {
		if err != nil {
			errors = append(errors, err)
		}
	}

	if len(errors) > 0 {
		return fmt.Errorf("image scanning failed for some architectures: %v", errors)
	}

	return nil
}

func scanAlternateImage(ctx context.Context, config *ImageBuildConfig) error {
	arches := []string{"aarch64", "x86_64"}

	var wg sync.WaitGroup
	errChan := make(chan error, len(arches))

	for _, arch := range arches {
		wg.Add(1)
		go func(arch string) {
			defer wg.Done()

			scanResultFile := fmt.Sprintf("grype-alternate-scan-%s.json", arch)
			stderrFile := filepath.Join(config.LogDir, fmt.Sprintf("grype-alternate-scan-%s.stderr", arch))

			scanResultPath := filepath.Join(config.WorkDir, scanResultFile)

			args := []string{
				"--output", "json",
				"--platform", fmt.Sprintf("linux/%s", arch),
				config.AlternateImageRef,
			}

			// Run grype command and capture JSON output and stderr
			cmd := exec.CommandContext(ctx, "grype", args...)
			cmd.Dir = config.WorkDir

			// Create output files
			scanResultFileHandle, err := os.Create(scanResultPath)
			if err != nil {
				errChan <- fmt.Errorf("failed to create alternate scan result file for %s: %w", arch, err)
				return
			}
			defer scanResultFileHandle.Close()

			stderrFileHandle, err := os.Create(stderrFile)
			if err != nil {
				errChan <- fmt.Errorf("failed to create stderr file for %s: %w", arch, err)
				return
			}
			defer stderrFileHandle.Close()

			// Write JSON output to the result file and stderr to stderr file
			cmd.Stdout = scanResultFileHandle
			cmd.Stderr = stderrFileHandle

			logger.Infof("Running: %s %s", "grype", strings.Join(args, " "))

			// Run the command
			if err := cmd.Run(); err != nil {
				errChan <- fmt.Errorf("grype alternate scan failed for %s: %w", arch, err)
				return
			}

			logger.Infof("Grype alternate scan completed for %s architecture", arch)
		}(arch)
	}

	// Wait for all goroutines to complete
	wg.Wait()
	close(errChan)

	// Check for errors
	errors := []error{}
	for err := range errChan {
		if err != nil {
			errors = append(errors, err)
		}
	}

	if len(errors) > 0 {
		return fmt.Errorf("grype alternate scan failed for some architectures: %v", errors)
	}

	return nil
}

func pushImageToMainRegistry(ctx context.Context, config *ImageBuildConfig) error {
	// Load the image index from the local OCI layout directory
	layoutPath := layout.Path(config.WorkDir)
	imageIndex, err := layoutPath.ImageIndex()
	if err != nil {
		return fmt.Errorf("failed to load image index from OCI layout: %w", err)
	}

	// Push each tag to the main registry using go-containerregistry
	for _, tag := range config.Tags {
		fullRef := fmt.Sprintf("%s:%s", config.OCIPathWithoutTag, tag)
		logger.Infof("Pushing to main registry: %s", fullRef)

		destRefParsed, err := name.ParseReference(fullRef)
		if err != nil {
			return fmt.Errorf("failed to parse main registry reference %s: %w", fullRef, err)
		}

		// Set up main registry authentication using the same credentials as createDockerConfig
		mainAuth := authn.FromConfig(authn.AuthConfig{
			Username: config.RegistryUsername,
			Password: config.RegistryPassword,
		})

		if err := remote.WriteIndex(destRefParsed, imageIndex,
			remote.WithAuth(mainAuth),
			remote.WithContext(ctx),
			remote.WithRetryBackoff(registryRetryBackoff),
			remote.WithRetryStatusCodes(registryRetryStatusCodes...),
			remote.WithRetryPredicate(registryRetryPredicate),
		); err != nil {
			return fmt.Errorf("failed to push multi-arch image index to main registry %s: %w", fullRef, err)
		}

		logger.Infof("Successfully pushed image with tag %s", tag)
	}

	return nil
}

func runCommandWithSeparateLogging(ctx context.Context, command string, args []string, workDir, stdoutFile, stderrFile string) error {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = workDir

	// Create stdout file
	stdoutFileHandle, err := os.Create(stdoutFile)
	if err != nil {
		return fmt.Errorf("failed to create stdout file %s: %w", stdoutFile, err)
	}
	defer stdoutFileHandle.Close()

	// Create stderr file
	stderrFileHandle, err := os.Create(stderrFile)
	if err != nil {
		return fmt.Errorf("failed to create stderr file %s: %w", stderrFile, err)
	}
	defer stderrFileHandle.Close()

	// Set up output redirection
	cmd.Stdout = stdoutFileHandle
	cmd.Stderr = stderrFileHandle

	logger.Infof("Running: %s %s", command, strings.Join(args, " "))
	logger.Infof("Working directory: %s", workDir)
	logger.Infof("Stdout file: %s", stdoutFile)
	logger.Infof("Stderr file: %s", stderrFile)

	// Run the command
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("command %s failed: %w", command, err)
	}

	return nil
}

func runShellCommandWithLogging(ctx context.Context, shellCommand string, workDir, logFile string) error {
	cmd := exec.CommandContext(ctx, "bash", "-c", shellCommand)
	cmd.Dir = workDir

	// Create log file
	logFileHandle, err := os.Create(logFile)
	if err != nil {
		return fmt.Errorf("failed to create log file %s: %w", logFile, err)
	}
	defer logFileHandle.Close()

	// Set up output redirection
	cmd.Stdout = logFileHandle
	cmd.Stderr = logFileHandle

	logger.Infof("Running shell command in %s", workDir)
	logger.Infof("Log file: %s", logFile)

	// Run the command
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("shell command failed: %w", err)
	}

	return nil
}

func runShellCommandWithSeparateLogging(ctx context.Context, shellCommand string, workDir, stdoutFile, stderrFile string) error {
	cmd := exec.CommandContext(ctx, "bash", "-c", shellCommand)
	cmd.Dir = workDir

	// Create stdout file
	stdoutFileHandle, err := os.Create(stdoutFile)
	if err != nil {
		return fmt.Errorf("failed to create stdout file %s: %w", stdoutFile, err)
	}
	defer stdoutFileHandle.Close()

	// Create stderr file
	stderrFileHandle, err := os.Create(stderrFile)
	if err != nil {
		return fmt.Errorf("failed to create stderr file %s: %w", stderrFile, err)
	}
	defer stderrFileHandle.Close()

	// Set up output redirection
	cmd.Stdout = stdoutFileHandle
	cmd.Stderr = stderrFileHandle

	logger.Infof("Running shell command in %s", workDir)
	logger.Infof("Stdout file: %s", stdoutFile)
	logger.Infof("Stderr file: %s", stderrFile)

	// Run the command
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("shell command failed: %w", err)
	}

	return nil
}

// addSecureBuildToSBOM adds SecureBuild attribution to the SBOM at the given path and writes the modified SBOM to a new path.
func addSecureBuildToSBOM(originalSBOMPath, modifiedSBOMPath string) error {
	logger.Infof("Modifying SBOM: %s -> %s", originalSBOMPath, modifiedSBOMPath)

	// Read the original SBOM
	sbomData, err := os.ReadFile(originalSBOMPath)
	if err != nil {
		return fmt.Errorf("failed to read original SBOM: %w", err)
	}

	var sbom map[string]interface{}
	if err := json.Unmarshal(sbomData, &sbom); err != nil {
		return fmt.Errorf("failed to unmarshal SBOM: %w", err)
	}

	logger.Infof("Original SBOM structure keys: %v", getKeys(sbom))

	// Add SecureBuild to the creators field if it exists
	if creationInfo, ok := sbom["creationInfo"].(map[string]interface{}); ok {
		logger.Infof("Found creationInfo, keys: %v", getKeys(creationInfo))

		// Replace creators entirely with Replicated/SecureBuild
		newCreators := []interface{}{
			"Organization: Replicated, Inc.",
			"Tool: SecureBuild",
		}

		if _, ok := creationInfo["creators"].([]interface{}); ok {
			logger.Info("Found existing creators, replacing with Replicated/SecureBuild creators")
		} else {
			logger.Info("No existing creators found, creating new creators field")
		}

		creationInfo["creators"] = newCreators
		logger.Infof("Set creators: %v", newCreators)
	} else {
		// If no creationInfo exists, create it with Replicated/SecureBuild
		sbom["creationInfo"] = map[string]interface{}{
			"creators": []interface{}{
				"Organization: Replicated, Inc.",
				"Tool: SecureBuild",
			},
		}
		logger.Info("Created new creationInfo with Replicated/SecureBuild creators")
	}

	// Write the modified SBOM
	modifiedSBOMData, err := json.MarshalIndent(sbom, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal modified SBOM: %w", err)
	}

	if err := os.WriteFile(modifiedSBOMPath, modifiedSBOMData, 0o644); err != nil {
		return fmt.Errorf("failed to write modified SBOM: %w", err)
	}

	logger.Infof("Successfully wrote modified SBOM: %s", modifiedSBOMPath)
	return nil
}

// attributeSBOMs adds SecureBuild attribution to SBOMs for the given architectures
func attributeSBOMs(ctx context.Context, config *ImageBuildConfig) error {
	arches := []string{"aarch64", "x86_64"}

	// Check if there's an index SBOM first
	sbomIndexPath := filepath.Join(config.SBOMPath, "sbom-index.spdx.json")
	if _, err := os.Stat(sbomIndexPath); err == nil {
		logger.Info("Found index SBOM, attributing it")
		modifiedSBOMPath := filepath.Join(config.SBOMPath, "sbom-index-with-securebuild.spdx.json")
		if err := addSecureBuildToSBOM(sbomIndexPath, modifiedSBOMPath); err != nil {
			return fmt.Errorf("failed to add SecureBuild attribution to index SBOM: %w", err)
		}
	} else {
		logger.Info("No index SBOM found, attributing architecture-specific SBOMs")
	}

	// Always attribute architecture-specific SBOMs
	for _, arch := range arches {
		sbomPath := filepath.Join(config.SBOMPath, fmt.Sprintf("sbom-%s.spdx.json", arch))
		modifiedSBOMPath := filepath.Join(config.SBOMPath, fmt.Sprintf("sbom-%s-with-securebuild.spdx.json", arch))

		if _, err := os.Stat(sbomPath); os.IsNotExist(err) {
			logger.Infof("SBOM file not found for %s: %s", arch, sbomPath)
			continue
		}

		if err := addSecureBuildToSBOM(sbomPath, modifiedSBOMPath); err != nil {
			return fmt.Errorf("failed to add SecureBuild attribution to %s SBOM: %w", arch, err)
		}
	}

	return nil
}

// DockerConfig represents the Docker configuration file structure
type DockerConfig struct {
	Auths map[string]DockerAuth `json:"auths"`
}

// DockerAuth represents the authentication information for a registry
type DockerAuth struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Auth     string `json:"auth"`
}

// createDockerConfig creates a .docker/config.json file with registry credentials.
// These credentials are used by grype and syft to pull images from the registry.
// We do not use docker to push images, and configure the registry client directly in the code.
func createDockerConfig(config *ImageBuildConfig) error {
	// Get home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}

	// Create .docker directory if it doesn't exist
	dockerDir := filepath.Join(homeDir, ".docker")
	if err := os.MkdirAll(dockerDir, 0o755); err != nil {
		return fmt.Errorf("failed to create .docker directory: %w", err)
	}

	// Create Docker config structure
	dockerConfig := DockerConfig{
		Auths: make(map[string]DockerAuth),
	}

	// Do not add external and main registry credentials to the same config file because the same host may be used as both, causing wrong credentials to be used when scanning the image.
	if config.SkipMainRegistryPush {
		// This is a custom image, we only need to add external registry credentials. Grype will be used to scan the custom image.
		logger.Info("Skipping main registry credentials")
		for _, extRegistry := range config.ExternalRegistries {
			// Extract hostname from registry URL for Docker config
			registryHost := extRegistry.RegistryURL
			// Remove protocol if present
			if strings.HasPrefix(registryHost, "https://") {
				registryHost = registryHost[8:]
			} else if strings.HasPrefix(registryHost, "http://") {
				registryHost = registryHost[7:]
			}

			// Extract just the hostname part (before first slash if path exists)
			parts := strings.Split(registryHost, "/")
			registryHost = parts[0]

			// Create auth string for this registry
			authString := fmt.Sprintf("%s:%s", extRegistry.Username, extRegistry.Password)
			encodedAuth := base64.StdEncoding.EncodeToString([]byte(authString))

			dockerConfig.Auths[registryHost] = DockerAuth{
				Username: extRegistry.Username,
				Password: extRegistry.Password,
				Auth:     encodedAuth,
			}

			logger.Infof("Added external registry credentials to Docker config: %s", registryHost)
		}
	} else {
		authString := fmt.Sprintf("%s:%s", config.RegistryUsername, config.RegistryPassword)
		encodedAuth := base64.StdEncoding.EncodeToString([]byte(authString))

		dockerConfig.Auths[config.RegistryHost] = DockerAuth{
			Username: config.RegistryUsername,
			Password: config.RegistryPassword,
			Auth:     encodedAuth,
		}
	}

	// Marshal to JSON
	configData, err := json.MarshalIndent(dockerConfig, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal Docker config: %w", err)
	}

	// Write config file with restrictive permissions
	configPath := filepath.Join(dockerDir, "config.json")
	if err := os.WriteFile(configPath, configData, 0o600); err != nil {
		return fmt.Errorf("failed to write Docker config file: %w", err)
	}

	logger.Infof("Created Docker config file: %s", configPath)
	return nil
}

// Helper function to get keys from a map for debugging
func getKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// pushToExternalRegistries pushes the built images to all configured external registries
func pushToExternalRegistries(ctx context.Context, config *ImageBuildConfig) error {
	if len(config.ExternalRegistries) == 0 {
		logger.Info("No external registries configured, skipping external push")
		return nil
	}

	logger.Infof("Pushing images to %d external registries", len(config.ExternalRegistries))

	// Load the image index from the local OCI layout directory
	layoutPath := layout.Path(config.WorkDir)
	imageIndex, err := layoutPath.ImageIndex()
	if err != nil {
		return fmt.Errorf("failed to load image index from OCI layout: %w", err)
	}

	// Push each tag to each external registry
	for _, tag := range config.Tags {
		for i, extRegistry := range config.ExternalRegistries {
			logger.Infof("Pushing tag %s to external registry %d: %s", tag, i+1, extRegistry.RegistryURL)

			if err := pushToSingleExternalRegistry(ctx, config, imageIndex, tag, extRegistry); err != nil {
				logger.Warnf("Failed to push tag %s to external registry %s: %v", tag, extRegistry.RegistryURL, err)
				// Continue with other registries even if one fails
				continue
			}

			logger.Infof("Successfully pushed tag %s to external registry: %s", tag, extRegistry.RegistryURL)
		}
	}

	logger.Info("Completed pushing images to external registries")
	return nil
}

// pushToSingleExternalRegistry pushes a single tag to a specific external registry
func pushToSingleExternalRegistry(ctx context.Context, config *ImageBuildConfig, imageIndex v1.ImageIndex, tag string, extRegistry ExternalRegistryConfig) error {
	// Construct destination reference
	destImagePath := extRegistry.RegistryURL
	// Remove protocol if present
	if len(destImagePath) >= 8 && destImagePath[:8] == "https://" {
		destImagePath = destImagePath[8:]
	} else if len(destImagePath) >= 7 && destImagePath[:7] == "http://" {
		destImagePath = destImagePath[7:]
	}

	destRef := fmt.Sprintf("%s:%s", destImagePath, tag)
	logger.Infof("Pushing to external registry: %s", destRef)

	destRefParsed, err := name.ParseReference(destRef)
	if err != nil {
		return fmt.Errorf("failed to parse destination reference %s: %w", destRef, err)
	}

	// Set up destination authentication
	destAuth := authn.FromConfig(authn.AuthConfig{
		Username: extRegistry.Username,
		Password: extRegistry.Password,
	})

	// Push multi-arch image index to destination using local OCI layout
	logger.Infof("Pushing multi-arch image index to: %s", destRef)
	if err := remote.WriteIndex(destRefParsed, imageIndex,
		remote.WithAuth(destAuth),
		remote.WithContext(ctx),
		remote.WithRetryBackoff(registryRetryBackoff),
		remote.WithRetryStatusCodes(registryRetryStatusCodes...),
		remote.WithRetryPredicate(registryRetryPredicate),
	); err != nil {
		return fmt.Errorf("failed to push multi-arch image index to %s: %w", destRef, err)
	}
	return nil
}
