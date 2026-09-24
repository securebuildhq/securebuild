package worker_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
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
		require.NotNil(t, scanStatus.ScanCompletedAt, "Scan completed timestamp should be set")
		successfulScanCompletedAt := *scanStatus.ScanCompletedAt
		assert.NotEmpty(t, scanStatus.ParsedResults, "Parsed results should be set")
		storedParsedResults := *scanStatus.ParsedResults
		successfulFreshness := getSBOMLastSecurityScannedAt(t, ctx, testDigest)
		require.NotNil(t, successfulFreshness["x86_64"])
		assert.Equal(t, successfulScanCompletedAt, *successfulFreshness["x86_64"],
			"Result metadata and successful freshness should publish with the same timestamp")

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
		assert.Equal(t, "failed", scanStatuses[0].Status)
		require.NotNil(t, scanStatuses[0].ScanCompletedAt)
		assert.Equal(t, successfulScanCompletedAt, *scanStatuses[0].ScanCompletedAt,
			"A failed refresh must preserve the last successful completion time")
		require.NotNil(t, scanStatuses[0].ParsedResults)
		assert.Equal(t, storedParsedResults, *scanStatuses[0].ParsedResults)

		// A later success replaces the failed attempt state and advances freshness.
		err = listener.RunScanForDigest(ctx, testDigest)
		require.NoError(t, err)
		scanStatuses = getScanStatuses(t, ctx, testDigest)
		require.Len(t, scanStatuses, 1)
		assert.Equal(t, "succeeded", scanStatuses[0].Status)
		assert.Nil(t, scanStatuses[0].ScanStatusMessage)
		require.NotNil(t, scanStatuses[0].ScanCompletedAt)
		assert.True(t, scanStatuses[0].ScanCompletedAt.After(successfulScanCompletedAt),
			"A recovered scan should advance the successful completion time")

		// Verify SBOM status remains succeeded
		sbomStatuses = getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1)
		assert.Equal(t, "succeeded", sbomStatuses[0].Status)
	})

	t.Run("Successful metadata rolls back when freshness cannot be published", func(t *testing.T) {
		missingSBOMDigest := "sha256:test-missing-sbom-1234567890123456789012345678901234"
		generationID := "missing-sbom-generation"
		require.NoError(t, externalimage.SetScanStatusRunning(ctx, missingSBOMDigest, "x86_64", generationID))
		err := externalimage.SetExternalImageScanStatus(ctx, externalimage.SetExternalImageScanStatusParams{
			Digest:               missingSBOMDigest,
			Arch:                 "x86_64",
			ScanGenerationID:     generationID,
			Status:               externalimage.ScanStatusSucceeded,
			ParsedResults:        `{"total":0}`,
			ParsedResultsDetails: `{"counts":{"total":0}}`,
			RawResult:            `{"matches":[]}`,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "expected 1 SBOM row")

		conn := persistence.MustGetPooledPostgresSession(ctx)
		defer conn.Release()
		var status string
		var selectedGeneration, parsedResults *string
		require.NoError(t, conn.QueryRow(ctx,
			`SELECT status, selected_scan_generation_id, parsed_results
			 FROM external_image_scan WHERE digest = $1 AND arch = 'x86_64'`,
			missingSBOMDigest).Scan(&status, &selectedGeneration, &parsedResults))
		assert.Equal(t, "running", status, "successful status should roll back with the failed freshness update")
		assert.Nil(t, selectedGeneration, "candidate must not become selected")
		assert.Nil(t, parsedResults, "compact counts must not publish")
	})
}

func TestMigrateScanStatusColumn(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, filepath.Join(projectRoot, "db", "schema", "tables"), false)
	require.NoError(t, err)

	ctx, err = param.Init(param.InitSourceEnvironment, map[string]string{"DB_URI": testDB.ConnStr})
	require.NoError(t, err)
	require.NoError(t, persistence.InitPostgres(ctx))
	defer persistence.ClosePool(ctx)

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	_, err = conn.Exec(ctx, `
		INSERT INTO external_image_scan
		  (digest, arch, parsed_results, created_at, status, scan_status_message, scan_status_updated_at)
		VALUES
		  ('legacy-success', 'x86_64', '{"total":1}', NOW(), 'queued', NULL, NULL),
		  ('legacy-failure', 'x86_64', '', NOW(), 'queued', 'scan failed', NULL),
		  ('modern-rescan', 'x86_64', '{"total":1}', NOW(), 'queued', NULL, NOW()),
		  ('false-success', 'x86_64', '', NOW(), 'succeeded', 'scan failed', NOW())
	`)
	require.NoError(t, err)

	require.NoError(t, externalimage.MigrateScanStatusColumn(ctx))

	rows, err := conn.Query(ctx, `
		SELECT digest, status
		FROM external_image_scan
		WHERE digest = ANY($1::text[])
	`, []string{"legacy-success", "legacy-failure", "modern-rescan", "false-success"})
	require.NoError(t, err)
	defer rows.Close()

	statuses := map[string]string{}
	for rows.Next() {
		var digest, status string
		require.NoError(t, rows.Scan(&digest, &status))
		statuses[digest] = status
	}
	require.NoError(t, rows.Err())

	assert.Equal(t, "succeeded", statuses["legacy-success"])
	assert.Equal(t, "failed", statuses["legacy-failure"])
	assert.Equal(t, "queued", statuses["modern-rescan"])
	assert.Equal(t, "failed", statuses["false-success"])
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
		assert.Nil(t, scanStatus.ParsedResults, "A failed scan without prior results should store NULL counts")
		assert.Nil(t, scanStatus.ScanCompletedAt, "A first-attempt failure has no successful completion time")

		// Verify SBOM status remains succeeded
		sbomStatuses = getSBOMStatuses(t, ctx, testDigest)
		require.Len(t, sbomStatuses, 1)
		assert.Equal(t, "succeeded", sbomStatuses[0].Status)
	})
}

// TestExternalImagePartialArchitectureFailure verifies that a refresh can
// publish one architecture while retaining the previous usable result and
// freshness for an architecture that failed.
func TestExternalImagePartialArchitectureFailure(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()

	ctx := context.Background()
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, testDB.ConnStr,
		filepath.Join(projectRoot, "db", "schema", "tables"), false))

	ctx, minioStorage := setupMinIOOverrides(ctx, t, testDB.ConnStr)
	defer testutil.TeardownMinIO(ctx, t, minioStorage)
	require.NoError(t, persistence.InitPostgres(ctx))
	defer persistence.ClosePool(ctx)

	digest := "sha256:test-partial-refresh-12345678901234567890123456789012"
	require.NoError(t, externalimage.AddExternalImage(ctx, "docker.io", "library/multiarch", "latest", digest, "", ""))
	require.NoError(t, externalimage.InitializeSBOMStatusPending(ctx, digest))

	mockFetchSBOM := func(context.Context, string, string, string) ([]sbom.SBOMResult, error) {
		return []sbom.SBOMResult{
			{Architecture: "linux/amd64", SBOM: `{"artifacts":[]}`, Source: "syft", ImageDigest: digest},
			{Architecture: "linux/arm64", SBOM: `{"artifacts":[]}`, Source: "syft", ImageDigest: digest},
		}, nil
	}
	allSuccessful := func(context.Context, string) (map[string]string, error) {
		return map[string]string{
			"x86_64":  `{"matches":[],"descriptor":{"name":"grype","version":"0.95.0"}}`,
			"aarch64": `{"matches":[],"descriptor":{"name":"grype","version":"0.95.0"}}`,
		}, nil
	}

	ctx = setupMocks(ctx, mockFetchSBOM, allSuccessful)
	require.NoError(t, listener.HandleExternalImageSbom(ctx, listenertypes.ExternalImageSbomPayload{Digest: digest}))
	require.NoError(t, listener.RunScanForDigest(ctx, digest))

	initialRows := getScanStatuses(t, ctx, digest)
	require.Len(t, initialRows, 2)
	initialByArch := map[string]scanStatusRow{}
	for _, row := range initialRows {
		initialByArch[row.Arch] = row
		require.Equal(t, "succeeded", row.Status)
		require.NotNil(t, row.ScanCompletedAt)
		require.NotNil(t, row.ParsedResults)
	}
	initialFreshness := getSBOMLastSecurityScannedAt(t, ctx, digest)
	require.NotNil(t, initialFreshness["x86_64"])
	require.NotNil(t, initialFreshness["aarch64"])

	partialSuccess := func(context.Context, string) (map[string]string, error) {
		return map[string]string{
			"x86_64": `{"matches":[],"descriptor":{"name":"grype","version":"0.96.0"}}`,
		}, nil
	}
	ctx = listener.WithMockScanExternalImage(ctx, partialSuccess)
	require.NoError(t, listener.RunScanForDigest(ctx, digest))

	refreshedRows := getScanStatuses(t, ctx, digest)
	require.Len(t, refreshedRows, 2)
	refreshedByArch := map[string]scanStatusRow{}
	for _, row := range refreshedRows {
		refreshedByArch[row.Arch] = row
	}

	failedArch := refreshedByArch["aarch64"]
	assert.Equal(t, "failed", failedArch.Status)
	require.NotNil(t, failedArch.ScanStatusMessage)
	require.NotNil(t, failedArch.ScanCompletedAt)
	assert.Equal(t, *initialByArch["aarch64"].ScanCompletedAt, *failedArch.ScanCompletedAt)
	require.NotNil(t, failedArch.ParsedResults)
	assert.Equal(t, *initialByArch["aarch64"].ParsedResults, *failedArch.ParsedResults)

	successfulArch := refreshedByArch["x86_64"]
	assert.Equal(t, "succeeded", successfulArch.Status)
	require.NotNil(t, successfulArch.ScanCompletedAt)
	assert.True(t, successfulArch.ScanCompletedAt.After(*initialByArch["x86_64"].ScanCompletedAt))

	refreshedFreshness := getSBOMLastSecurityScannedAt(t, ctx, digest)
	require.NotNil(t, refreshedFreshness["aarch64"])
	assert.Equal(t, *initialFreshness["aarch64"], *refreshedFreshness["aarch64"])
	require.NotNil(t, refreshedFreshness["x86_64"])
	assert.True(t, refreshedFreshness["x86_64"].After(*initialFreshness["x86_64"]))
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

		conn := persistence.MustGetPooledPostgresSession(ctx)
		defer conn.Release()
		var selectedGeneration, rawResultKey, parsedDetailsKey string
		require.NoError(t, conn.QueryRow(ctx, `
			SELECT scan.selected_scan_generation_id,
			       generation.raw_object_key,
			       generation.details_object_key
			FROM external_image_scan scan
			JOIN external_image_scan_generation generation
			  ON generation.generation_id = scan.selected_scan_generation_id
			 AND generation.digest = scan.digest
			 AND generation.arch = scan.arch
			WHERE scan.digest = $1 AND scan.arch = 'x86_64'
		`, testDigest).Scan(&selectedGeneration, &rawResultKey, &parsedDetailsKey))
		assert.NotEmpty(t, selectedGeneration)

		// Verify generation-specific raw_result.json.gz exists in object storage
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

		// Verify generation-specific parsed_results_details.json.gz exists in object storage
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

func TestExternalImageScanGenerationPublication(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()

	ctx := context.Background()
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, testDB.ConnStr, filepath.Join(projectRoot, "db", "schema", "tables"), false))

	ctx, minioStorage := setupMinIOOverrides(ctx, t, testDB.ConnStr)
	defer testutil.TeardownMinIO(ctx, t, minioStorage)
	require.NoError(t, persistence.InitPostgres(ctx))
	defer persistence.ClosePool(ctx)

	const arch = "x86_64"
	digest := "sha256:generation-publication-123456789012345678901234567890"
	conn := persistence.MustGetPooledPostgresSession(ctx)
	_, err = conn.Exec(ctx, `
		INSERT INTO external_image_sbom (digest, arch, source, created_at, is_in_object_store)
		VALUES ($1, $2, 'syft', NOW(), false)
	`, digest, arch)
	conn.Release()
	require.NoError(t, err)

	type selectedResult struct {
		generationID string
		counts       string
		raw          string
		details      string
		available    bool
	}
	fetchObject := func(key string) string {
		output, err := minioStorage.S3Client.GetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String("image-scans"),
			Key:    aws.String(key),
		})
		require.NoError(t, err)
		defer output.Body.Close()
		compressed, err := io.ReadAll(output.Body)
		require.NoError(t, err)
		reader, err := gzip.NewReader(bytes.NewReader(compressed))
		require.NoError(t, err)
		defer reader.Close()
		payload, err := io.ReadAll(reader)
		require.NoError(t, err)
		return string(payload)
	}
	readSelected := func(targetDigest string) selectedResult {
		conn := persistence.MustGetPooledPostgresSession(ctx)
		defer conn.Release()
		var result selectedResult
		var generationID, counts, rawKey, detailsKey *string
		require.NoError(t, conn.QueryRow(ctx, `
			SELECT scan.selected_scan_generation_id, scan.parsed_results,
			       scan.is_in_object_store,
			       generation.raw_object_key, generation.details_object_key
			FROM external_image_scan scan
			LEFT JOIN external_image_scan_generation generation
			  ON generation.generation_id = scan.selected_scan_generation_id
			 AND generation.digest = scan.digest
			 AND generation.arch = scan.arch
			WHERE scan.digest = $1 AND scan.arch = $2
		`, targetDigest, arch).Scan(&generationID, &counts, &result.available, &rawKey, &detailsKey))
		if generationID != nil {
			result.generationID = *generationID
		}
		if counts != nil {
			result.counts = *counts
		}
		if rawKey != nil {
			result.raw = fetchObject(*rawKey)
		}
		if detailsKey != nil {
			result.details = fetchObject(*detailsKey)
		}
		return result
	}
	publish := func(callCtx context.Context, targetDigest, generationID, marker string, count int) error {
		matches := make([]map[string]any, count)
		for i := range matches {
			matches[i] = map[string]any{"id": fmt.Sprintf("%s-%d", marker, i)}
		}
		rawJSON, err := json.Marshal(map[string]any{"marker": marker, "matches": matches})
		if err != nil {
			return err
		}
		return externalimage.SetExternalImageScanStatus(callCtx, externalimage.SetExternalImageScanStatusParams{
			Digest:               targetDigest,
			Arch:                 arch,
			ScanGenerationID:     generationID,
			Status:               externalimage.ScanStatusSucceeded,
			ParsedResults:        fmt.Sprintf(`{"total":%d}`, count),
			ParsedResultsDetails: fmt.Sprintf(`{"marker":%q,"counts":{"total":%d}}`, marker, count),
			RawResult:            string(rawJSON),
		})
	}
	assertGenerationConsistent := func(result selectedResult, marker string, count int) {
		var compact struct {
			Total int `json:"total"`
		}
		var raw struct {
			Marker  string           `json:"marker"`
			Matches []map[string]any `json:"matches"`
		}
		var details struct {
			Marker string `json:"marker"`
			Counts struct {
				Total int `json:"total"`
			} `json:"counts"`
		}
		require.NoError(t, json.Unmarshal([]byte(result.counts), &compact))
		require.NoError(t, json.Unmarshal([]byte(result.raw), &raw))
		require.NoError(t, json.Unmarshal([]byte(result.details), &details))
		assert.Equal(t, marker, raw.Marker)
		assert.Equal(t, marker, details.Marker)
		assert.Equal(t, count, len(raw.Matches), "raw-derived count must match the selected generation")
		assert.Equal(t, count, details.Counts.Total, "detailed count must match the selected generation")
		assert.Equal(t, count, compact.Total, "PostgreSQL count must match the selected generation")
	}

	require.NoError(t, externalimage.SetScanStatusRunning(ctx, digest, arch, "generation-a"))
	require.NoError(t, publish(ctx, digest, "generation-a", "A", 1))
	resultA := readSelected(digest)
	require.Equal(t, "generation-a", resultA.generationID)
	assertGenerationConsistent(resultA, "A", 1)
	require.True(t, resultA.available)

	failureStages := []externalimage.ScanPublicationFailureStage{
		externalimage.ScanPublicationFailureBeforeRawUpload,
		externalimage.ScanPublicationFailureBetweenUploads,
		externalimage.ScanPublicationFailureValidation,
		externalimage.ScanPublicationFailureSelection,
	}
	for _, stage := range failureStages {
		t.Run(string(stage), func(t *testing.T) {
			generationID := "generation-b-" + string(stage)
			require.NoError(t, externalimage.SetScanStatusRunning(ctx, digest, arch, generationID))
			failedCtx := externalimage.WithScanPublicationFailure(ctx, stage)
			require.Error(t, publish(failedCtx, digest, generationID, "B", 2))

			current := readSelected(digest)
			assert.Equal(t, resultA.generationID, current.generationID)
			assert.JSONEq(t, resultA.counts, current.counts)
			assert.JSONEq(t, resultA.raw, current.raw)
			assert.JSONEq(t, resultA.details, current.details)
			assert.True(t, current.available)
		})
	}

	firstDigest := "sha256:first-generation-publication-123456789012345678901234567"
	conn = persistence.MustGetPooledPostgresSession(ctx)
	_, err = conn.Exec(ctx, `
		INSERT INTO external_image_sbom (digest, arch, source, created_at, is_in_object_store)
		VALUES ($1, $2, 'syft', NOW(), false)
	`, firstDigest, arch)
	conn.Release()
	require.NoError(t, err)
	require.NoError(t, externalimage.SetScanStatusRunning(ctx, firstDigest, arch, "first-generation"))
	failedCtx := externalimage.WithScanPublicationFailure(ctx, externalimage.ScanPublicationFailureBetweenUploads)
	require.Error(t, publish(failedCtx, firstDigest, "first-generation", "FIRST", 3))
	firstResult := readSelected(firstDigest)
	assert.Empty(t, firstResult.generationID)
	assert.Empty(t, firstResult.counts)
	assert.Empty(t, firstResult.raw)
	assert.Empty(t, firstResult.details)
	assert.False(t, firstResult.available)

	require.NoError(t, externalimage.SetScanStatusRunning(ctx, digest, arch, "generation-old"))
	selectionFailureCtx := externalimage.WithScanPublicationFailure(ctx, externalimage.ScanPublicationFailureSelection)
	require.Error(t, publish(selectionFailureCtx, digest, "generation-old", "OLD", 4))
	require.NoError(t, externalimage.SetScanStatusRunning(ctx, digest, arch, "generation-new"))
	require.NoError(t, publish(ctx, digest, "generation-new", "NEW", 5))
	require.ErrorIs(t, publish(ctx, digest, "generation-old", "OLD", 4), externalimage.ErrStaleScanGeneration)
	current := readSelected(digest)
	assert.Equal(t, "generation-new", current.generationID)
	assertGenerationConsistent(current, "NEW", 5)

	// Even corrupted cleanup metadata cannot make the selected generation eligible.
	conn = persistence.MustGetPooledPostgresSession(ctx)
	_, err = conn.Exec(ctx, `
		UPDATE external_image_scan_generation
		SET state = 'failed', cleanup_after = NOW() - INTERVAL '1 minute'
		WHERE generation_id = 'generation-new' AND digest = $1 AND arch = $2
	`, digest, arch)
	conn.Release()
	require.NoError(t, err)
	require.NoError(t, externalimage.CleanupExternalImageScanCandidates(ctx, 100))
	current = readSelected(digest)
	assert.Equal(t, "generation-new", current.generationID)
	assertGenerationConsistent(current, "NEW", 5)

	t.Run("pre-generation builder result is adopted and published", func(t *testing.T) {
		legacyDigest := "sha256:legacy-builder-generation-123456789012345678901234567890"
		conn := persistence.MustGetPooledPostgresSession(ctx)
		_, err := conn.Exec(ctx, `
			INSERT INTO external_image_sbom (digest, arch, source, created_at, is_in_object_store)
			VALUES ($1, $2, 'syft', NOW(), false)
		`, legacyDigest, arch)
		require.NoError(t, err)
		_, err = conn.Exec(ctx, `
			INSERT INTO external_image_scan (
				digest, arch, created_at, status, updated_at,
				scan_attempted_at, scan_status_updated_at, is_in_object_store
			)
			VALUES ($1, $2, NOW(), 'running', NOW(), NOW(), NOW(), false)
		`, legacyDigest, arch)
		conn.Release()
		require.NoError(t, err)

		const legacyGeneration = "legacy-derived-generation"
		require.NoError(t, externalimage.AdoptLegacyScanGeneration(ctx, legacyDigest, []string{arch}, legacyGeneration))
		require.NoError(t, publish(ctx, legacyDigest, legacyGeneration, "LEGACY", 6))

		selected := readSelected(legacyDigest)
		assert.Equal(t, legacyGeneration, selected.generationID)
		assertGenerationConsistent(selected, "LEGACY", 6)
	})

	t.Run("claim creates missing rows and remains all or nothing", func(t *testing.T) {
		missingRowsDigest := "sha256:claim-missing-rows-123456789012345678901234567890123"
		claimed, err := externalimage.ClaimScanGeneration(
			ctx,
			missingRowsDigest,
			[]string{"x86_64", "aarch64"},
			"all-architectures",
			time.Hour,
		)
		require.NoError(t, err)
		require.True(t, claimed)

		conn := persistence.MustGetPooledPostgresSession(ctx)
		var claimedRows int
		require.NoError(t, conn.QueryRow(ctx, `
			SELECT COUNT(*)
			FROM external_image_scan
			WHERE digest = $1
			  AND status = 'running'
			  AND current_scan_generation_id = 'all-architectures'
		`, missingRowsDigest).Scan(&claimedRows))
		conn.Release()
		assert.Equal(t, 2, claimedRows)

		partialDigest := "sha256:claim-partial-rollback-123456789012345678901234567890"
		require.NoError(t, externalimage.InitializeScanStatusQueued(ctx, partialDigest, "x86_64"))
		claimed, err = externalimage.ClaimScanGeneration(ctx, partialDigest, []string{"aarch64"}, "active-generation", time.Hour)
		require.NoError(t, err)
		require.True(t, claimed)

		claimed, err = externalimage.ClaimScanGeneration(
			ctx,
			partialDigest,
			[]string{"x86_64", "aarch64"},
			"must-rollback",
			time.Hour,
		)
		require.NoError(t, err)
		assert.False(t, claimed)

		conn = persistence.MustGetPooledPostgresSession(ctx)
		rows, err := conn.Query(ctx, `
			SELECT arch, status, COALESCE(current_scan_generation_id, '')
			FROM external_image_scan
			WHERE digest = $1
			ORDER BY arch
		`, partialDigest)
		require.NoError(t, err)
		states := make(map[string][2]string)
		for rows.Next() {
			var rowArch, status, generation string
			require.NoError(t, rows.Scan(&rowArch, &status, &generation))
			states[rowArch] = [2]string{status, generation}
		}
		require.NoError(t, rows.Err())
		rows.Close()
		conn.Release()
		assert.Equal(t, [2]string{"running", "active-generation"}, states["aarch64"])
		assert.Equal(t, [2]string{"queued", ""}, states["x86_64"])
	})

	t.Run("missing-builder recovery cannot requeue a newer generation", func(t *testing.T) {
		recoveryDigest := "sha256:recovery-generation-fence-123456789012345678901234567890"
		claimed, err := externalimage.ClaimScanGeneration(ctx, recoveryDigest, []string{arch}, "new-generation", time.Hour)
		require.NoError(t, err)
		require.True(t, claimed)

		affected, err := externalimage.RequeueScanGeneration(
			ctx,
			recoveryDigest,
			[]string{arch},
			"old-generation",
			"old builder disappeared",
		)
		require.NoError(t, err)
		assert.Zero(t, affected)
		err = externalimage.SetExternalImageScanStatus(ctx, externalimage.SetExternalImageScanStatusParams{
			Digest:            recoveryDigest,
			Arch:              arch,
			Status:            externalimage.ScanStatusQueued,
			ScanStatusMessage: "generationless recovery",
		})
		require.ErrorIs(t, err, externalimage.ErrStaleScanGeneration)

		conn := persistence.MustGetPooledPostgresSession(ctx)
		var status, generation string
		require.NoError(t, conn.QueryRow(ctx, `
			SELECT status, current_scan_generation_id
			FROM external_image_scan
			WHERE digest = $1 AND arch = $2
		`, recoveryDigest, arch).Scan(&status, &generation))
		conn.Release()
		assert.Equal(t, "running", status)
		assert.Equal(t, "new-generation", generation)

		err = externalimage.AdoptLegacyScanGeneration(ctx, recoveryDigest, []string{arch}, "legacy-generation")
		require.ErrorIs(t, err, externalimage.ErrStaleScanGeneration)

		affected, err = externalimage.RequeueScanGeneration(
			ctx,
			recoveryDigest,
			[]string{arch},
			"new-generation",
			"matching builder disappeared",
		)
		require.NoError(t, err)
		assert.EqualValues(t, 1, affected)

		conn = persistence.MustGetPooledPostgresSession(ctx)
		require.NoError(t, conn.QueryRow(ctx, `
			SELECT status, COALESCE(current_scan_generation_id, '')
			FROM external_image_scan
			WHERE digest = $1 AND arch = $2
		`, recoveryDigest, arch).Scan(&status, &generation))
		conn.Release()
		assert.Equal(t, "queued", status)
		assert.Empty(t, generation)
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

func getSBOMLastSecurityScannedAt(t *testing.T, ctx context.Context, digest string) map[string]*time.Time {
	t.Helper()

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	rows, err := conn.Query(ctx, `
		SELECT arch, last_security_scanned_at
		FROM external_image_sbom
		WHERE digest = $1
	`, digest)
	require.NoError(t, err)
	defer rows.Close()

	result := map[string]*time.Time{}
	for rows.Next() {
		var arch string
		var lastScannedAt *time.Time
		require.NoError(t, rows.Scan(&arch, &lastScannedAt))
		result[arch] = lastScannedAt
	}
	require.NoError(t, rows.Err())
	return result
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
