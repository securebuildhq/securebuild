package pipeline

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/pipeline"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPackagePipeline tests the full pipeline lifecycle: get, sync, and delete
func TestPackagePipeline(t *testing.T) {
	t.Parallel()

	setup := setupPipelineTest(t)
	defer setup.teardown(t)

	// Test 1: Get pipeline from database
	fetchedPipeline, err := pipeline.GetPipeline(setup.Ctx, pipeline.TypePackage, "test/smoke-binary")
	require.NoError(t, err, "Failed to get pipeline from seed data")

	// Verify ID format from seed data (32 hex characters from randomBytes(16))
	assert.Equal(t, 32, len(fetchedPipeline.ID), "ID should be 32 hex characters")
	assert.Regexp(t, "^[a-f0-9]{32}$", fetchedPipeline.ID, "ID should be 32 lowercase hex characters")

	// Verify core fields from seed data
	assert.Equal(t, "test/smoke-binary", fetchedPipeline.Path)
	assert.Contains(t, fetchedPipeline.YAMLContent, "name: smoke-binary")
	assert.Contains(t, fetchedPipeline.YAMLContent, "apk info")
	assert.Equal(t, "Test pipeline for smoke testing binary packages", fetchedPipeline.Description)
	assert.NotZero(t, fetchedPipeline.CreatedAt)
	assert.NotZero(t, fetchedPipeline.UpdatedAt)

	// Test 2: Sync pipeline to directory
	err = pipeline.SyncPipelineToDirectory(setup.Ctx, fetchedPipeline)
	require.NoError(t, err, "Failed to sync pipeline to directory")

	// Get the actual pipeline directory (includes packages/ subdirectory for TypePackage)
	pipelineDir, err := pipeline.GetPipelineDir(setup.Ctx, pipeline.TypePackage)
	require.NoError(t, err, "Failed to get pipeline directory")

	expectedFile := filepath.Join(pipelineDir, "test", "smoke-binary.yaml")
	assert.FileExists(t, expectedFile, "Pipeline file should exist after sync")

	// Read and verify content
	content, err := os.ReadFile(expectedFile)
	require.NoError(t, err)
	assert.Contains(t, string(content), "name: smoke-binary")
	assert.Contains(t, string(content), "apk info")

	// Test 3: Delete pipeline from directory
	err = pipeline.DeletePipelineFromDirectory(setup.Ctx, pipeline.TypePackage, "test/smoke-binary")
	require.NoError(t, err, "Failed to delete pipeline from directory")

	assert.NoFileExists(t, expectedFile, "Pipeline file should not exist after deletion")

	// Test 4: Error case - non-existent pipeline
	_, err = pipeline.GetPipeline(setup.Ctx, pipeline.TypePackage, "nonexistent/pipeline")
	assert.Error(t, err, "Should return error for non-existent pipeline")
	assert.Contains(t, err.Error(), "pipeline not found")
}

// TestReservedPipeline tests the reserved pipeline checking functionality.
// Pre-create a minimal reserved_pipelines.txt so the test passes when GitHub
// is unavailable (e.g. CI rate limit). LoadReservedPipelines will use this
// cache when the GitHub fetch fails.
func TestReservedPipeline(t *testing.T) {
	setup := setupPipelineTest(t)
	defer setup.teardown(t)

	// Ensure cache fallback exists so test passes without GitHub (e.g. in CI)
	pipelineDir, err := pipeline.GetPipelineDir(setup.Ctx, pipeline.TypePackage)
	require.NoError(t, err)
	cachePath := filepath.Join(pipelineDir, "reserved_pipelines.txt")
	// Minimal list including go/bump so assertions below pass
	cacheContent := "# Reserved melange pipelines (test fixture)\ngo/bump\n"
	require.NoError(t, os.WriteFile(cachePath, []byte(cacheContent), 0o644))

	err = pipeline.LoadReservedPipelines(setup.Ctx, logger.GetLogger())
	require.NoError(t, err)

	content, err := os.ReadFile(filepath.Join(pipelineDir, "reserved_pipelines.txt"))
	require.NoError(t, err)
	fmt.Println(string(content))

	assert.True(t, pipeline.IsReservedPipeline("go/bump"), "go/bump should be reserved")
	assert.False(t, pipeline.IsReservedPipeline("my-custom-pipeline"), "my-custom-pipeline should not be reserved")
	assert.False(t, pipeline.IsReservedPipeline("test/smoke-binary"), "test/smoke-binary should not be reserved")
}
