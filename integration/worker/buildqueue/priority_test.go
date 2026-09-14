package worker_test

import (
	"context"
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
	_, err = db.Pool.Exec(ctx, `
		INSERT INTO package (id, name, created_at)
		VALUES ('old', 'go-1.9', NOW()), ('new', 'go-1.10', NOW()), ('blocked', 'go-1.11', NOW());
		INSERT INTO package_family (id, name, created_at, updated_at, check_for_updates_at)
		VALUES ('go', 'go', NOW(), NOW(), NOW());
		INSERT INTO package_family_package (package_family_id, package_id, version_major, version_minor, created_at)
		VALUES ('go', 'old', 1, 9, NOW()), ('go', 'new', 1, 10, NOW()), ('go', 'blocked', 1, 11, NOW());
		INSERT INTO package_version (id, package_id, version, apk_release, created_at, melange_yaml)
		VALUES ('old-version', 'old', '1.9.0', 99, NOW(), E'package:\n  name: go-1.9\n  version: 1.9.0'),
		       ('new-version', 'new', '1.10.0', 0, NOW() - INTERVAL '1 day', E'package:\n  name: go-1.10\n  version: 1.10.0'),
		       ('blocked-version', 'blocked', '1.11.0', 0, NOW(), E'package:\n  name: go-1.11\n  version: 1.11.0');
		INSERT INTO rebuild_chain (id, package_id, created_at, chain_name)
		VALUES ('chain', 'old', NOW(), 'test-version-priority');
		INSERT INTO rebuild_chain_link (link_id, rebuild_chain_id, package_id)
		VALUES ('a-old', 'chain', 'old'), ('z-new', 'chain', 'new'), ('blocked', 'chain', 'blocked');
		INSERT INTO rebuild_chain_dependency (link_id, dependency_id) VALUES ('blocked', 'z-new');
	`)
	require.NoError(t, err)
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
