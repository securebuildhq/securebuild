package worker_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"path/filepath"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/externalimage"
	"github.com/securebuildhq/securebuild/pkg/listener"
	listenertypes "github.com/securebuildhq/securebuild/pkg/listener/types"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/sbom"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestExternalImageScanStatusTransitions verifies the complete state transition workflow
// for external image scanning with separate SBOM and scan status tracking:
// SBOM: pending → generating → succeeded
// Scan: queued → running → succeeded
// Uses the actual handler code with mocked SBOM/scan operations.
func TestExternalImageScanStatusTransitions(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()

	ctx := context.Background()

	// Setup test database
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	// Apply base schema (external_image tables)
	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	schemaDir := filepath.Join(projectRoot, "db", "schema", "tables")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, schemaDir, false)
	require.NoError(t, err)

	// Apply seed data
	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "external_image", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	// Initialize context with database + MinIO object storage
	ctx, minioStorage := setupMinIOOverrides(ctx, t, testDB.ConnStr)
	defer testutil.TeardownMinIO(ctx, t, minioStorage)

	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)
	defer persistence.ClosePool(ctx)

	testDigest := "sha256:test-transition-digest-12345678901234567890123456789012"

	// Mock SBOM fetch to return results for x86_64 only
	mockFetchSBOM := func(ctx context.Context, registry string, imageName string, digest string) ([]sbom.SBOMResult, error) {
		return []sbom.SBOMResult{
			{
				Architecture:   "linux/amd64",
				SBOM:           `{"artifacts":[],"source":{"type":"image","target":{"imageIndex":0}}}`,
				Source:         "syft",
				ImageSizeBytes: 1024000,
				ImageDigest:    "sha256:mockdigest-x86-64",
			},
		}, nil
	}

	// Mock scan to return success results
	mockScanExternalImage := func(ctx context.Context, digest string) (map[string]string, error) {
		return map[string]string{
			"x86_64": `{"matches":[],"descriptor":{"name":"grype","version":"0.95.0"}}`,
		}, nil
	}

	t.Run("Complete happy path workflow", func(t *testing.T) {
		// Step 1: Add external image tag (simulates monitor detecting new image)
		err := externalimage.AddExternalImage(ctx, "docker.io", "library/nginx", "latest", testDigest, "", "")
		require.NoError(t, err)

		// Step 2: Initialize SBOM pending status (simulates monitor before enqueuing)
		err = externalimage.InitializeSBOMStatusPending(ctx, testDigest)
		require.NoError(t, err)

		// Verify single SBOM status exists
		sbomStatuses := getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1, "Should create single SBOM status")
		assert.Equal(t, "pending", sbomStatuses[0].Status, "SBOM status should be pending")

		// Step 3: Process SBOM handler (simulates worker processing the job)
		// Create payload
		payload := listenertypes.ExternalImageSbomPayload{
			Digest: testDigest,
		}

		// Set up mocks
		ctx = setupMocks(ctx, mockFetchSBOM, mockScanExternalImage)

		// Call the actual handler - it will:
		// - Set SBOM status to generating
		// - Fetch SBOM (mocked)
		// - Set SBOM status to succeeded for found architectures
		// - Initialize scan status to queued for found architectures
		// - Cleanup SBOM status for missing architectures
		err = listener.HandleExternalImageSbom(ctx, payload)
		require.NoError(t, err)

		// Verify SBOM status is succeeded
		sbomStatuses = getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1, "Should have single SBOM status")
		assert.Equal(t, "succeeded", sbomStatuses[0].Status)

		// Verify scan status is queued for x86_64
		scanStatuses := getScanStatuses(t, ctx, testDigest)
		require.Len(t, scanStatuses, 1, "Should only have x86_64 scan status")
		assert.Equal(t, "x86_64", scanStatuses[0].Arch)
		assert.Equal(t, "queued", scanStatuses[0].Status)

		// Step 4: Run scan (simulates scan worker)
		// This will:
		// - Set scan status to running
		// - Execute scan (mocked)
		// - Set scan status to succeeded
		err = listener.RunScanForDigest(ctx, testDigest)
		require.NoError(t, err)

		// Verify final scan state is succeeded
		scanStatuses = getScanStatuses(t, ctx, testDigest)
		require.Len(t, scanStatuses, 1)
		scanStatus := scanStatuses[0]
		assert.Equal(t, "succeeded", scanStatus.Status)
		assert.NotNil(t, scanStatus.ScanCompletedAt, "Scan completed timestamp should be set")
		assert.NotEmpty(t, scanStatus.ParsedResults, "Parsed results should be set")
		storedParsedResults := *scanStatus.ParsedResults

		// A later status-only update must preserve the last successful counts.
		err = externalimage.SetExternalImageScanStatus(ctx, externalimage.SetExternalImageScanStatusParams{
			Digest:            testDigest,
			Arch:              "x86_64",
			Status:            externalimage.ScanStatusFailed,
			ScanStatusMessage: "test failure after successful scan",
		})
		require.NoError(t, err)

		scanStatuses = getScanStatuses(t, ctx, testDigest)
		require.Len(t, scanStatuses, 1)
		require.NotNil(t, scanStatuses[0].ParsedResults)
		assert.Equal(t, storedParsedResults, *scanStatuses[0].ParsedResults)

		// Verify SBOM status remains succeeded
		sbomStatuses = getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1)
		assert.Equal(t, "succeeded", sbomStatuses[0].Status)
	})
}

// TestExternalImageScanFailure tests the failure state transition
func TestExternalImageScanFailure(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()

	ctx := context.Background()

	// Setup test database
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	// Apply schema
	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	schemaDir := filepath.Join(projectRoot, "db", "schema", "tables")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, schemaDir, false)
	require.NoError(t, err)

	// Initialize context with database + MinIO object storage
	ctx, minioStorage := setupMinIOOverrides(ctx, t, testDB.ConnStr)
	defer testutil.TeardownMinIO(ctx, t, minioStorage)

	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)
	defer persistence.ClosePool(ctx)

	testDigest := "sha256:test-failure-digest-12345678901234567890123456789012"

	// Mock SBOM fetch
	mockFetchSBOM := func(ctx context.Context, registry string, imageName string, digest string) ([]sbom.SBOMResult, error) {
		return []sbom.SBOMResult{
			{
				Architecture:   "linux/amd64",
				SBOM:           `{"artifacts":[]}`,
				Source:         "syft",
				ImageSizeBytes: 1024000,
				ImageDigest:    "sha256:mockdigest",
			},
		}, nil
	}

	// Mock scan to return error
	mockScanExternalImage := func(ctx context.Context, digest string) (map[string]string, error) {
		return nil, assert.AnError
	}

	t.Run("Scan fails during execution", func(t *testing.T) {
		// Add image and initialize SBOM status
		err := externalimage.AddExternalImage(ctx, "docker.io", "library/nginx", "latest", testDigest, "", "")
		require.NoError(t, err)

		err = externalimage.InitializeSBOMStatusPending(ctx, testDigest)
		require.NoError(t, err)

		// Process SBOM handler
		payload := listenertypes.ExternalImageSbomPayload{
			Digest: testDigest,
		}

		ctx = setupMocks(ctx, mockFetchSBOM, mockScanExternalImage)

		err = listener.HandleExternalImageSbom(ctx, payload)
		require.NoError(t, err)

		// Verify SBOM succeeded and scan is queued
		sbomStatuses := getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1)
		assert.Equal(t, "succeeded", sbomStatuses[0].Status)

		scanStatuses := getScanStatuses(t, ctx, testDigest)
		require.Len(t, scanStatuses, 1)
		assert.Equal(t, "queued", scanStatuses[0].Status)

		// Run scan (will fail)
		err = listener.RunScanForDigest(ctx, testDigest)
		require.NoError(t, err) // Handler swallows scan errors

		// Verify scan failure state
		scanStatuses = getScanStatuses(t, ctx, testDigest)
		require.Len(t, scanStatuses, 1)

		scanStatus := scanStatuses[0]
		assert.Equal(t, "failed", scanStatus.Status)
		assert.NotNil(t, scanStatus.ScanStatusMessage)
		assert.NotNil(t, scanStatus.ScanCompletedAt, "Completion timestamp should be set even on failure")

		// Verify SBOM status remains succeeded
		sbomStatuses = getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1)
		assert.Equal(t, "succeeded", sbomStatuses[0].Status)
	})
}

// TestExternalImageSBOMStatusTransitions tests SBOM status transitions independently
func TestExternalImageSBOMStatusTransitions(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()

	ctx := context.Background()

	// Setup test database
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	// Apply schema
	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	schemaDir := filepath.Join(projectRoot, "db", "schema", "tables")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, schemaDir, false)
	require.NoError(t, err)

	// Apply seed data
	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "external_image", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	// Initialize context with database + MinIO object storage
	ctx, minioStorage := setupMinIOOverrides(ctx, t, testDB.ConnStr)
	defer testutil.TeardownMinIO(ctx, t, minioStorage)

	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)
	defer persistence.ClosePool(ctx)

	testDigest := "sha256:test-sbom-status-digest-12345678901234567890123456789012"

	t.Run("SBOM status progression from pending to succeeded", func(t *testing.T) {
		// Add image
		err := externalimage.AddExternalImage(ctx, "docker.io", "library/nginx", "sbom-test", testDigest, "", "")
		require.NoError(t, err)

		// Step 1: Initialize to pending
		err = externalimage.InitializeSBOMStatusPending(ctx, testDigest)
		require.NoError(t, err)

		// Verify pending status
		sbomStatuses := getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1, "Should create single SBOM status")
		assert.Equal(t, "pending", sbomStatuses[0].Status)
		assert.Nil(t, sbomStatuses[0].StatusMessage)

		// Step 2: Set to generating
		err = externalimage.SetSBOMStatusGenerating(ctx, testDigest)
		require.NoError(t, err)

		// Verify generating status
		sbomStatuses = getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1)
		assert.Equal(t, "generating", sbomStatuses[0].Status)
		assert.Nil(t, sbomStatuses[0].StatusMessage)
		assert.NotNil(t, sbomStatuses[0].StatusUpdatedAt)

		// Step 3: Set to succeeded
		err = externalimage.SetSBOMStatusSucceeded(ctx, testDigest)
		require.NoError(t, err)

		// Verify succeeded status
		sbomStatuses = getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1)
		assert.Equal(t, "succeeded", sbomStatuses[0].Status)
		assert.Nil(t, sbomStatuses[0].StatusMessage)
	})

	t.Run("SBOM status failure path", func(t *testing.T) {
		failureDigest := "sha256:test-sbom-failure-digest-12345678901234567890123456789012"

		// Add image and initialize
		err := externalimage.AddExternalImage(ctx, "docker.io", "library/nginx", "sbom-fail-test", failureDigest, "", "")
		require.NoError(t, err)

		err = externalimage.InitializeSBOMStatusPending(ctx, failureDigest)
		require.NoError(t, err)

		err = externalimage.SetSBOMStatusGenerating(ctx, failureDigest)
		require.NoError(t, err)

		// Set to failed with error message
		errorMsg := "failed to download SBOM from registry: 404 not found"
		err = externalimage.SetSBOMStatusFailed(ctx, failureDigest, errorMsg)
		require.NoError(t, err)

		// Verify failure status
		sbomStatuses := getSBOMStatuses(t, ctx, failureDigest)
		require.Len(t, sbomStatuses, 1, "Should have single SBOM status row")

		status := sbomStatuses[0]
		assert.Equal(t, "failed", status.Status)
		assert.NotNil(t, status.StatusMessage)
		assert.Equal(t, errorMsg, *status.StatusMessage)
	})
}

// TestExternalImageMultiArchWorkflow tests handling multiple architectures
func TestExternalImageMultiArchWorkflow(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()

	ctx := context.Background()

	// Setup test database
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	// Apply schema
	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	schemaDir := filepath.Join(projectRoot, "db", "schema", "tables")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, schemaDir, false)
	require.NoError(t, err)

	// Apply seed data
	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "external_image", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	// Initialize context with database + MinIO object storage
	ctx, minioStorage := setupMinIOOverrides(ctx, t, testDB.ConnStr)
	defer testutil.TeardownMinIO(ctx, t, minioStorage)

	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)
	defer persistence.ClosePool(ctx)

	testDigest := "sha256:test-multiarch-digest-12345678901234567890123456789012"

	// Mock SBOM fetch to return both architectures
	mockFetchSBOM := func(ctx context.Context, registry string, imageName string, digest string) ([]sbom.SBOMResult, error) {
		return []sbom.SBOMResult{
			{
				Architecture:   "linux/amd64",
				SBOM:           `{"artifacts":[]}`,
				Source:         "syft",
				ImageSizeBytes: 1024000,
				ImageDigest:    "sha256:mockdigest-amd64",
			},
			{
				Architecture:   "linux/arm64",
				SBOM:           `{"artifacts":[]}`,
				Source:         "syft",
				ImageSizeBytes: 2048000,
				ImageDigest:    "sha256:mockdigest-arm64",
			},
		}, nil
	}

	// Mock scan to return success for both architectures
	mockScanExternalImage := func(ctx context.Context, digest string) (map[string]string, error) {
		return map[string]string{
			"x86_64":  `{"matches":[],"descriptor":{"name":"grype","version":"0.95.0"}}`,
			"aarch64": `{"matches":[],"descriptor":{"name":"grype","version":"0.95.0"}}`,
		}, nil
	}

	t.Run("Multi-architecture image workflow", func(t *testing.T) {
		// Add image and initialize SBOM status
		err := externalimage.AddExternalImage(ctx, "docker.io", "library/nginx", "latest", testDigest, "", "")
		require.NoError(t, err)

		err = externalimage.InitializeSBOMStatusPending(ctx, testDigest)
		require.NoError(t, err)

		// Verify initial pending SBOM status
		sbomStatuses := getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1)
		assert.Equal(t, "pending", sbomStatuses[0].Status)

		// Process SBOM handler
		payload := listenertypes.ExternalImageSbomPayload{
			Digest: testDigest,
		}

		ctx = setupMocks(ctx, mockFetchSBOM, mockScanExternalImage)

		err = listener.HandleExternalImageSbom(ctx, payload)
		require.NoError(t, err)

		// Verify SBOM status is succeeded
		sbomStatuses = getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1, "Should have single SBOM status")
		assert.Equal(t, "succeeded", sbomStatuses[0].Status)

		// Verify both architectures have queued scan status
		scanStatuses := getScanStatuses(t, ctx, testDigest)
		require.Len(t, scanStatuses, 2, "Should have scan status for both architectures")
		for _, status := range scanStatuses {
			assert.Equal(t, "queued", status.Status)
		}

		// Run scan
		err = listener.RunScanForDigest(ctx, testDigest)
		require.NoError(t, err)

		// Verify both scans succeeded
		scanStatuses = getScanStatuses(t, ctx, testDigest)
		require.Len(t, scanStatuses, 2)
		for _, status := range scanStatuses {
			assert.Equal(t, "succeeded", status.Status)
			assert.NotNil(t, status.ScanCompletedAt)
		}

		// Verify SBOM status remains succeeded
		sbomStatuses = getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1)
		assert.Equal(t, "succeeded", sbomStatuses[0].Status)
	})
}

// TestExternalImageScanBlobUpload verifies that scan results are uploaded
// to object storage (MinIO) as gzip-compressed blobs when
// R2_IMAGE_SCANS_BUCKET_NAME is configured.
func TestExternalImageScanBlobUpload(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()

	ctx := context.Background()

	// Setup test database
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	schemaDir := filepath.Join(projectRoot, "db", "schema", "tables")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, schemaDir, false)
	require.NoError(t, err)

	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "external_image", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	// Initialize context with database + MinIO object storage
	ctx, minioStorage := setupMinIOOverrides(ctx, t, testDB.ConnStr)
	defer testutil.TeardownMinIO(ctx, t, minioStorage)

	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)
	defer persistence.ClosePool(ctx)

	testDigest := "sha256:test-blob-upload-digest-12345678901234567890123456"

	mockFetchSBOM := func(ctx context.Context, registry string, imageName string, digest string) ([]sbom.SBOMResult, error) {
		return []sbom.SBOMResult{
			{
				Architecture:   "linux/amd64",
				SBOM:           `{"artifacts":[],"source":{"type":"image","target":{"imageIndex":0}}}`,
				Source:         "syft",
				ImageSizeBytes: 1024000,
				ImageDigest:    "sha256:mockdigest-x86-64",
			},
		}, nil
	}

	rawScanResult := `{"matches":[],"descriptor":{"name":"grype","version":"0.95.0"}}`
	mockScanExternalImage := func(ctx context.Context, digest string) (map[string]string, error) {
		return map[string]string{
			"x86_64": rawScanResult,
		}, nil
	}

	t.Run("Scan results uploaded to object storage as gzip blobs", func(t *testing.T) {
		// Add image and process SBOM
		err := externalimage.AddExternalImage(ctx, "docker.io", "library/nginx", "latest", testDigest, "", "")
		require.NoError(t, err)

		err = externalimage.InitializeSBOMStatusPending(ctx, testDigest)
		require.NoError(t, err)

		payload := listenertypes.ExternalImageSbomPayload{Digest: testDigest}
		ctx = setupMocks(ctx, mockFetchSBOM, mockScanExternalImage)

		err = listener.HandleExternalImageSbom(ctx, payload)
		require.NoError(t, err)

		// Run scan (uses mock scan function)
		err = listener.RunScanForDigest(ctx, testDigest)
		require.NoError(t, err)

		// Verify scan succeeded in DB
		scanStatuses := getScanStatuses(t, ctx, testDigest)
		require.Len(t, scanStatuses, 1)
		assert.Equal(t, "succeeded", scanStatuses[0].Status)

		// Verify raw_result.json.gz exists in object storage
		rawResultKey := "test-blob-upload-digest-12345678901234567890123456/x86_64/raw_result.json.gz"
		getOutput, err := minioStorage.S3Client.GetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String("image-scans"),
			Key:    aws.String(rawResultKey),
		})
		require.NoError(t, err, "raw_result.json.gz should exist in object storage")
		defer getOutput.Body.Close()

		bodyBytes, err := io.ReadAll(getOutput.Body)
		require.NoError(t, err)

		// Verify the object is gzip-compressed and contains the original scan result
		gzReader, err := gzip.NewReader(bytes.NewReader(bodyBytes))
		require.NoError(t, err, "object should be valid gzip data")
		defer gzReader.Close()

		decompressed, err := io.ReadAll(gzReader)
		require.NoError(t, err)

		assert.Equal(t, rawScanResult, string(decompressed),
			"decompressed raw_result should match the original scan result")

		// Verify parsed_results_details.json.gz exists in object storage
		parsedDetailsKey := "test-blob-upload-digest-12345678901234567890123456/x86_64/parsed_results_details.json.gz"
		getOutput2, err := minioStorage.S3Client.GetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String("image-scans"),
			Key:    aws.String(parsedDetailsKey),
		})
		require.NoError(t, err, "parsed_results_details.json.gz should exist in object storage")
		defer getOutput2.Body.Close()

		bodyBytes2, err := io.ReadAll(getOutput2.Body)
		require.NoError(t, err)

		gzReader2, err := gzip.NewReader(bytes.NewReader(bodyBytes2))
		require.NoError(t, err, "parsed_results_details should be valid gzip data")
		defer gzReader2.Close()

		decompressed2, err := io.ReadAll(gzReader2)
		require.NoError(t, err)
		assert.NotEmpty(t, string(decompressed2), "parsed_results_details should not be empty")
	})
}

// Helper functions

type scanStatusRow struct {
	Digest              string
	Arch                string
	Status              string
	ScanStatusMessage   *string
	CreatedAt           time.Time
	UpdatedAt           *time.Time
	ScanAttemptedAt     *time.Time
	ScanCompletedAt     *time.Time
	ScanStatusUpdatedAt *time.Time
	ParsedResults       *string
}

type sbomStatusRow struct {
	Digest          string
	Status          string
	StatusMessage   *string
	CreatedAt       time.Time
	UpdatedAt       *time.Time
	StatusUpdatedAt *time.Time
}

func getScanStatuses(t *testing.T, ctx context.Context, digest string) []scanStatusRow {
	t.Helper()

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT digest, arch, status, scan_status_message, created_at, updated_at,
		       scan_attempted_at, scan_completed_at, scan_status_updated_at, parsed_results
		FROM external_image_scan
		WHERE digest = $1
		ORDER BY arch
	`

	rows, err := conn.Query(ctx, query, digest)
	require.NoError(t, err)
	defer rows.Close()

	var statuses []scanStatusRow
	for rows.Next() {
		var status scanStatusRow
		err := rows.Scan(
			&status.Digest,
			&status.Arch,
			&status.Status,
			&status.ScanStatusMessage,
			&status.CreatedAt,
			&status.UpdatedAt,
			&status.ScanAttemptedAt,
			&status.ScanCompletedAt,
			&status.ScanStatusUpdatedAt,
			&status.ParsedResults,
		)
		require.NoError(t, err)
		statuses = append(statuses, status)
	}

	return statuses
}

func getSBOMStatuses(t *testing.T, ctx context.Context, digest string) []sbomStatusRow {
	t.Helper()

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT digest, status, status_message, created_at, updated_at, status_updated_at
		FROM external_image_sbom_status
		WHERE digest = $1
	`

	rows, err := conn.Query(ctx, query, digest)
	require.NoError(t, err)
	defer rows.Close()

	var statuses []sbomStatusRow
	for rows.Next() {
		var status sbomStatusRow
		err := rows.Scan(
			&status.Digest,
			&status.Status,
			&status.StatusMessage,
			&status.CreatedAt,
			&status.UpdatedAt,
			&status.StatusUpdatedAt,
		)
		require.NoError(t, err)
		statuses = append(statuses, status)
	}

	return statuses
}

// setupMinIOOverrides returns param overrides for MinIO-based R2 config,
// including a dedicated image-scans bucket. The caller is responsible for
// deferring testutil.TeardownMinIO.
func setupMinIOOverrides(ctx context.Context, t *testing.T, dbConnStr string) (context.Context, *testutil.MinIOStorage) {
	t.Helper()

	minioStorage := testutil.SetupMinIO(ctx, t)

	imageScansBucket := "image-scans"
	_, err := minioStorage.S3Client.CreateBucket(ctx, &s3.CreateBucketInput{
		Bucket: aws.String(imageScansBucket),
	})
	require.NoError(t, err)

	overrides := map[string]string{
		"DB_URI":                     dbConnStr,
		"R2_IMAGE_SCANS_BUCKET_NAME": imageScansBucket,
		"R2_ACCESS_KEY":              minioStorage.AccessKey,
		"R2_SECRET_KEY":              minioStorage.SecretKey,
		"R2_ENDPOINT":                minioStorage.Endpoint,
		"R2_USE_DYNAMIC_FOLDER":      "false",
		"R2_USE_PATH_STYLE":          "true",
	}
	ctx, err = param.Init(param.InitSourceEnvironment, overrides)
	require.NoError(t, err)

	return ctx, minioStorage
}

// Mock helpers

// setupMocks returns a new context with the mock functions injected.
// Each test gets its own context so parallel tests never share mock state.
func setupMocks(ctx context.Context,
	mockFetch func(context.Context, string, string, string) ([]sbom.SBOMResult, error),
	mockScan func(context.Context, string) (map[string]string, error),
) context.Context {
	ctx = listener.WithMockFetchSBOM(ctx, mockFetch)
	ctx = listener.WithMockScanExternalImage(ctx, mockScan)
	return ctx
}
