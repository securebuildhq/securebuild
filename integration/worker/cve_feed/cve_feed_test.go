package worker_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"path/filepath"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/security"
	"github.com/stretchr/testify/require"
)

// LatestJSON represents the structure of latest.json
type LatestJSON struct {
	SHA256 string `json:"sha256"`
}

// TestPublishFeedHappyPath tests the complete feed publishing pipeline
// This test validates:
// 1. PublishFeed generates feed from cve_package_fix table
// 2. PublishFeed publishes feed to R2/MinIO storage
// 3. v1/latest.json and v1/secdb.json.gz files are created
// 4. SHA256 hash in latest.json matches actual feed hash
// 5. Feed content structure is valid and contains expected CVE entries
func TestPublishFeedHappyPath(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()

	// Setup test database
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	// Apply seed data using SchemaHero
	seedDataPath := filepath.Join("integration", "worker", "cve_feed", "testdata", "cve_package_fix_seed.yaml")
	err := testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataPath, true)
	require.NoError(t, err, "Failed to apply seed data")

	// Setup MinIO storage
	minioStorage := testutil.SetupMinIO(ctx, t)
	defer testutil.TeardownMinIO(ctx, t, minioStorage)

	// Initialize param package with test overrides
	overrides := map[string]string{
		"DB_URI":                testDB.ConnStr,
		"R2_BUCKET_NAME":        minioStorage.BucketName,
		"R2_FEED_BUCKET_NAME":   minioStorage.BucketName, // Feed publishing uses this
		"R2_ACCESS_KEY":         minioStorage.AccessKey,
		"R2_SECRET_KEY":         minioStorage.SecretKey,
		"R2_ENDPOINT":           minioStorage.Endpoint,
		"R2_USE_DYNAMIC_FOLDER": "false",
		"R2_USE_PATH_STYLE":     "true", // Required for MinIO
	}

	ctx, err = param.Init(param.InitSourceEnvironment, overrides)
	require.NoError(t, err)

	// Initialize postgres connection pool
	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)
	defer persistence.ClosePool(ctx)

	// Get S3 client for verification
	s3Client := minioStorage.S3Client

	// Step 1: Call PublishFeed to generate and publish feed end-to-end
	t.Log("Calling PublishFeed to generate and publish feed...")
	err = security.PublishFeed(ctx)
	require.NoError(t, err, "PublishFeed should succeed")

	// Step 2: Download and verify v1/latest.json
	t.Log("Downloading and verifying v1/latest.json...")
	latestObj, err := s3Client.GetObject(
		ctx,
		&s3.GetObjectInput{
			Bucket: &minioStorage.BucketName,
			Key:    stringPtr("v1/latest.json"),
		},
	)
	require.NoError(t, err, "v1/latest.json should exist in MinIO")
	defer latestObj.Body.Close()

	latestData, err := io.ReadAll(latestObj.Body)
	require.NoError(t, err)

	var downloadedLatest LatestJSON
	err = json.Unmarshal(latestData, &downloadedLatest)
	require.NoError(t, err, "latest.json should be valid JSON")
	require.NotEmpty(t, downloadedLatest.SHA256, "latest.json should contain SHA256")
	t.Logf("latest.json SHA256: %s", downloadedLatest.SHA256)

	// Step 3: Download and verify v1/secdb.json.gz
	t.Log("Downloading and verifying v1/secdb.json.gz...")
	feedObj, err := s3Client.GetObject(
		ctx,
		&s3.GetObjectInput{
			Bucket: &minioStorage.BucketName,
			Key:    stringPtr("v1/secdb.json.gz"),
		},
	)
	require.NoError(t, err, "v1/secdb.json.gz should exist in MinIO")
	defer feedObj.Body.Close()

	// Read the gzipped data first
	gzippedData, err := io.ReadAll(feedObj.Body)
	require.NoError(t, err)

	// Step 4: Verify SHA256 of compressed feed matches latest.json
	downloadedHash := sha256.Sum256(gzippedData)
	actualSHA := hex.EncodeToString(downloadedHash[:])
	require.Equal(t, downloadedLatest.SHA256, actualSHA, "SHA256 of compressed feed should match latest.json")
	t.Logf("v1/secdb.json.gz SHA256 verified: %s", actualSHA)

	// Decompress and read feed for content validation
	gzipReader, err := gzip.NewReader(bytes.NewReader(gzippedData))
	require.NoError(t, err)
	defer gzipReader.Close()

	downloadedFeedBytes, err := io.ReadAll(gzipReader)
	require.NoError(t, err)

	// Step 5: Parse and validate feed content
	var downloadedFeed security.AlpineSecDB
	err = json.Unmarshal(downloadedFeedBytes, &downloadedFeed)
	require.NoError(t, err, "Feed should be valid JSON")

	// Validate feed structure
	require.NotEmpty(t, downloadedFeed.Packages, "Feed should contain packages")
	require.Equal(t, "v1", downloadedFeed.DistroVersion)
	require.Contains(t, downloadedFeed.Archs, "x86_64")
	require.Contains(t, downloadedFeed.Archs, "aarch64")

	// Find helm-3.19 package in feed
	var helmPackage *security.AlpineSecDBPackage
	for i := range downloadedFeed.Packages {
		if downloadedFeed.Packages[i].Pkg.Name == "helm-3.19" {
			helmPackage = &downloadedFeed.Packages[i]
			break
		}
	}
	require.NotNil(t, helmPackage, "Feed should contain helm-3.19 package")

	// Validate helm-3.19 secfixes
	secfixes := helmPackage.Pkg.SecFixes
	require.NotEmpty(t, secfixes, "helm-3.19 should have secfixes")

	// Check version "0" for unfixable CVE
	version0CVEs, ok := secfixes["0"]
	require.True(t, ok, "helm-3.19 should have version '0' for unfixable CVEs")
	require.Contains(t, version0CVEs, "CVE-2019-25210", "Version '0' should contain CVE-2019-25210")
	t.Logf("helm-3.19 version '0' CVEs: %v", version0CVEs)

	// Check version "3.19.0-r3" for fixed Go module CVEs
	version3190r3CVEs, ok := secfixes["3.19.0-r3"]
	require.True(t, ok, "helm-3.19 should have version '3.19.0-r3' for fixed CVEs")
	require.Contains(t, version3190r3CVEs, "CVE-2025-58181", "Version '3.19.0-r3' should contain CVE-2025-58181")
	require.Contains(t, version3190r3CVEs, "CVE-2025-47914", "Version '3.19.0-r3' should contain CVE-2025-47914")
	t.Logf("helm-3.19 version '3.19.0-r3' CVEs: %v", version3190r3CVEs)

	// Check version "None" for CVEs with upstream fix but no package fix
	versionNoneCVEs, ok := secfixes["None"]
	require.True(t, ok, "helm-3.19 should have version 'None' for CVEs with upstream fix but no package fix")
	require.Contains(t, versionNoneCVEs, "CVE-2025-99999", "Version 'None' should contain CVE-2025-99999")
	t.Logf("helm-3.19 version 'None' CVEs: %v", versionNoneCVEs)

	// Verify we have exactly 3 versions in secfixes (0, 3.19.0-r3, and None)
	require.Len(t, secfixes, 3, "helm-3.19 should have exactly 3 versions in secfixes")

	t.Log("Feed publishing and verification completed successfully!")
}

// stringPtr returns a pointer to a string
func stringPtr(s string) *string {
	return &s
}
