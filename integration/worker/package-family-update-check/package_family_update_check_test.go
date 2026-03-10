package package_family_update_check

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/releasemonitor"
	pkgtestutil "github.com/securebuildhq/securebuild/pkg/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPackageFamilyUpdateCheckToBuildPackageChain(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()

	// Setup database
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	// Apply seed data using SchemaHero
	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "package-family-update-check", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	// Create mock HTTP server for release-monitor API
	releaseMonitorServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify it's the correct endpoint
		assert.Contains(t, r.URL.Path, "/api/v2/versions/")
		assert.Equal(t, r.URL.Query().Get("project_id"), "1227")

		// Return mock response with version 1.24.10 (newer than 1.24.9)
		response := map[string]interface{}{
			"latest_version": "1.24.13",
			"stable_versions": []string{
				"1.24.13",
				"1.24.12",
				"1.24.11",
				"1.24.10",
				"1.24.9",
				"1.24.8",
			},
			"versions": []string{
				"1.24.13",
				"1.24.12",
				"1.24.11",
				"1.24.10",
				"1.24.9",
				"1.24.8",
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer releaseMonitorServer.Close()

	// Initialize param with test overrides
	overrides := map[string]string{
		"DB_URI":       testDB.ConnStr,
		"PIPELINE_DIR": pkgtestutil.SetupTestPipelineDir(t),
	}
	ctx, err = param.Init(param.InitSourceEnvironment, overrides)
	require.NoError(t, err)

	// Set custom base URL in context for release-monitor API (for testing)
	ctx = releasemonitor.WithTestParameters(ctx, releasemonitor.TestParameterValues{
		BaseURL: releaseMonitorServer.URL,
	})

	// Initialize persistence
	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)
	defer persistence.ClosePool(ctx)

	// Create listener and start only package_family_update_check handler
	l := listener.NewListener(ctx)
	listener.StartPackageFamilyUpdateCheckListener(ctx, l)

	// Register test handler for build_package_chain to capture events (don't process them)
	// Buffer size of 10 to handle multiple versions (1.24.10, 1.24.11, 1.24.12, 1.24.13)
	buildPackageChainReceived := make(chan string, 10)
	l.AddHandler(ctx, "build_package_chain", 1, time.Second*10, func(ctx context.Context, notification *pgconn.Notification) error {
		// Just capture the event, don't process it
		t.Logf("Received build_package_chain event: %s", notification.Payload)
		buildPackageChainReceived <- notification.Payload
		return nil
	})

	listenerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	go l.Start(listenerCtx)
	defer l.Stop(listenerCtx)

	// Give listener time to start
	time.Sleep(1 * time.Second)

	// Get the package family ID from seed data
	var packageFamilyID string
	err = testDB.Pool.QueryRow(ctx, "SELECT id FROM package_family WHERE name = 'go'").Scan(&packageFamilyID)
	require.NoError(t, err)

	// Trigger processing by enqueuing work
	updateCheckPayload := listener.PackageFamilyUpdateCheckPayload{
		PackageFamilyID: packageFamilyID,
	}
	payloadBytes, err := json.Marshal(updateCheckPayload)
	require.NoError(t, err)

	err = persistence.EnqueueWork(ctx, "package_family_update_check", payloadBytes)
	require.NoError(t, err)

	// Get the go-1.24 package ID for building expected events
	var goPackageID string
	err = testDB.Pool.QueryRow(ctx, "SELECT id FROM package WHERE name = 'go-1.24'").Scan(&goPackageID)
	require.NoError(t, err)

	// The handler processes ALL new versions found (1.24.10, 1.24.11, 1.24.12, 1.24.13)
	// and queues a build_package_chain event for EACH one. This is correct behavior.
	// Wait for package versions to be created, then build expected event list
	time.Sleep(2 * time.Second)

	// Build expected list of build_package_chain events
	// We expect one event per new version: 1.24.10, 1.24.11, 1.24.12, 1.24.13
	expectedVersions := []string{"1.24.10", "1.24.11", "1.24.12", "1.24.13"}
	expectedEvents := make(map[string]listener.BuildPackageChainPayload)

	for _, version := range expectedVersions {
		var versionID string
		err = testDB.Pool.QueryRow(ctx, `
			SELECT id 
			FROM package_version 
			WHERE package_id = $1 AND version = $2
			ORDER BY created_at DESC
			LIMIT 1
		`, goPackageID, version).Scan(&versionID)
		require.NoError(t, err, "Version %s should have been created", version)

		expectedEvents[versionID] = listener.BuildPackageChainPayload{
			PackageID:        goPackageID,
			PackageVersionID: versionID,
		}
		t.Logf("Expected build_package_chain event for version %s: packageId=%s, packageVersionId=%s", version, goPackageID, versionID)
	}

	// Collect all received events - terminate when expected count is reached
	t.Logf("Waiting for build_package_chain events (expecting 4: one per version 1.24.10-1.24.13)")

	var receivedPayloads []listener.BuildPackageChainPayload
	timeout := time.After(10 * time.Second)
	expectedCount := len(expectedVersions)

	// Collect events until we have the expected count, or timeout
	for len(receivedPayloads) < expectedCount {
		select {
		case payloadStr := <-buildPackageChainReceived:
			var payload listener.BuildPackageChainPayload
			err = json.Unmarshal([]byte(payloadStr), &payload)
			require.NoError(t, err, "Failed to unmarshal received event")
			receivedPayloads = append(receivedPayloads, payload)
			t.Logf("Received build_package_chain event %d: packageId=%s, packageVersionId=%s", len(receivedPayloads), payload.PackageID, payload.PackageVersionID)
		case <-timeout:
			// Timeout only if we didn't receive enough events
			require.Failf(t, "Timeout waiting for build_package_chain events", "Expected %d events, received %d", expectedCount, len(receivedPayloads))
		}
	}

	// Verify we received the expected number of events
	require.Equal(t, expectedCount, len(receivedPayloads),
		"Expected %d build_package_chain events (one per version), got %d", expectedCount, len(receivedPayloads))

	// Build received events map for comparison
	receivedEvents := make(map[string]listener.BuildPackageChainPayload)
	for _, payload := range receivedPayloads {
		receivedEvents[payload.PackageVersionID] = payload
	}

	// Compare expected vs received events
	for versionID, expectedEvent := range expectedEvents {
		receivedEvent, found := receivedEvents[versionID]
		require.True(t, found, "Expected build_package_chain event for packageVersionId %s was not received", versionID)
		assert.Equal(t, expectedEvent.PackageID, receivedEvent.PackageID, "Event for versionId %s should have correct packageId", versionID)
		assert.Equal(t, expectedEvent.PackageVersionID, receivedEvent.PackageVersionID, "Event should have correct packageVersionId")
	}

	// Verify all received events are for the correct package
	for _, payload := range receivedPayloads {
		assert.Equal(t, goPackageID, payload.PackageID, "All events should be for go-1.24 package")
		assert.NotEmpty(t, payload.PackageVersionID, "All events should have a package version ID")
	}

	// Verify package family last_check_at was updated
	var lastCheckAt time.Time
	err = testDB.Pool.QueryRow(ctx, "SELECT last_check_at FROM package_family WHERE id = $1", packageFamilyID).Scan(&lastCheckAt)
	require.NoError(t, err)
	assert.WithinDuration(t, time.Now(), lastCheckAt, 10*time.Second, "last_check_at should be recent")
}
