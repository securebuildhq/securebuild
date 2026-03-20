package build_image_with_vm_assigned

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/image"
	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	pkgtestutil "github.com/securebuildhq/securebuild/pkg/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockAPKOOperations implements image.APKOOperations for testing
type mockAPKOOperations struct{}

func (m *mockAPKOOperations) ListPackages(ctx context.Context, apkoYAML string) ([]imagetypes.APKPackageVersion, error) {
	// Return mock packages that would be resolved from the test APKO YAML
	return []imagetypes.APKPackageVersion{
		{
			Name:               "kubectl",
			VersionWithRelease: "1.33.4-r0",
			Version:            "1.33.4",
			Release:            "r0",
			PinnedVersion:      "1.33.4",
			Major:              "1",
			Minor:              "33",
			Patch:              "4",
		},
	}, nil
}

// TestHandleBuildImageWithVMAssigned tests the handleBuildImageWithVMAssigned handler
// with mocked SSH server and apko to verify the full flow including image test retrieval.
func TestHandleBuildImageWithVMAssigned(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	// Setup database
	testDB := testutil.SetupTestDatabase(ctx, t)
	t.Cleanup(func() {
		persistence.ClosePool(ctx)
		testutil.TeardownTestDatabase(ctx, t, testDB)
	})

	// Apply seed data
	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "build-image-with-vm-assigned", "testdata")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	// Initialize param with test overrides
	overrides := map[string]string{
		"DB_URI":                testDB.ConnStr,
		"PIPELINE_DIR":          pkgtestutil.SetupTestPipelineDir(t),
		"REGISTRY_IMAGE_PREFIX": "registry.test.local/test-app",
		"OCI_IMAGE_PREFIX":      "",
		"REGISTRY_USERNAME":     "serviceaccount",
		"REGISTRY_PASSWORD":     "test-token",
	}
	ctx, err = param.Init(param.InitSourceEnvironment, overrides)
	require.NoError(t, err)

	// Initialize persistence
	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)

	// Test data IDs (must match seed data)
	buildID := "imgbuild01234567890abcdef1234"
	vmID := "vm001234567890abcdef12345678"
	apkoID := "apko01234567890abcdef123456"
	apkoVersionID := "apkov01234567890abcdef12345"

	// Install mock apko operations to avoid calling real apko binary
	image.SetAPKOOperations(&mockAPKOOperations{})
	t.Cleanup(func() {
		image.ResetAPKOOperations()
	})

	// Start mock SSH server on a random port to avoid conflicts with parallel tests
	sshPort, sshCleanup := pkgtestutil.MockSSHServer(t)
	t.Cleanup(sshCleanup)

	// Update machine_pool with the dynamically assigned SSH port
	_, err = testDB.Pool.Exec(ctx, "UPDATE machine_pool SET port = $1 WHERE id = $2", sshPort, vmID)
	require.NoError(t, err)

	// Happy path test: handler processes build from start to finish
	t.Run("handler processes build successfully", func(t *testing.T) {
		// Reset build status to pending for this test
		_, err := testDB.Pool.Exec(ctx, "UPDATE image_build SET status = 'pending' WHERE id = $1", buildID)
		require.NoError(t, err)

		payload := listener.BuildImageWithVMAssignedPayload{
			BuildID: buildID,
			VMID:    vmID,
		}
		payloadBytes, err := json.Marshal(payload)
		require.NoError(t, err)

		// Call handler - with mocked SSH and ListPackagesForAPKO, it should complete successfully
		err = listener.HandleBuildImageWithVMAssigned(ctx, string(payloadBytes))

		// Handler should return nil on success (build job started in background)
		require.NoError(t, err)

		// Verify the build status was updated to "building"
		build, err := image.GetImageBuildByID(ctx, buildID)
		require.NoError(t, err)
		assert.Equal(t, string(imagetypes.ImageBuildStatusBuilding), build.Status,
			"Build status should be 'building', got: %s", build.Status)

		// Verify image test YAML was retrievable during the flow
		testYAML, err := image.GetImageTest(ctx, apkoID, apkoVersionID)
		require.NoError(t, err)
		require.NotEmpty(t, testYAML)
		assert.Contains(t, testYAML, "bitnami/kubectl:1.33.4")
	})

	// Error case: handler fails gracefully with non-existent VM
	t.Run("handler fails with non-existent VM", func(t *testing.T) {
		payload := listener.BuildImageWithVMAssignedPayload{
			BuildID: buildID,
			VMID:    "non-existent-vm-id",
		}
		payloadBytes, err := json.Marshal(payload)
		require.NoError(t, err)

		err = listener.HandleBuildImageWithVMAssigned(ctx, string(payloadBytes))
		require.Error(t, err)
		// Should be a non-retryable error since VM doesn't exist
		var nonRetryable *listener.NonRetryableError
		assert.ErrorAs(t, err, &nonRetryable)
	})

	// Error case: handler fails with invalid payload
	t.Run("handler fails with invalid payload", func(t *testing.T) {
		err := listener.HandleBuildImageWithVMAssigned(ctx, "invalid json")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to unmarshal payload")
	})

	// Error case: handler fails with non-existent build
	t.Run("handler fails with non-existent build", func(t *testing.T) {
		payload := listener.BuildImageWithVMAssignedPayload{
			BuildID: "non-existent-build-id",
			VMID:    vmID,
		}
		payloadBytes, err := json.Marshal(payload)
		require.NoError(t, err)

		err = listener.HandleBuildImageWithVMAssigned(ctx, string(payloadBytes))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to get image build")
	})
}
