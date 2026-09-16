package worker_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/buildpriority"
	"github.com/securebuildhq/securebuild/pkg/buildqueue"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

func TestRebuildChainVersionPriority(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL in Docker and SchemaHero")
	}
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, db)
	ctx, err := param.Init(param.InitSourceEnvironment, map[string]string{"DB_URI": db.ConnStr})
	require.NoError(t, err)
	require.NoError(t, persistence.InitPostgres(ctx))
	defer persistence.ClosePool(ctx)

	// Omit the melange epoch deliberately: each ready link records a failed
	// execution, letting us observe admission order without provisioning any VMs.
	root, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, db.ConnStr,
		filepath.Join(root, "integration/worker/buildqueue/testdata/priority-seed-data"), true))
	require.NoError(t, buildpriority.Backfill(ctx, db.Pool))
	require.NoError(t, buildqueue.ProcessRebuildChains(ctx))
	rows, err := db.Pool.Query(ctx, `SELECT cause_id, status FROM execution ORDER BY created_at`)
	require.NoError(t, err)
	defer rows.Close()
	var links []string
	for rows.Next() {
		var link, status string
		require.NoError(t, rows.Scan(&link, &status))
		require.Equal(t, "failed", status)
		links = append(links, link)
	}
	require.NoError(t, rows.Err())
	require.Equal(t, []string{"z-new", "a-old"}, links, "newer ready versions first; blocked versions must wait")
}
