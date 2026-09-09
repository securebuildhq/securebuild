package worker_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/anchore/syft/syft/artifact"
	"github.com/anchore/syft/syft/pkg"
	"github.com/anchore/syft/syft/sbom"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/security"
	"github.com/stretchr/testify/require"
)

func TestDependencyRemovalFeed(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL")
	}
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, db)
	ctx, err := param.Init(param.InitSourceEnvironment, map[string]string{"DB_URI": db.ConnStr})
	require.NoError(t, err)
	require.NoError(t, persistence.InitPostgres(ctx))
	defer persistence.ClosePool(ctx)
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	owner := pkg.Package{Name: "replicated-sdk-1.19", Version: "1.19.11-r0", Type: pkg.ApkPkg}
	owner.SetID()
	s := &sbom.SBOM{Artifacts: sbom.Artifacts{Packages: pkg.NewCollection(owner)}}
	for _, tc := range []struct {
		name, installed string
		fixes           []string
	}{
		{"removed", "", []string{"1.0.1"}},
		{"removed-no-upstream-fix", "", nil},
		{"still-vulnerable", "1.0.0", []string{"1.0.1"}},
		{"present-no-upstream-fix", "1.0.0", nil},
		{"upgraded", "1.0.1", []string{"1.0.1"}},
	} {
		_, err := conn.Exec(ctx, `INSERT INTO cve_package_fix
		  (id,cve_id,package_name,artifact_name,artifact_type,artifact_fixed_version,severity,namespace,created_at,updated_at)
		  VALUES ($1,$1,$2,$1,'go-module',$3,'High','github:go',NOW(),NOW())`, tc.name, owner.Name, tc.fixes)
		require.NoError(t, err)
		if tc.installed != "" {
			dep := pkg.Package{Name: tc.name, Version: tc.installed, Type: pkg.GoModulePkg}
			dep.SetID()
			s.Artifacts.Packages.Add(dep)
			s.Relationships = append(s.Relationships, artifact.Relationship{From: owner, To: dep, Type: artifact.OwnershipByFileOverlapRelationship})
		}
	}
	// One SBOM is sufficient; repeating the scan must not duplicate fixed versions.
	for range 2 {
		require.NoError(t, security.UpdatePackageFixVersions(ctx, s, owner))
	}
	for _, id := range []string{"removed", "removed-no-upstream-fix", "upgraded", "still-vulnerable", "present-no-upstream-fix"} {
		var fixes []string
		require.NoError(t, conn.QueryRow(ctx, `SELECT package_fixed_version FROM cve_package_fix WHERE id=$1`, id).Scan(&fixes))
		if id == "still-vulnerable" || id == "present-no-upstream-fix" {
			require.Empty(t, fixes, id)
		} else {
			require.Equal(t, []string{owner.Version}, fixes, id)
		}
	}
	raw, err := security.GenerateSecDBFeed(ctx)
	require.NoError(t, err)
	var feed security.AlpineSecDB
	require.NoError(t, json.Unmarshal([]byte(raw), &feed))
	require.Len(t, feed.Packages, 1)
	require.ElementsMatch(t, []string{"removed", "removed-no-upstream-fix", "upgraded"}, feed.Packages[0].Pkg.SecFixes[owner.Version])
	require.NotContains(t, feed.Packages[0].Pkg.SecFixes["0"], "removed-no-upstream-fix")
}
