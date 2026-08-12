package package_dependency_graph_test

import (
	"context"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/buildgraph"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	pkgtestutil "github.com/securebuildhq/securebuild/pkg/testutil"
	"github.com/stretchr/testify/require"
)

func TestConstraintAwarePackageDependencyMap(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	ctx := context.Background()
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	ctx, err := param.Init(param.InitSourceEnvironment, map[string]string{
		"DB_URI": testDB.ConnStr, "PIPELINE_DIR": pkgtestutil.SetupTestPipelineDir(t),
	})
	require.NoError(t, err)
	require.NoError(t, persistence.InitPostgres(ctx))
	defer persistence.ClosePool(ctx)

	now := time.Now().UTC()
	packages := []struct{ id, name string }{
		{"pkg-go-125", "go-1.25"},
		{"pkg-go-126", "go-1.26"},
		{"pkg-unpinned", "schemahero-unpinned"},
		{"pkg-pinned", "schemahero-pinned"},
		{"pkg-exact", "schemahero-exact"},
	}
	for _, pkg := range packages {
		_, err := testDB.Pool.Exec(ctx, `
			INSERT INTO package (id, name, created_at, updated_at, is_delete_protection_enabled, is_deleted)
			VALUES ($1, $2, $3, $3, false, false)
		`, pkg.id, pkg.name, now)
		require.NoError(t, err)
	}

	versions := []struct {
		id, packageID, version string
		release                int
	}{
		{"pv-go-125", "pkg-go-125", "1.25.9", 1},
		{"pv-go-126", "pkg-go-126", "1.26.5", 0},
		{"pv-unpinned-old", "pkg-unpinned", "0.24.0", 0},
		{"pv-unpinned", "pkg-unpinned", "0.25.0", 0},
		{"pv-pinned", "pkg-pinned", "0.25.0", 0},
		{"pv-exact", "pkg-exact", "0.25.0", 0},
	}
	for _, version := range versions {
		_, err := testDB.Pool.Exec(ctx, `
			INSERT INTO package_version
			(id, package_id, version, melange_yaml, created_at, apk_release, has_securebuild_edits, use_root, bootstrap_enabled)
			VALUES ($1, $2, $3, '', $4, $5, false, false, false)
		`, version.id, version.packageID, version.version, now, version.release)
		require.NoError(t, err)
	}

	_, err = testDB.Pool.Exec(ctx, `
		INSERT INTO execution (id, created_at, package_id, package_version_id, version_label, status)
		VALUES ('exec-go-125', $1, 'pkg-go-125', 'pv-go-125', '1.25.9-r1', 'success')
	`, now)
	require.NoError(t, err)

	for _, provide := range []struct{ id, versionID, packageName, spec string }{
		{"provide-go-125", "pv-go-125", "go-1.25", "go=1.25.9-r1"},
		{"provide-go-126", "pv-go-126", "go-1.26", "go=1.26.5-r0"},
	} {
		_, err := testDB.Pool.Exec(ctx, `
			INSERT INTO package_version_provides
			(id, package_version_id, package_name, provides_name, provides_spec, is_subpackage)
			VALUES ($1, $2, $3, 'go', $4, false)
		`, provide.id, provide.versionID, provide.packageName, provide.spec)
		require.NoError(t, err)
	}

	buildDependencies := []struct{ versionID, consumerName, providerID, selector string }{
		{"pv-unpinned-old", "schemahero-unpinned", "pkg-go-125", "go~1.25"},
		{"pv-unpinned", "schemahero-unpinned", "pkg-go-125", "go"},
		{"pv-pinned", "schemahero-pinned", "pkg-go-125", "go~1.25"},
	}
	for _, dependency := range buildDependencies {
		_, err := testDB.Pool.Exec(ctx, `
			INSERT INTO package_version_dependency_buildtime
			(package_version_id, package_name, package_version, package_apk_release,
			 depends_on_package_id, depends_on_package_name, dependency_spec, depends_on_package_is_external)
			SELECT $1, $2, pv.version, pv.apk_release, $3, 'go', $4, false
			FROM package_version pv WHERE pv.id = $1
		`, dependency.versionID, dependency.consumerName, dependency.providerID, dependency.selector)
		require.NoError(t, err)
	}
	_, err = testDB.Pool.Exec(ctx, `
		INSERT INTO package_version_dependency_runtime
		(package_version_id, package_name, package_version, package_apk_release,
		 depends_on_package_id, depends_on_package_name, dependency_spec, depends_on_package_is_external)
		VALUES ('pv-exact', 'schemahero-exact', '0.25.0', 0,
		        'pkg-go-126', 'go', 'go=1.26.5-r0', false)
	`)
	require.NoError(t, err)

	dependencyMap, diagnostics, err := sbpackage.GetConstraintAwarePackageDependencyMap(ctx, "pv-go-126")
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"schemahero-exact", "schemahero-unpinned"}, dependencyMap["go-1.26"])
	require.ElementsMatch(t, []string{"schemahero-pinned"}, dependencyMap["go-1.25"])
	require.NotContains(t, dependencyMap["go-1.25"], "schemahero-unpinned", "historical consumer pin must not create a stale edge")
	require.Equal(t, 3, diagnostics.Dependencies)
	require.Equal(t, 1, diagnostics.Unpinned)
	require.Equal(t, 2, diagnostics.Pinned)
	require.Equal(t, 1, diagnostics.StoredProviderMove)

	nodes, edges := buildgraph.BuildDAG(dependencyMap, "go-1.26")
	require.ElementsMatch(t, []string{"go-1.26", "schemahero-exact", "schemahero-unpinned"}, nodes)
	chain, err := sbpackage.CreateRebuildChain(ctx, "pkg-go-126", stringPointer("pv-go-126"), nodes, edges, "go-1.26")
	require.NoError(t, err)

	var pinnedLinks int
	err = testDB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM rebuild_chain_link rcl
		JOIN package p ON p.id = rcl.package_id
		WHERE rcl.rebuild_chain_id = $1 AND p.name = 'schemahero-pinned'
	`, chain.ID).Scan(&pinnedLinks)
	require.NoError(t, err)
	require.Zero(t, pinnedLinks)

	// Selector migration reconstructs complete selectors without rewriting the
	// existing provider identity columns.
	_, err = testDB.Pool.Exec(ctx, `
		INSERT INTO package (id, name, created_at, updated_at, is_delete_protection_enabled, is_deleted)
		VALUES ('pkg-migrate', 'selector-migrate', $1, $1, false, false)
	`, now)
	require.NoError(t, err)
	melangeYAML := `
package:
  name: selector-migrate
  version: 1.0.0
  epoch: 0
  dependencies:
    runtime:
      - go~1.25
    provides:
      - selector-migrate=${{package.full-version}}
environment:
  contents:
    packages:
      - go~1.25
pipeline:
  - runs: echo test
`
	_, err = sbpackage.ExtractProvidesFromMelangeYAML(ctx, []byte(melangeYAML))
	require.NoError(t, err)
	_, err = testDB.Pool.Exec(ctx, `
		INSERT INTO package_version
		(id, package_id, version, melange_yaml, created_at, apk_release, has_securebuild_edits, use_root, bootstrap_enabled)
		VALUES ('pv-migrate', 'pkg-migrate', '1.0.0', $1, $2, 0, false, false, false)
	`, melangeYAML, now)
	require.NoError(t, err)
	for _, table := range []string{"package_version_dependency_runtime", "package_version_dependency_buildtime"} {
		_, err = testDB.Pool.Exec(ctx, `INSERT INTO `+table+`
			(package_version_id, package_name, package_version, package_apk_release,
			 depends_on_package_id, depends_on_package_name, depends_on_package_is_external)
			VALUES ('pv-migrate', 'selector-migrate', '1.0.0', 0, 'pkg-go-125', 'go', false)`)
		require.NoError(t, err)
	}
	_, err = testDB.Pool.Exec(ctx, `
		INSERT INTO package_version_provides
		(id, package_version_id, package_name, provides_name, is_subpackage)
		VALUES ('provide-migrate', 'pv-migrate', 'selector-migrate', 'selector-migrate', false)
	`)
	require.NoError(t, err)

	dryRun, err := sbpackage.BackfillPackageSelectors(ctx, sbpackage.SelectorMigrationOptions{DryRun: true})
	require.NoError(t, err)
	require.EqualValues(t, 2, dryRun.DependencyRows)
	require.EqualValues(t, 1, dryRun.ProvidesRows)
	var selector *string
	require.NoError(t, testDB.Pool.QueryRow(ctx, `SELECT dependency_spec FROM package_version_dependency_buildtime WHERE package_version_id = 'pv-migrate'`).Scan(&selector))
	require.Nil(t, selector)

	migrated, err := sbpackage.BackfillPackageSelectors(ctx, sbpackage.SelectorMigrationOptions{})
	require.NoError(t, err)
	require.EqualValues(t, 2, migrated.DependencyRows)
	require.EqualValues(t, 1, migrated.ProvidesRows)
	var dependencySpec, providesSpec string
	require.NoError(t, testDB.Pool.QueryRow(ctx, `SELECT dependency_spec FROM package_version_dependency_buildtime WHERE package_version_id = 'pv-migrate'`).Scan(&dependencySpec))
	require.NoError(t, testDB.Pool.QueryRow(ctx, `SELECT provides_spec FROM package_version_provides WHERE package_version_id = 'pv-migrate'`).Scan(&providesSpec))
	require.Equal(t, "go~1.25", dependencySpec)
	require.Equal(t, "selector-migrate=1.0.0-r0", providesSpec)
}

func stringPointer(value string) *string { return &value }
