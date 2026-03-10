package worker_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/listener"
	pkglib "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	pkgtestutil "github.com/securebuildhq/securebuild/pkg/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreatePackageHandler(t *testing.T) {
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

	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "create_package", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	// Initialize param with test overrides (NO MORE t.Setenv!)
	overrides := map[string]string{
		"DB_URI":       testDB.ConnStr,
		"PIPELINE_DIR": pkgtestutil.SetupTestPipelineDir(t),
	}
	ctx, err = param.Init(param.InitSourceEnvironment, overrides)
	require.NoError(t, err)

	// Initialize persistence
	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)
	defer persistence.ClosePool(ctx)

	// Create listener and start only create_package handler
	l := listener.NewListener(ctx)
	listener.StartCreatePackageListener(ctx, l)

	// Register test listener for build_package to verify event was sent
	buildPackageReceived := make(chan string, 1)
	l.AddHandler(ctx, "build_package", 1, time.Second*10, func(ctx context.Context, notification *pgconn.Notification) error {
		buildPackageReceived <- notification.Payload
		return nil
	})

	listenerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	go l.Start(listenerCtx)
	defer l.Stop(listenerCtx)

	// Give listener time to start
	time.Sleep(1 * time.Second)

	// Trigger processing by enqueuing work
	createPackagePayload := listener.CreatePackagePayload{
		ID: "test-create-pkg-1", // matches seed data
	}
	payloadBytes, err := json.Marshal(createPackagePayload)
	require.NoError(t, err)

	err = persistence.EnqueueWork(ctx, "create_package", payloadBytes)
	require.NoError(t, err)

	// Wait for build_package event (timeout 10 seconds)
	var buildPackagePayload string
	select {
	case buildPackagePayload = <-buildPackageReceived:
	// Success - event received
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for build_package event")
	}

	// Assert: build_package event was received with correct payload
	require.NotEmpty(t, buildPackagePayload)

	var buildPayload listener.BuildPackagePayload
	err = json.Unmarshal([]byte(buildPackagePayload), &buildPayload)
	require.NoError(t, err)
	assert.Equal(t, "pkg-test-123", buildPayload.PackageID)
	assert.NotEmpty(t, buildPayload.PackageVersionID)
	assert.NotEmpty(t, buildPayload.Cause)

	// Assert: package record was created
	pkg, err := pkglib.GetPackage(ctx, buildPayload.PackageID)
	require.NoError(t, err)
	assert.Equal(t, "test-package", pkg.Name)

	// Assert: package_version record was created
	pkgVersion, err := pkglib.GetPackageVersion(ctx, buildPayload.PackageVersionID)
	require.NoError(t, err)
	assert.Equal(t, "1.0.0", pkgVersion.Version)

	// Assert: create_package record was deleted
	createPackage, err := pkglib.GetCreatePackage(ctx, "test-create-pkg-1")
	require.Error(t, err)
	assert.ErrorIs(t, err, pgx.ErrNoRows)
	assert.Nil(t, createPackage)
}
