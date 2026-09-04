package apkproxy_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/securebuildhq/securebuild/builder-cmd/cli"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/apk"
	sbexecution "github.com/securebuildhq/securebuild/pkg/execution"
	"github.com/securebuildhq/securebuild/pkg/listener"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

// extractFileFromTarGz extracts a file from a gzipped tar archive
// If multistream is true, sets Multistream(false) on the gzip reader to handle concatenated gzip streams
// Returns the file content as a string, or empty string if file not found
func extractFileFromTarGz(reader io.Reader, filename string, multistream bool) (string, error) {
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return "", fmt.Errorf("failed to create gzip reader: %w", err)
	}
	if multistream {
		gzipReader.Multistream(false)
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("failed to read tar header: %w", err)
		}

		if header.Name == filename {
			content, err := io.ReadAll(tarReader)
			if err != nil {
				return "", fmt.Errorf("failed to read file content: %w", err)
			}
			return string(content), nil
		}
	}

	return "", nil
}

// TestAPKProxyHappyPath tests the complete package lifecycle including publishing and removal
// This test validates:
// 1. Publishing a package and verifying it's accessible through the proxy
// 2. Removing the package using RemovePackage (sets is_withdrawn flag)
// 3. Withdrawing the APK using WithdrawAPK (deletes from R2 and updates index)
// 4. Verifying the package is no longer accessible through the proxy
func TestAPKProxyHappyPath(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()

	// Setup test database
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	// Apply seed data (includes package and package_version fixtures)
	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	seedDataDir := filepath.Join(projectRoot, "integration", "apkproxy", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	// Setup MinIO storage
	minioStorage := testutil.SetupMinIO(ctx, t)
	defer testutil.TeardownMinIO(ctx, t, minioStorage)

	// Initialize param package with test overrides (NO MORE t.Setenv!)
	overrides := map[string]string{
		"DB_URI":                testDB.ConnStr,
		"R2_BUCKET_NAME":        minioStorage.BucketName,
		"R2_ACCESS_KEY":         minioStorage.AccessKey,
		"R2_SECRET_KEY":         minioStorage.SecretKey,
		"R2_ENDPOINT":           minioStorage.Endpoint,
		"R2_USE_DYNAMIC_FOLDER": "false",
		"R2_USE_PATH_STYLE":     "true", // Required for MinIO
		"APK_PUBLIC_KEY_NAME":   "test-key.pub",
		"APK_PUBLIC_KEY_DATA":   testutil.GenerateTestRSAPublicKey(),
		"APK_SIGNING_KEY_NAME":  "test-key.pem",
		"APK_SIGNING_KEY_DATA":  testutil.GenerateTestRSAPrivateKey(),
	}
	ctx, err = param.Init(param.InitSourceEnvironment, overrides)
	require.NoError(t, err)

	// Initialize Postgres pool
	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)

	// Start APK Proxy server (setupTestProxy will reinitialize with same values)
	proxy := setupTestProxy(ctx, t, testDB, minioStorage)
	defer teardownTestProxy(t, proxy)
	param.GetParam(ctx).ApkRepository = "http://" + proxy.Address

	arch := "x86_64"
	apkFilename := "test-package-1.0.0-r0.apk"
	pkgID := "test-package-id"
	pkgVersionID := "test-package-version-id"

	t.Run("Publish package", func(t *testing.T) {
		testPublishPackage(ctx, t, minioStorage, proxy, arch, apkFilename)
	})

	t.Run("Publish complete multi-APK manifest", func(t *testing.T) {
		testCompleteManifestIsAtomic(ctx, t, testDB, minioStorage, proxy, arch)
	})

	t.Run("Retry failed public verification", func(t *testing.T) {
		testFailedVerificationRetainsManifest(ctx, t, testDB, minioStorage, proxy, arch, apkFilename)
	})

	t.Run("Deduplicate active executions", func(t *testing.T) {
		testDuplicateExecutionPrevention(ctx, t, testDB, pkgVersionID)
	})

	t.Run("Withdraw package", func(t *testing.T) {
		testWithdrawPackage(ctx, t, testDB, proxy, arch, apkFilename, pkgID, pkgVersionID)
	})
}

func testDuplicateExecutionPrevention(ctx context.Context, t *testing.T, testDB *testutil.TestDatabase, packageVersionID string) {
	_, err := testDB.Pool.Exec(ctx, `UPDATE execution SET status = 'success' WHERE package_version_id = $1`, packageVersionID)
	require.NoError(t, err)
	pkgVersion, err := sbpackage.GetPackageVersion(ctx, packageVersionID)
	require.NoError(t, err)

	first, created, err := sbexecution.CreateExecutionIfNoActive(ctx, pkgVersion.PackageID, pkgVersion, "test", "first")
	require.NoError(t, err)
	require.True(t, created)
	second, created, err := sbexecution.CreateExecutionIfNoActive(ctx, pkgVersion.PackageID, pkgVersion, "test", "second")
	require.NoError(t, err)
	require.False(t, created)
	require.Equal(t, first.ID, second.ID, "duplicate deliveries must share the active execution")

	_, err = testDB.Pool.Exec(ctx, `UPDATE execution SET status = 'failed' WHERE id = $1`, first.ID)
	require.NoError(t, err)
}

func testFailedVerificationRetainsManifest(ctx context.Context, t *testing.T, testDB *testutil.TestDatabase, minioStorage *testutil.MinIOStorage, proxy *TestProxy, arch, apkFilename string) {
	const executionID = "test-public-verification-retry"
	_, err := testDB.Pool.Exec(ctx, `
		INSERT INTO execution (id, created_at, package_id, package_version_id, version_label, status, repository_publication_required)
		VALUES ($1, NOW() + INTERVAL '1 second', 'test-package-id', 'test-package-version-id', '1.0.0-r0', 'publishing', true)
	`, executionID)
	require.NoError(t, err)

	apkPath, err := createMinimalAPK()
	require.NoError(t, err)
	defer os.Remove(apkPath)
	require.NoError(t, uploadAPKForExecution(ctx, minioStorage, apkPath, arch, apkFilename, executionID))

	repository := param.GetParam(ctx).ApkRepository
	defer func() { param.GetParam(ctx).ApkRepository = repository }()
	param.GetParam(ctx).ApkRepository = repository + "/missing"
	_, err = listener.HandleAddApk(ctx, arch)
	require.Error(t, err)
	verifiedAt, err := sbexecution.GetExecutionRepositoryVerifiedAt(ctx, executionID, arch)
	require.NoError(t, err)
	require.Nil(t, verifiedAt)
	manifests, _, err := apk.ListPublicationManifests(ctx, arch)
	require.NoError(t, err)
	require.Len(t, manifests, 1, "failed verification must retain the only retry marker")

	param.GetParam(ctx).ApkRepository = repository
	_, err = listener.HandleAddApk(ctx, arch)
	require.NoError(t, err)
	verifiedAt, err = sbexecution.GetExecutionRepositoryVerifiedAt(ctx, executionID, arch)
	require.NoError(t, err)
	require.NotNil(t, verifiedAt)
}

func testCompleteManifestIsAtomic(ctx context.Context, t *testing.T, testDB *testutil.TestDatabase, minioStorage *testutil.MinIOStorage, proxy *TestProxy, arch string) {
	const executionID = "test-complete-manifest"
	_, err := testDB.Pool.Exec(ctx, `
		INSERT INTO execution (id, created_at, package_id, package_version_id, version_label, status, repository_publication_required)
		VALUES ($1, NOW() + INTERVAL '1 second', 'test-package-id', 'test-package-version-id', '1.0.0-r0', 'publishing', true)
	`, executionID)
	require.NoError(t, err)

	mainAPK, err := createMinimalAPKForPackage("test-package")
	require.NoError(t, err)
	defer os.Remove(mainAPK)
	subpackageAPK, err := createMinimalAPKForPackage("test-subpackage")
	require.NoError(t, err)
	defer os.Remove(subpackageAPK)

	first := stageAPKForExecution(ctx, t, minioStorage, mainAPK, arch, "test-package-1.0.0-r0.apk", executionID)
	manifests, _, err := apk.ListPublicationManifests(ctx, arch)
	require.NoError(t, err)
	require.Empty(t, manifests, "staging one output must not expose a partial publication")
	second := stageAPKForExecution(ctx, t, minioStorage, subpackageAPK, arch, "test-subpackage-1.0.0-r0.apk", executionID)
	manifests, _, err = apk.ListPublicationManifests(ctx, arch)
	require.NoError(t, err)
	require.Empty(t, manifests, "only the final complete manifest may signal publication")

	logFile, err := os.CreateTemp("", "apk-manifest-*.log")
	require.NoError(t, err)
	logFile.Close()
	defer os.Remove(logFile.Name())
	require.NoError(t, cli.UploadAPKManifest(ctx, cli.APKPublicationManifest{
		ExecutionID: executionID,
		Arch:        arch,
		Artifacts:   []cli.APKPublicationArtifact{first, second},
	}, minioStorage.BucketName, minioStorage.AccessKey, minioStorage.SecretKey, minioStorage.Endpoint, "auto", "", logFile.Name()))

	_, err = listener.HandleAddApk(ctx, arch)
	require.NoError(t, err)
	verifiedAt, err := sbexecution.GetExecutionRepositoryVerifiedAt(ctx, executionID, arch)
	require.NoError(t, err)
	require.NotNil(t, verifiedAt)

	resp, err := http.Get(fmt.Sprintf("http://%s/%s/APKINDEX.tar.gz", proxy.Address, arch))
	require.NoError(t, err)
	defer resp.Body.Close()
	indexContent, err := extractFileFromTarGz(resp.Body, "APKINDEX", false)
	require.NoError(t, err)
	require.Contains(t, indexContent, "P:test-package")
	require.Contains(t, indexContent, "P:test-subpackage")
}

func stageAPKForExecution(ctx context.Context, t *testing.T, storage *testutil.MinIOStorage, sourcePath, arch, filename, executionID string) cli.APKPublicationArtifact {
	t.Helper()
	logFile, err := os.CreateTemp("", "apk-stage-*.log")
	require.NoError(t, err)
	logFile.Close()
	defer os.Remove(logFile.Name())

	destination := filepath.Join(t.TempDir(), filename)
	source, err := os.Open(sourcePath)
	require.NoError(t, err)
	defer source.Close()
	target, err := os.Create(destination)
	require.NoError(t, err)
	_, err = io.Copy(target, source)
	require.NoError(t, err)
	require.NoError(t, target.Close())

	artifact, err := cli.StageAPK(ctx, destination, arch, storage.BucketName, storage.AccessKey, storage.SecretKey, storage.Endpoint, "auto", "", logFile.Name(), executionID)
	require.NoError(t, err)
	return artifact
}

// testPublishPackage publishes a package and verifies it's accessible through the proxy
func testPublishPackage(ctx context.Context, t *testing.T, minioStorage *testutil.MinIOStorage, proxy *TestProxy, arch string, apkFilename string) {
	fmt.Println("Publishing package...")

	// Create minimal test APK package
	fmt.Println("Creating minimal test APK package...")
	apkPath, err := createMinimalAPK()
	require.NoError(t, err)
	defer os.Remove(apkPath)

	// Extract metadata from APK
	fmt.Println("Extracting APK metadata...")
	metadata, err := apk.ExtractAPKMetadata(apkPath)
	require.NoError(t, err)
	require.Equal(t, "test-package", metadata["pkgname"])
	require.Equal(t, "1.0.0", metadata["pkgver"])
	require.Equal(t, "0", metadata["pkgrel"])
	require.Equal(t, arch, metadata["arch"])

	// Upload APK using cli.UploadAPK
	fmt.Println("Uploading APK to MinIO using cli.UploadAPK...")
	err = uploadAPK(ctx, minioStorage, apkPath, arch, apkFilename)
	require.NoError(t, err)

	verifiedAt, err := sbexecution.GetExecutionRepositoryVerifiedAt(ctx, "test-execution-id", arch)
	require.NoError(t, err)
	require.Nil(t, verifiedAt, "execution must not be repository-ready before public verification")

	// Staging is intentionally not public. The APK and APKINDEX become visible
	// together when the complete manifest is processed.
	pkgURL := fmt.Sprintf("http://%s/%s/%s", proxy.Address, arch, apkFilename)
	resp, err := http.Get(pkgURL)
	require.NoError(t, err)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Call HandleAddApk to process the pkginfo and generate APKINDEX
	fmt.Println("Calling HandleAddApk to generate APKINDEX...")
	_, err = listener.HandleAddApk(ctx, arch)
	require.NoError(t, err)

	// Verify APKINDEX is accessible and contains the package
	fmt.Println("Verifying APKINDEX contains the package...")
	indexURL := fmt.Sprintf("http://%s/%s/APKINDEX.tar.gz", proxy.Address, arch)
	resp, err = http.Get(indexURL)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	// Extract APKINDEX content (single gzip stream, so multistream=false)
	indexContent, err := extractFileFromTarGz(resp.Body, "APKINDEX", false)
	require.NoError(t, err)
	require.NotEmpty(t, indexContent, "APKINDEX file should exist in archive")

	// Verify APKINDEX contains our package
	require.Contains(t, indexContent, "test-package", "APKINDEX should contain test-package")
	fmt.Println("APKINDEX contains the package")

	verifiedAt, err = sbexecution.GetExecutionRepositoryVerifiedAt(ctx, "test-execution-id", arch)
	require.NoError(t, err)
	require.NotNil(t, verifiedAt, "execution should become ready only after its public index and APK are verified")

	// Verify package is accessible through proxy
	fmt.Println("Verifying package is accessible through proxy...")
	resp, err = http.Get(pkgURL)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	// Extract and verify APK contents
	fmt.Println("Extracting and verifying APK contents...")
	// APK format: control.tar.gz stream followed by data.tar.gz stream
	// Read all data first since we need to handle two concatenated gzip streams
	apkData, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	resp.Body.Close()

	// Skip the control stream (first gzip stream) by reading and discarding it
	buf := bytes.NewBuffer(apkData)
	controlGzip, err := gzip.NewReader(buf)
	require.NoError(t, err)
	controlGzip.Multistream(false) // Don't automatically continue to next stream
	_, err = io.Copy(io.Discard, controlGzip)
	require.NoError(t, err)
	controlGzip.Close()

	// Extract the test file from the data stream (second gzip stream in APK, so multistream=true)
	testFileContent, err := extractFileFromTarGz(buf, "usr/share/test/hello.txt", true)
	require.NoError(t, err)
	require.NotEmpty(t, testFileContent, "Expected to find usr/share/test/hello.txt in APK package")
	require.Equal(t, "hello world from test package\n", testFileContent)

	fmt.Println("Package published successfully and is accessible with correct contents")
}

// testWithdrawPackage removes a package from the database and R2 storage, then verifies it's no longer accessible
func testWithdrawPackage(ctx context.Context, t *testing.T, testDB *testutil.TestDatabase, proxy *TestProxy, arch string, apkFilename string, pkgID string, pkgVersionID string) {
	fmt.Println("Withdrawing package...")

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)

	// Call RemovePackageVersion to delete package version and related entries
	fmt.Println("Calling RemovePackageVersion...")
	err = sbpackage.RemovePackageVersion(ctx, tx, pkgVersionID)
	require.NoError(t, err)

	// Call RemovePackage to delete package and mark APKs as withdrawn
	fmt.Println("Calling RemovePackage to mark APKs as withdrawn...")
	err = sbpackage.RemovePackage(ctx, tx, pkgID, "test-package")
	require.NoError(t, err)

	err = tx.Commit(ctx)
	require.NoError(t, err)

	// Verify is_withdrawn flag is set in apk_catalog
	fmt.Println("Verifying is_withdrawn flag is set...")
	catalog, err := apk.GetCatalogAPK(ctx, apkFilename, arch)
	require.NoError(t, err)
	require.True(t, catalog.IsWithdrawn, "Expected is_withdrawn to be true")

	// Call WithdrawAPK to delete from R2 and update APKINDEX
	fmt.Println("Calling WithdrawAPK to delete from R2 and update APKINDEX...")
	err = apk.WithdrawAPK(ctx, apkFilename, arch, "test-package", "1.0.0", "r0")
	require.NoError(t, err)

	// Verify APK was deleted from apk_catalog
	fmt.Println("Verifying APK was deleted from apk_catalog...")
	var count int
	err = testDB.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM apk_catalog WHERE filename = $1 AND arch = $2", apkFilename, arch).Scan(&count)
	require.NoError(t, err)
	require.Equal(t, 0, count, "Expected APK to be deleted from apk_catalog")

	// Verify APKINDEX no longer contains the package
	fmt.Println("Verifying APKINDEX no longer contains the package...")
	indexURL := fmt.Sprintf("http://%s/%s/APKINDEX.tar.gz", proxy.Address, arch)
	indexResp, err := http.Get(indexURL)
	require.NoError(t, err)
	defer indexResp.Body.Close()
	require.Equal(t, http.StatusOK, indexResp.StatusCode)

	// Decompress and extract APKINDEX content
	gzipReader, err := gzip.NewReader(indexResp.Body)
	require.NoError(t, err)
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)
	var indexContent string
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		require.NoError(t, err)

		if header.Name == "APKINDEX" {
			indexBytes, err := io.ReadAll(tarReader)
			require.NoError(t, err)
			indexContent = string(indexBytes)
			break
		}
	}

	// Verify APKINDEX does not contain our package
	require.NotContains(t, indexContent, "P:test-package", "APKINDEX should not contain test-package entry after withdrawal")

	// Verify package is no longer accessible through proxy
	fmt.Println("Verifying package is no longer accessible through proxy...")
	pkgURL := fmt.Sprintf("http://%s/%s/%s", proxy.Address, arch, apkFilename)
	resp, err := http.Get(pkgURL)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	fmt.Println("Package withdrawn successfully and is no longer accessible")
}

// UploadAPK uploads an APK file using the production cli.UploadAPK function from builder-cmd
// This uploads both the APK file and creates the pkginfo JSON in the executions folder
func uploadAPK(ctx context.Context, m *testutil.MinIOStorage, apkPath, arch, filename string) error {
	return uploadAPKForExecution(ctx, m, apkPath, arch, filename, "test-execution-id")
}

func uploadAPKForExecution(ctx context.Context, m *testutil.MinIOStorage, apkPath, arch, filename, executionID string, expectedAPKCounts ...int) error {
	// Create a temporary log file for the upload function
	logFile, err := os.CreateTemp("", "apk-upload-*.log")
	if err != nil {
		return fmt.Errorf("failed to create temp log file: %w", err)
	}
	defer os.Remove(logFile.Name())
	logFile.Close()

	// Copy the APK file to a temp file with the desired filename
	// cli.UploadAPK uses filepath.Base() to determine the S3 key, so we need
	// the temp file to have the correct basename
	tmpDir := os.TempDir()
	tmpApkPath := tmpDir + "/" + filename

	srcFile, err := os.Open(apkPath)
	if err != nil {
		return fmt.Errorf("failed to open source APK: %w", err)
	}
	defer srcFile.Close()

	dstFile, err := os.Create(tmpApkPath)
	if err != nil {
		return fmt.Errorf("failed to create temp APK: %w", err)
	}
	defer os.Remove(tmpApkPath)
	defer dstFile.Close()

	_, err = dstFile.ReadFrom(srcFile)
	if err != nil {
		return fmt.Errorf("failed to copy APK: %w", err)
	}
	dstFile.Close()

	// Call the production UploadAPK function with the renamed temp file
	// This uploads the APK to execution-scoped staging and creates the
	// corresponding publication event.
	err = cli.UploadAPK(
		ctx,
		tmpApkPath,
		arch,
		m.BucketName,
		m.AccessKey,
		m.SecretKey,
		m.Endpoint,
		"auto", // region
		"",     // directory (empty = root of bucket)
		logFile.Name(),
		executionID,
		"", // zoneID
		"", // cachePurgeToken
		expectedAPKCounts...,
	)
	if err != nil {
		return fmt.Errorf("failed to upload APK: %w", err)
	}

	fmt.Printf("Uploaded APK to MinIO using cli.UploadAPK: %s/%s\n", arch, filename)
	return nil
}
