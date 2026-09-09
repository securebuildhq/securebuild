package worker_test

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/anchore/syft/syft/format/syftjson"
	"github.com/anchore/syft/syft/pkg"
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
	cves := []string{"CVE-2026-84303", "CVE-2026-84304", "CVE-2026-84445", "GHSA-hrxh-6v49-42gf", "CVE-no-upstream-fix"}
	for _, cve := range cves {
		fixes := []string{"1.83.1"}
		if cve == "CVE-no-upstream-fix" {
			fixes = nil
		}
		_, err = conn.Exec(ctx, `INSERT INTO cve_package_fix
   (id,cve_id,package_name,artifact_name,artifact_type,artifact_fixed_version,severity,namespace,created_at,updated_at)
   VALUES ($1,$1,'replicated-sdk-1.19','google.golang.org/grpc','go-module',$2,'Unknown','github:go',NOW(),NOW())`, cve, fixes)
		require.NoError(t, err)
	}
	var scans []security.PackageFixScan
	var target pkg.Package
	for i, arch := range []string{"amd64", "arm64"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "pkg", "security", "test-data", "removed-go-dependency-"+arch+".json"))
		require.NoError(t, err)
		s, _, _, err := syftjson.NewFormatDecoder().Decode(strings.NewReader(string(raw)))
		require.NoError(t, err)
		scans = append(scans, security.PackageFixScan{Architecture: []string{"x86_64", "aarch64"}[i], SBOM: s, SHA256: fmt.Sprintf("%x", sha256.Sum256(raw))})
		for p := range s.Artifacts.Packages.Enumerate() {
			if p.Type == pkg.ApkPkg {
				target = p
			}
		}
	}
	// Missing architecture cannot record a fixed boundary.
	require.Error(t, security.UpdatePackageFixVersions(ctx, scans[:1], target, "image_build:incomplete"))
	var n int
	require.NoError(t, conn.QueryRow(ctx, `SELECT COUNT(*) FROM cve_package_fix WHERE package_fixed_version IS NOT NULL`).Scan(&n))
	require.Zero(t, n)

	require.NoError(t, security.UpdatePackageFixVersions(ctx, scans, target, "image_build:sdk-11911"))
	// Repeat the same build to verify idempotency.
	require.NoError(t, security.UpdatePackageFixVersions(ctx, scans, target, "image_build:sdk-11911"))
	for _, cve := range cves {
		var fixes []string
		var raw []byte
		require.NoError(t, conn.QueryRow(ctx, `SELECT package_fixed_version,package_fix_evidence FROM cve_package_fix WHERE id=$1`, cve).Scan(&fixes, &raw))
		require.Equal(t, []string{"1.19.11-r0"}, fixes)
		var evidence map[string]struct {
			Reason  string            `json:"reason"`
			Source  string            `json:"source"`
			Digests map[string]string `json:"sbom_sha256"`
		}
		require.NoError(t, json.Unmarshal(raw, &evidence))
		require.Equal(t, "dependency_removed", evidence["1.19.11-r0"].Reason)
		require.Equal(t, "image_build:sdk-11911", evidence["1.19.11-r0"].Source)
		require.Len(t, evidence["1.19.11-r0"].Digests, 2)
	}
	rawFeed, err := security.GenerateSecDBFeed(ctx)
	require.NoError(t, err)
	var feed security.AlpineSecDB
	require.NoError(t, json.Unmarshal([]byte(rawFeed), &feed))
	require.Len(t, feed.Packages, 1)
	require.ElementsMatch(t, cves, feed.Packages[0].Pkg.SecFixes["1.19.11-r0"])
	require.NotContains(t, feed.Packages[0].Pkg.SecFixes, "None")
	require.NotContains(t, feed.Packages[0].Pkg.SecFixes, "0")

	// A previously observed regression must also block an older build finishing
	// later. Seed the observation as another transaction/build would have recorded it.
	_, err = conn.Exec(ctx, `UPDATE cve_package_fix SET package_fix_evidence=package_fix_evidence ||
  '{"1.19.12-r0":{"reason":"affected","source":"image_build:regression"}}'::jsonb`)
	require.NoError(t, err)
	require.NoError(t, security.UpdatePackageFixVersions(ctx, scans, target, "image_build:old-retry"))
	for _, cve := range cves {
		var fixes []string
		require.NoError(t, conn.QueryRow(ctx, `SELECT package_fixed_version FROM cve_package_fix WHERE id=$1`, cve).Scan(&fixes))
		require.Empty(t, fixes)
	}
	rawFeed, err = security.GenerateSecDBFeed(ctx)
	require.NoError(t, err)
	feed = security.AlpineSecDB{}
	require.NoError(t, json.Unmarshal([]byte(rawFeed), &feed))
	require.ElementsMatch(t, cves, feed.Packages[0].Pkg.SecFixes["None"])
	require.NotContains(t, feed.Packages[0].Pkg.SecFixes, "0")
	require.NotContains(t, feed.Packages[0].Pkg.SecFixes, "1.19.11-r0")
}
