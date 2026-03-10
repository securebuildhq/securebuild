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
		"APK_PUBLIC_KEY_DATA":   "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUFxZUhrUEJEMW5NQk9CeWJVb0RzdwpveGJKNktvV0Jad1ZubVo4NkxGcWszZkZYT3hGaGw4bFJKKzl5NlNicXM5SHk3YmlzMkVLY3lBZ29zcTNJNi9oCkRjam03ZFk1Q1FBYVNGWTVNL1ExamkwNTZuUWhERExpMGdpMHE4cGRJMy9uZWFDczlIL1RmZDVGd014WGFveG4KMUxXekhZUVVmWmN2Qlc0MFp1NmN5OSs5dDBFZ0gvOXp0MU1HYWhiL0NJZGg3ejhmTkxWczY0TW5DMXlNT3pFcApoZnZqckZicUY1NTJObU0yUXFiU2ZBSmVGaEhUM20xUllwbzJSc2tqMlpJZ0hjK2RVZURSQktsL282aE9MbXo0Cm9LaXMxcTltTnVDQ2hPRFg4UzR1eSsvbHZhWmVOUE9BNk9KR0hSOVB3SFpkQ0U3YklWNWJSS0pkMGo2VzllMWQKd1FJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==",
		"APK_SIGNING_KEY_NAME":  "test-key.pem",
		"APK_SIGNING_KEY_DATA":  "LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2UUlCQURBTkJna3Foa2lHOXcwQkFRRUZBQVNDQktjd2dnU2pBZ0VBQW9JQkFRQ3A0ZVE4RVBXY3dFNEgKSnRTZ096Q2pGc25vcWhZRm5CV2Vabnpvc1dxVGQ4VmM3RVdHWHlWRW43M0xwSnVxejBmTHR1S3pZUXB6SUNDaQp5cmNqcitFTnlPYnQxamtKQUJwSVZqa3o5RFdPTFRucWRDRU1NdUxTQ0xTcnlsMGpmK2Q1b0t6MGY5Tjkza1hBCnpGZHFqR2ZVdGJNZGhCUjlseThGYmpSbTdwekwzNzIzUVNBZi8zTzNVd1pxRnY4SWgySHZQeDgwdFd6cmd5Y0wKWEl3N01TbUYrK09zVnVvWG5uWTJZelpDcHRKOEFsNFdFZFBlYlZGaW1qWkd5U1Baa2lBZHo1MVI0TkVFcVgragpxRTR1YlBpZ3FLeldyMlkyNElLRTROZnhMaTdMNytXOXBsNDA4NERvNGtZZEgwL0FkbDBJVHRzaFhsdEVvbDNTClBwYjE3VjNCQWdNQkFBRUNnZ0VBQ0MvVmZEN1B2Rml3NWZPMVMxM0Ezcm92VzZ2Zk5QRGdRcGFETW1KUzdkV0gKdkk0N0hVSTJjVUcrdjNxd3dRejlVM1FlUlpsaGk5bm1jcnZ3MHBxa0xwSXlEVkFOcG5rem13enpNNldUSTJWNgo4UmxjdXBvVTc5enBLbzU5ZWJPTk5lR0VOa0gzQU8zS1dDUE0ybXJXNmVPQ0JOUVB1ZnYwUVZkdDFYQk9QSDJwCkJUWEI3by9Fa1RGajhvQ2x4amRyTVZ2NGxaMnNXbEliQVJJV1J1eW93aFljeHF5ZHMwRWQ3UlRLZWszVnFSSUUKS0ovd1V2ZlNjSkhrWTZ3UDhxYVlNeUQ0Y3J1ODNRWUlma1FtZlhMK2Y3NDhhMmtsSnFmR0JuQUFOK3pVemtYWQpDcmp4cFdSZ3pDU3pGdXovbm44a1FQYSt3OXBCZWY2dEgycW9MZFByOFFLQmdRRHNIa3lOYmZ2K3BmbnlEZVdYCk1XU0tLMmJVaTF5UFFheGJ4c1RPSVhEYm5EV0xqOU1GRExDaWFrUDJMNkpDTCtvWGkwRzRkcTFqbW9wWW05aUYKUnc5S1dneW9BamNqMEpHNDh0RlBiRDB5a0RZdXNDZjRmZ1poV0N2Y3p6NTlVVERFaXhZTUVFL0d5OUYyWDl4Uwphbk1Wa1RDWitTZmU5Tzc0VGcwK0h5cmY4UUtCZ1FDNEw5UWZ1Mjl0dHhIK0F6ZGR1c0xSdEMxOGF2R05id2xOCkRmdnFMSUFqaXFLL0Z3bVl0V2pZY25PWUozV0p5NDVoZmZaMHFtR05QaFB1bjV4Mzg3L2JYL3BmdnhicXZUNHIKZ3A4SklDbUJsVWl3citkSmxsay9BdTQrbDZGczJOaHh2SVdwbkZlUFFPTTRDYnNYTVhkQlJyZTlvREczdUdDeAoyOFYwTFI4cTBRS0JnRlNHb0RiOUNYbm1wdXg5QnhTeDdPRDltb2s1L24rV0xnS0l6SWxTTlZtWXVSNWw5VS9ZCmRCOGdWWVg3RldZR1N4SDBteWxTNnMwK1ZJcFYrQlAyRlVZenFGWTR2TTZJYXJJLzBxaFJBak5vcHN6ZDZPRXYKRkUraXhjajlNOHllMVF0M0V3UnNqbktISWt2ekV5YzV6a3NKTjlIVy9PdjIyTmx3NzVLdWk2V3hBb0dCQUxWNgordW1oUjNPMVZGY1NXRFZVVmExR2VTTUVSS2wwNUpjMTFpZXdYVG1uMmgrcTFWdlFNMVJCd1VBRWNUMnFnY254CjBTcTJ6cFBhdk16OEc3SGRUQWNkbEpkT3M0ZnJteHhJQWVkOTl5ZWxMaEJaNGV5UjViRytjM3pjN3NOUERrVlMKMmVoN0VaTW0vanN5NjFNNC9DWW5SZGZqeGRrZUpMaGFzVDE5VUI1aEFvR0FDZVlsZDJUcERKdGNYWFVaQ3RqcwpKVktCd2pkT2NCckM4VWVaQUNFREQzOFpYbWxZeU4rUkV3VklGQXBNMFkwQ3BhZEt1NmNLRmdBT003NWIwbmpVClBXaVEwT3ZldXdUWjg5VGhhcVR6b2FoNFlmRFROOUxnaUZxNThkcStVY2dOaU0wNjZUUVlPZ3JqZDBKdUpadDcKelFoS01mM0lhMUFCVHY2RG1mb1Mvb2M9Ci0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS0K",
	}
	ctx, err = param.Init(param.InitSourceEnvironment, overrides)
	require.NoError(t, err)

	// Initialize Postgres pool
	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)

	// Start APK Proxy server (setupTestProxy will reinitialize with same values)
	proxy := setupTestProxy(ctx, t, testDB, minioStorage)
	defer teardownTestProxy(t, proxy)

	arch := "x86_64"
	apkFilename := "test-package-1.0.0-r0.apk"
	pkgID := "test-package-id"
	pkgVersionID := "test-package-version-id"

	t.Run("Publish package", func(t *testing.T) {
		testPublishPackage(ctx, t, minioStorage, proxy, arch, apkFilename)
	})

	t.Run("Withdraw package", func(t *testing.T) {
		testWithdrawPackage(ctx, t, testDB, proxy, arch, apkFilename, pkgID, pkgVersionID)
	})
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

	// Call HandleAddApk to process the pkginfo and generate APKINDEX
	fmt.Println("Calling HandleAddApk to generate APKINDEX...")
	_, err = listener.HandleAddApk(ctx, arch)
	require.NoError(t, err)

	// Verify APKINDEX is accessible and contains the package
	fmt.Println("Verifying APKINDEX contains the package...")
	indexURL := fmt.Sprintf("http://%s/%s/APKINDEX.tar.gz", proxy.Address, arch)
	resp, err := http.Get(indexURL)
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

	// Verify package is accessible through proxy
	fmt.Println("Verifying package is accessible through proxy...")
	pkgURL := fmt.Sprintf("http://%s/%s/%s", proxy.Address, arch, apkFilename)
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
	// This uploads the APK AND creates the pkginfo JSON in the executions folder
	// Pass "test-execution-id" directly as the executionID parameter
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
		"test-execution-id", // executionID
		"",                  // zoneID
		"",                  // cachePurgeToken
	)
	if err != nil {
		return fmt.Errorf("failed to upload APK: %w", err)
	}

	fmt.Printf("Uploaded APK to MinIO using cli.UploadAPK: %s/%s\n", arch, filename)
	return nil
}
