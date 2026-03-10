package worker_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/apk"
	"github.com/securebuildhq/securebuild/pkg/listener"
	pkglib "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	pkgtestutil "github.com/securebuildhq/securebuild/pkg/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRemovePackageHandler(t *testing.T) {
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

	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "remove_package", "testdata", "seed-data")
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

	// Create listener and start only remove_package handler
	l := listener.NewListener(ctx)
	listener.StartRemovePackageListener(ctx, l)

	listenerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	go l.Start(listenerCtx)
	defer l.Stop(listenerCtx)

	// Give listener time to start
	time.Sleep(1 * time.Second)

	// Trigger processing by enqueuing work
	removePackagePayload := listener.RemovePackageRequest{
		PackageID: "pkg-remove-test-1",
	}
	payloadBytes, err := json.Marshal(removePackagePayload)
	require.NoError(t, err)

	err = persistence.EnqueueWork(ctx, "remove_package", payloadBytes)
	require.NoError(t, err)

	// Wait for packages to be deleted
	assert.Eventually(t, func() bool {
		_, err := pkglib.GetPackage(ctx, "pkg-remove-test-1")
		return err != nil && errors.Is(err, pkglib.ErrPackageNotFound)
	}, 2*time.Second, 1*time.Second, "Timeout waiting for packages to be deleted")

	// Assert: parent package was deleted
	pkg, err := pkglib.GetPackage(ctx, "pkg-remove-test-1")
	require.Error(t, err)
	assert.ErrorIs(t, err, pkglib.ErrPackageNotFound)
	assert.Nil(t, pkg)

	// Assert: subpackage was deleted
	subpkg, err := pkglib.GetPackage(ctx, "pkg-remove-test-sub-1")
	require.Error(t, err)
	assert.ErrorIs(t, err, pkglib.ErrPackageNotFound)
	assert.Nil(t, subpkg)

	// Assert: parent package versions were deleted
	pkgVersion1, err := pkglib.GetPackageVersion(ctx, "pkgver-remove-test-1")
	require.Error(t, err)
	assert.ErrorIs(t, err, pgx.ErrNoRows)
	assert.Nil(t, pkgVersion1)

	pkgVersion2, err := pkglib.GetPackageVersion(ctx, "pkgver-remove-test-2")
	require.Error(t, err)
	assert.ErrorIs(t, err, pgx.ErrNoRows)
	assert.Nil(t, pkgVersion2)

	// Assert: subpackage version was deleted
	subPkgVersion, err := pkglib.GetPackageVersion(ctx, "pkgver-remove-test-sub-1")
	require.Error(t, err)
	assert.ErrorIs(t, err, pgx.ErrNoRows)
	assert.Nil(t, subPkgVersion)

	// Assert: is_withdrawn flag is true in apk_catalog for all APK files
	// Check parent package APK entries
	catalog1, err := apk.GetCatalogAPK(ctx, "remove-test-parent-1.0.0-r0.apk", "x86_64")
	require.NoError(t, err)
	assert.True(t, catalog1.IsWithdrawn, "Parent package v1.0.0 should be withdrawn")

	catalog2, err := apk.GetCatalogAPK(ctx, "remove-test-parent-1.1.0-r0.apk", "x86_64")
	require.NoError(t, err)
	assert.True(t, catalog2.IsWithdrawn, "Parent package v1.1.0 should be withdrawn")

	// Check subpackage APK entry
	catalogSub, err := apk.GetCatalogAPK(ctx, "remove-test-subpackage-1.0.0-r0.apk", "x86_64")
	require.NoError(t, err)
	assert.True(t, catalogSub.IsWithdrawn, "Subpackage should be withdrawn")
}
