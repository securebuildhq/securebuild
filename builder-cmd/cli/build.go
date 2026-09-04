package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/securebuildhq/securebuild/pkg/apk"
	"github.com/securebuildhq/securebuild/pkg/cloudflare"
	"github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/spf13/cobra"
	"go.uber.org/zap"
)

func BuildCmd() *cobra.Command {
	var apkRepositories []string
	var keyringAppends []string

	r2BucketName := ""
	r2AccessKey := ""
	r2SecretKey := ""
	r2Endpoint := ""
	r2Region := "auto"
	r2Directory := ""

	zoneID := ""
	cachePurgeToken := ""

	useRoot := false
	bootstrapMode := false
	workDir := ""

	buildCmd := cobra.Command{
		Use:   "build",
		Short: "Build and test a package",
		Long:  `Build and test a package`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, err := param.Init(param.InitSourceEnvironment, nil)
			if err != nil {
				return fmt.Errorf("failed to initialize params: %w", err)
			}
			return runBuildAndTestPackage(ctx, workDir, apkRepositories, keyringAppends, r2BucketName, r2AccessKey, r2SecretKey, r2Endpoint, r2Region, r2Directory, zoneID, cachePurgeToken, useRoot, bootstrapMode)
		},
	}

	buildCmd.Flags().StringVar(&workDir, "work-dir", "", "Working directory (default: current directory). All paths (output/, pkginfo/, packages/) are relative to this.")

	buildCmd.Flags().StringSliceVar(&apkRepositories, "apk-repository", []string{}, "APK repositories to use (can be specified multiple times)")
	buildCmd.Flags().StringSliceVar(&keyringAppends, "keyring-append", []string{}, "Keyrings to append (can be specified multiple times)")

	buildCmd.Flags().StringVar(&r2BucketName, "r2-bucket-name", "", "The R2 bucket name")
	buildCmd.Flags().StringVar(&r2AccessKey, "r2-access-key", "", "The R2 access key")
	buildCmd.Flags().StringVar(&r2SecretKey, "r2-secret-key", "", "The R2 secret key")
	buildCmd.Flags().StringVar(&r2Endpoint, "r2-endpoint", "", "The R2 endpoint")
	buildCmd.Flags().StringVar(&r2Region, "r2-region", "auto", "The R2 region")
	buildCmd.Flags().StringVar(&r2Directory, "r2-directory", "", "The R2 directory")

	buildCmd.Flags().StringVar(&zoneID, "cloudflare-zone-id", "", "The zone ID for cache purging")
	buildCmd.Flags().StringVar(&cachePurgeToken, "cloudflare-cache-purge-token", "", "The cache purge token")

	buildCmd.Flags().BoolVar(&useRoot, "enable-root-mode", false, "Use root")
	buildCmd.Flags().BoolVar(&bootstrapMode, "bootstrap-mode", false, "Enable bootstrap mode")

	return &buildCmd
}

// nixShellLikeEnv reports whether the process likely runs with Nix-provided tools on PATH.
// nix-shell sets IN_NIX_SHELL; nix develop often does too. Flakes + direnv frequently only prepend
// /nix/store/... paths to PATH. When combined with sudo, secure_path hides melange, bwrap, etc.;
// we use sudo env "PATH=$PATH" so melange stays on PATH for that invocation.
func nixShellLikeEnv() bool {
	if os.Getenv("IN_NIX_SHELL") != "" {
		return true
	}
	return strings.Contains(os.Getenv("PATH"), "/nix/store/")
}

func runBuildAndTestPackage(ctx context.Context, workDir string, apkRepositories []string, keyringAppends []string, r2BucketName string, r2AccessKey string, r2SecretKey string, r2Endpoint string, r2Region string, r2Directory string, zoneID string, cachePurgeToken string, useRoot bool, bootstrapMode bool) error {
	if workDir != "" {
		if err := os.Chdir(workDir); err != nil {
			return fmt.Errorf("failed to chdir to work-dir %s: %w", workDir, err)
		}
	}
	return runBuildAndTestPackageInCwd(ctx, apkRepositories, keyringAppends, r2BucketName, r2AccessKey, r2SecretKey, r2Endpoint, r2Region, r2Directory, zoneID, cachePurgeToken, useRoot, bootstrapMode)
}

func runBuildAndTestPackageInCwd(ctx context.Context, apkRepositories []string, keyringAppends []string, r2BucketName string, r2AccessKey string, r2SecretKey string, r2Endpoint string, r2Region string, r2Directory string, zoneID string, cachePurgeToken string, useRoot bool, bootstrapMode bool) error {
	// Log actual value so we can confirm whether root/sudo is in use (value comes from execution.use_root via --enable-root-mode).
	logger.Info("Building package", zap.Bool("useRoot", useRoot))

	// determine my own machine architecture
	arch := ""
	switch runtime.GOARCH {
	case "amd64":
		arch = "x86_64"
	case "arm64":
		arch = "aarch64"
	}

	// Paths are relative to current working directory (set via --work-dir when run by the worker)
	outputDir := "output"
	pkgInfoDir := "pkginfo"
	if err := os.MkdirAll(pkgInfoDir, 0o755); err != nil {
		return fmt.Errorf("failed to create pkginfo dir: %w", err)
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return fmt.Errorf("failed to create output dir: %w", err)
	}
	statusFile := filepath.Join(outputDir, "status")
	if err := WriteStatus(statusFile, types.ImageBuildStatusBuilding); err != nil {
		return err
	}
	logger.Info("Wrote status=building; preparing melange command")

	// Root in-container: no sudo. Non-root + root mode: sudo melange so bubblewrap can create namespaces.
	// Under sudo, secure_path drops Nix; pass PATH through env(1) so melange finds bwrap and other store tools.
	melangeInvokerPrefix := ""
	if useRoot && syscall.Geteuid() != 0 {
		if _, err := exec.LookPath("sudo"); err != nil {
			_ = WriteStatus(statusFile, types.ImageBuildStatusFailed)
			return fmt.Errorf("enable-root-mode requires sudo in PATH or run the builder as root: %w", err)
		}
		if nixShellLikeEnv() {
			melangeInvokerPrefix = `sudo env "PATH=$PATH" `
		} else {
			melangeInvokerPrefix = "sudo "
		}
	}

	const melangeBin = "melange"

	// Build melange command using string slice for better readability
	cmdArgs := []string{
		melangeBin + " build melange.yaml",
		"--log-level debug",
		"--arch " + arch,
		"--signing-key local-melange.rsa",
	}

	// Add conditional flags if they're not empty
	for _, repo := range apkRepositories {
		if repo != "" {
			cmdArgs = append(cmdArgs, "--repository-append "+repo)
		}
	}
	for _, keyring := range keyringAppends {
		if keyring != "" {
			cmdArgs = append(cmdArgs, "--keyring-append "+keyring)
		}
	}

	// Add bootstrap flags if in bootstrap mode
	if bootstrapMode {
		cmdArgs = append(cmdArgs,
			"--empty-workspace",
			"--strip-origin-name",
			"--runner bubblewrap")
	}

	// Add remaining fixed arguments
	cmdArgs = append(cmdArgs,
		"--namespace Securebuild",
		`--license "Apache-2.0"`,
		"--cache-dir /tmp/melange-cache",
		"--pipeline-dir ./pipelines/packages/",
		"--env-file build-"+arch+".env",
	)

	// Join with space and line continuation for readability
	melangeCmd := strings.Join(cmdArgs, " \\\n\t")
	logger.Info("Melange command", zap.String("melangeCmd", melangeCmd))

	// Phase 1: Build
	buildCmd := fmt.Sprintf(`set -euo pipefail
mkdir -p packages;
mkdir -p output;
mkdir -p /tmp/melange-cache;
echo "DEBUG: pwd=$(pwd)";
echo "DEBUG: ls -la:";
ls -la;
echo "DEBUG: ls -la build-*.env 2>&1:";
ls -la build-*.env 2>&1 || true;
echo "Starting melange build for %s architecture at $(date)";
%s%s > output/melange_stdout_%s.log 2> output/melange_stderr_%s.log;
MELANGE_EXIT_CODE=$?;
echo $MELANGE_EXIT_CODE > output/melange_done_%s.txt;
echo "Melange build completed for %s architecture at $(date) with exit code $MELANGE_EXIT_CODE";
	`, arch, melangeInvokerPrefix, melangeCmd, arch, arch, arch, arch)

	logger.Info("Running melange build (blocking until complete); melange stdout/stderr go to output/melange_stdout_*.log and output/melange_stderr_*.log")
	output, err := exec.CommandContext(ctx, "bash", "-c", buildCmd).CombinedOutput()
	logger.Info("Melange build command finished", zap.Int("outputLen", len(output)), zap.Error(err))
	logger.Debug("build command terminated", zap.String("output", string(output)), zap.Error(err))
	if err != nil {
		WriteStatus(statusFile, types.ImageBuildStatusFailed)
		return nil
	}

	// Phase 2: Test (melange test is always run - it's a no-op if no test section exists)
	logger.Info("Testing package")

	if err := WriteStatus(statusFile, types.ImageBuildStatusTesting); err != nil {
		return err
	}

	// Test command uses the same repositories/keyrings passed to the build command.
	// Build dynamic repository flags for test command
	testRepoFlags := "\t--repository-append packages \\\n"
	for _, repo := range apkRepositories {
		if repo != "" {
			testRepoFlags += fmt.Sprintf("\t--repository-append %s \\\n", repo)
		}
	}
	testKeyringFlags := "\t--keyring-append local-melange.rsa.pub \\\n"
	for _, keyring := range keyringAppends {
		if keyring != "" {
			testKeyringFlags += fmt.Sprintf("\t--keyring-append %s \\\n", keyring)
		}
	}

	testCmd := fmt.Sprintf(`set -euo pipefail
echo "Starting melange test for %s architecture at $(date)";
%s%s test melange.yaml \
	--arch %s \
	--source-dir . \
	--pipeline-dirs ./pipelines/packages/ \
%s%s	--test-package-append "busybox" \
	>> output/melange_stdout_%s.log 2>> output/melange_stderr_%s.log;
MELANGE_TEST_EXIT_CODE=$?;
echo $MELANGE_TEST_EXIT_CODE > output/melange_test_done_%s.txt;
echo "Melange test completed for %s architecture at $(date) with exit code $MELANGE_TEST_EXIT_CODE";
exit $MELANGE_TEST_EXIT_CODE;
	`, arch, melangeInvokerPrefix, melangeBin, arch, testRepoFlags, testKeyringFlags, arch, arch, arch, arch)

	testOutput, testErr := exec.CommandContext(ctx, "bash", "-c", testCmd).CombinedOutput()
	logger.Debug("test command terminated", zap.String("output", string(testOutput)), zap.Error(testErr))
	if testErr != nil {
		logger.Errorf("Tests failed: %v", testErr)
		WriteStatus(statusFile, types.ImageBuildStatusFailed)
		return nil
	}

	logger.Info("Testing package completed")

	// Phase 3: Publish
	if err := WriteStatus(statusFile, types.ImageBuildStatusPublishing); err != nil {
		return err
	}

	// create a publishing-log.txt file in the output directory
	publishingLogFile := filepath.Join(outputDir, "publishing-log.txt")
	if err := os.WriteFile(publishingLogFile, []byte(""), 0o644); err != nil {
		WriteStatus(statusFile, types.ImageBuildStatusFailed)
		return fmt.Errorf("failed to write publishing log file: %w", err)
	}

	// upload all packages
	archPackagesDir := filepath.Join("packages", arch)
	apkFilenames, err := listAPKs(ctx, archPackagesDir)
	if err != nil {
		WriteStatus(statusFile, types.ImageBuildStatusFailed)
		return fmt.Errorf("failed to list apks in s3: %w", err)
	}
	logToFile(publishingLogFile, "uploading all packages to r2")

	// Read execution ID once before uploading packages
	executionIDFile := "execution_id"
	executionIDBytes, err := os.ReadFile(executionIDFile)
	if err != nil {
		return fmt.Errorf("failed to read execution id file: %w", err)
	}
	executionID := string(executionIDBytes)

	// upload all packages to r2 and write the index content to disk
	for _, apkFilename := range apkFilenames {
		logToFile(publishingLogFile, fmt.Sprintf("uploading %s to r2", apkFilename))

		if err := UploadAPK(ctx, apkFilename, arch, r2BucketName, r2AccessKey, r2SecretKey, r2Endpoint, r2Region, r2Directory, publishingLogFile, executionID, zoneID, cachePurgeToken, len(apkFilenames)); err != nil {
			WriteStatus(statusFile, types.ImageBuildStatusFailed)
			logToFile(publishingLogFile, fmt.Sprintf("failed to upload apk: %s", err))
			return fmt.Errorf("failed to upload apk: %w", err)
		}

		logToFile(publishingLogFile, fmt.Sprintf("uploaded %s to r2", apkFilename))
	}

	logToFile(publishingLogFile, "all packages uploaded to r2")

	// status the status to success
	if err := WriteStatus(statusFile, types.ImageBuildStatusSuccess); err != nil {
		return err
	}

	return nil
}

func logToFile(filename string, message string) {
	now := time.Now()

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		os.WriteFile(filename, []byte(""), 0o644)
	}

	msg := fmt.Sprintf("%s: %s\n", now.Format("2006-01-02 15:04:05"), message)

	f, err := os.OpenFile(filename, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		logger.Errorf("failed to open file: %s", err)
		return
	}
	defer f.Close()

	if _, err := f.WriteString(msg); err != nil {
		logger.Errorf("failed to write to file: %s", err)
		return
	}
}

func writePkgInfo(ctx context.Context, apkFilename string, arch string, pkgInfoFilename string, executionID string, expectedAPKCount int) error {
	// Try optimized extraction first
	apkMeta, err := apk.ExtractAPKMetadataOptimized(apkFilename)
	if err != nil {
		// If optimized extraction fails, fall back to the standard extraction method
		logger.Warnf("Optimized APK metadata extraction failed for %s, trying fallback method: %v", apkFilename, err)
		apkMeta, err = apk.ExtractAPKMetadata(apkFilename)
		if err != nil {
			return fmt.Errorf("failed to extract apk metadata (both optimized and fallback methods failed): %w", err)
		}
		logger.Infof("Successfully extracted APK metadata using fallback method for %s", apkFilename)
	}

	apkPublishedEvent := ApkPublishedEvent{
		PKGInfo:          apkMeta,
		ExecutionID:      string(executionID),
		APKFilename:      filepath.Base(apkFilename),
		Arch:             arch,
		ExpectedAPKCount: expectedAPKCount,
	}

	b, err := json.Marshal(apkPublishedEvent)
	if err != nil {
		return fmt.Errorf("failed to marshal apk metadata: %w", err)
	}

	if err := os.WriteFile(pkgInfoFilename, b, 0o644); err != nil {
		return fmt.Errorf("failed to write pkg info file: %w", err)
	}

	return nil
}

func listAPKs(ctx context.Context, outputDir string) ([]string, error) {
	apkFiles := []string{}

	err := filepath.Walk(outputDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		if filepath.Ext(path) == ".apk" {
			apkFiles = append(apkFiles, path)
		}

		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to walk output dir: %w", err)
	}

	return apkFiles, nil
}

type ApkPublishedEvent struct {
	PKGInfo          map[string]string
	ExecutionID      string
	APKFilename      string
	Arch             string
	ExpectedAPKCount int
}

func UploadAPK(ctx context.Context, apkFilename string, arch string, bucketName string, accessKeyID string, secretAccessKey string, endpoint string, region string, directory string, publishingLogFile string, executionID string, cfZoneID string, cfCachePurgeToken string, expectedAPKCounts ...int) error {
	expectedAPKCount := 1
	if len(expectedAPKCounts) > 0 && expectedAPKCounts[0] > 0 {
		expectedAPKCount = expectedAPKCounts[0]
	}

	logToFile(publishingLogFile, fmt.Sprintf("in uploadAPK: uploading %s to r2", apkFilename))
	apkKey := filepath.Join(directory, arch, filepath.Base(apkFilename))
	if err := UploadFileToR2WithRetries(ctx, apkFilename, bucketName, apkKey, accessKeyID, secretAccessKey, endpoint, region, publishingLogFile, 3, cfZoneID, cfCachePurgeToken); err != nil {
		return fmt.Errorf("failed to upload apk: %w", err)
	}
	logToFile(publishingLogFile, fmt.Sprintf("uploaded %s to r2", apkFilename))

	pkgInfoFile, err := os.CreateTemp("", "pkginfo-*.json")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer pkgInfoFile.Close()
	defer os.Remove(pkgInfoFile.Name()) // Clean up temp file

	logToFile(publishingLogFile, fmt.Sprintf("writing pkg info for %s", apkFilename))
	if err := writePkgInfo(ctx, apkFilename, arch, pkgInfoFile.Name(), executionID, expectedAPKCount); err != nil {
		return fmt.Errorf("failed to write pkg info: %w", err)
	}
	logToFile(publishingLogFile, fmt.Sprintf("wrote pkg info for %s", apkFilename))

	logToFile(publishingLogFile, fmt.Sprintf("uploading pkg info for %s to r2", apkFilename))
	metadataKey := filepath.Join(directory, arch, fmt.Sprintf("executions/%s.json", filepath.Base(apkFilename)))
	if err := UploadFileToR2WithRetries(ctx, pkgInfoFile.Name(), bucketName, metadataKey, accessKeyID, secretAccessKey, endpoint, region, publishingLogFile, 3, cfZoneID, cfCachePurgeToken); err != nil {
		return fmt.Errorf("failed to upload pkg info: %w", err)
	}
	logToFile(publishingLogFile, fmt.Sprintf("uploaded pkg info for %s to r2", apkFilename))

	logger.Infof("Successfully uploaded %s to R2 bucket %s", apkFilename, bucketName)
	return nil
}

func UploadFileToR2WithRetries(ctx context.Context, fileName string, bucketName string, key string, accessKeyID string, secretAccessKey string, endpoint string, region string, publishingLogFile string, retries int, cfZoneID string, cfAPIKey string) error {
	fi, err := os.Stat(fileName)
	if err != nil {
		return err
	}

	useMultipart := fi.Size() > 5*1024*1024

	for i := 0; i < retries; i++ {
		var err error
		if useMultipart {
			err = uploadFileToR2Multipart(ctx, fileName, bucketName, key, accessKeyID, secretAccessKey, endpoint, region, publishingLogFile, cfZoneID, cfAPIKey)
		} else {
			err = uploadFileToR2(ctx, fileName, bucketName, key, accessKeyID, secretAccessKey, endpoint, region, publishingLogFile, cfZoneID, cfAPIKey)
		}

		if err == nil {
			return nil
		}

		logToFile(publishingLogFile, fmt.Sprintf("failed to upload file to R2: %s", err))
		if i == retries-1 {
			return fmt.Errorf("failed to upload file to R2 after %d retries: %w", retries, err)
		}
		time.Sleep(10 * time.Second)
	}

	return nil
}

func uploadFileToR2(ctx context.Context, fileName string, bucketName string, key string, accessKeyID string, secretAccessKey string, endpoint string, region string, publishingLogFile string, cfZoneID string, cfAPIKey string) error {
	// Use a proper custom endpoint resolver
	customResolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, _ ...interface{}) (aws.Endpoint, error) {
		return aws.Endpoint{
			URL:               endpoint, // e.g. https://c2592895222dce604580569f98ef7094.r2.cloudflarestorage.com
			SigningRegion:     region,
			HostnameImmutable: true, // important for R2 to avoid path-style fallback
		}, nil
	})

	// Load AWS config with custom resolver
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(region),
		config.WithEndpointResolverWithOptions(customResolver),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, "")),
	)
	if err != nil {
		return fmt.Errorf("failed to load AWS config: %w", err)
	}

	// Create S3 client with path-style if R2_USE_PATH_STYLE environment variable is set
	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		if os.Getenv("R2_USE_PATH_STYLE") == "true" {
			o.UsePathStyle = true
		}
	})

	// Open the file
	file, err := os.Open(fileName)
	if err != nil {
		return fmt.Errorf("failed to open APK file %s: %w", fileName, err)
	}
	defer file.Close()

	// Upload to R2
	logToFile(publishingLogFile, fmt.Sprintf("in uploadFileToR2: calling PutObject for key %s", key))
	_, err = s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(bucketName),
		Key:    aws.String(key),
		Body:   file,
	})
	if err != nil {
		logToFile(publishingLogFile, fmt.Sprintf("failed to upload APK %s to R2: %s", fileName, err))
		return fmt.Errorf("failed to upload APK %s to R2: %w", fileName, err)
	}

	// Purge CloudFlare cache for the uploaded file
	apkURL := fmt.Sprintf("%s/%s", param.GetParam(ctx).ApkRepository, key)
	if err := cloudflare.PurgeCache(ctx, cfZoneID, cfAPIKey, []string{apkURL}); err != nil {
		// Log warning but don't fail the upload
		logToFile(publishingLogFile, fmt.Sprintf("warning: failed to purge cloudflare cache for %s: %s", apkURL, err))
	} else {
		logToFile(publishingLogFile, fmt.Sprintf("purged cloudflare cache for %s", apkURL))
	}

	return nil
}

func uploadFileToR2Multipart(ctx context.Context, fileName string, bucketName string, key string, accessKeyID string, secretAccessKey string, endpoint string, region string, publishingLogFile string, cfZoneID string, cfAPIKey string) error {
	customResolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, _ ...interface{}) (aws.Endpoint, error) {
		return aws.Endpoint{
			URL:               endpoint,
			SigningRegion:     region,
			HostnameImmutable: true,
		}, nil
	})

	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(region),
		config.WithEndpointResolverWithOptions(customResolver),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, "")),
	)
	if err != nil {
		return fmt.Errorf("failed to load AWS config: %w", err)
	}

	// Create S3 client with path-style if R2_USE_PATH_STYLE environment variable is set
	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		if os.Getenv("R2_USE_PATH_STYLE") == "true" {
			o.UsePathStyle = true
		}
	})

	file, err := os.Open(fileName)
	if err != nil {
		return fmt.Errorf("failed to open file %s: %w", fileName, err)
	}
	defer file.Close()

	logToFile(publishingLogFile, fmt.Sprintf("using multipart upload for key %s", key))

	uploader := manager.NewUploader(s3Client, func(u *manager.Uploader) {
		u.PartSize = 5 * 1024 * 1024 // 5MB per part
		u.Concurrency = 3            // limit parallelism
	})

	_, err = uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket: aws.String(bucketName),
		Key:    aws.String(key),
		Body:   file,
	})
	if err != nil {
		logToFile(publishingLogFile, fmt.Sprintf("multipart upload failed for %s: %s", fileName, err))
		return fmt.Errorf("multipart upload failed: %w", err)
	}

	// Purge CloudFlare cache for the uploaded file
	apkURL := fmt.Sprintf("%s/%s", param.GetParam(ctx).ApkRepository, key)
	if err := cloudflare.PurgeCache(ctx, cfZoneID, cfAPIKey, []string{apkURL}); err != nil {
		// Log warning but don't fail the upload
		logToFile(publishingLogFile, fmt.Sprintf("warning: failed to purge cloudflare cache for %s: %s", apkURL, err))
	} else {
		logToFile(publishingLogFile, fmt.Sprintf("purged cloudflare cache for %s", apkURL))
	}

	return nil
}

type Message struct {
	APKFilename     string `json:"apkFilename"`
	PkgInfoFilename string `json:"pkgInfoFilename"`
}
