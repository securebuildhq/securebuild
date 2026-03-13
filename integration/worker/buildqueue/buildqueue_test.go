package worker_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/buildqueue"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	pkgtestutil "github.com/securebuildhq/securebuild/pkg/testutil"
	"github.com/stretchr/testify/require"
)

// TestProcessRebuildChains runs ProcessRebuildChains; both links are processed in one pass:
// one package queues a build (VM assignment from machine_pool), the other fails
// CreateNewRelease and gets a failed execution recorded.
//
// Seed data includes 2 machine_pool rows per architecture so assignVMsWithTimeout
// can assign both instantly without blocking.
func TestProcessRebuildChains(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()

	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "buildqueue", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	overrides := map[string]string{
		"DB_URI":       testDB.ConnStr,
		"PIPELINE_DIR": pkgtestutil.SetupTestPipelineDir(t),
	}
	ctx, err = param.Init(param.InitSourceEnvironment, overrides)
	require.NoError(t, err)

	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)
	defer persistence.ClosePool(ctx)

	// One pass processes all ready links (both); one queues a build, one records failed execution.
	err = buildqueue.ProcessRebuildChains(ctx)
	require.NoError(t, err)

	// Both links should have an execution with the expected statuses.
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var failStatus, okStatus string
	err = conn.QueryRow(ctx, `SELECT status FROM execution WHERE cause_id = 'rcl-bq-fail'`).Scan(&failStatus)
	require.NoError(t, err)
	require.Equal(t, "failed", failStatus, "rcl-bq-fail (CreateNewRelease failed) should have execution status failed")

	err = conn.QueryRow(ctx, `SELECT status FROM execution WHERE cause_id = 'rcl-bq-ok'`).Scan(&okStatus)
	require.NoError(t, err)
	require.Equal(t, "queued", okStatus, "rcl-bq-ok (HandleBuildPackage succeeded) should have execution status queued")
}
