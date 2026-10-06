package worker_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExternalImageSBOMPlatformStatusDashboardIndexes(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()

	ctx := context.Background()
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, testDB.ConnStr,
		filepath.Join(projectRoot, "db", "schema", "tables"), false))

	_, err = testDB.Pool.Exec(ctx, `
		INSERT INTO external_image_sbom_platform_status
			(digest, arch, status, created_at, updated_at, status_updated_at)
		SELECT
			'sha256:index-plan-' || series,
			CASE WHEN series % 2 = 0 THEN 'x86_64' ELSE 'aarch64' END,
			CASE series % 100
				WHEN 0 THEN 'pending'
				WHEN 1 THEN 'generating'
				WHEN 2 THEN 'failed'
				ELSE 'succeeded'
			END,
			NOW() - (series || ' minutes')::interval,
			NOW() - (series || ' minutes')::interval,
			NOW() - (series || ' minutes')::interval
		FROM generate_series(1, 10000) AS series
	`)
	require.NoError(t, err)
	_, err = testDB.Pool.Exec(ctx, `ANALYZE external_image_sbom_platform_status`)
	require.NoError(t, err)
	_, err = testDB.Pool.Exec(ctx, `
		INSERT INTO external_image_sbom_platform_status
			(digest, arch, status, created_at, updated_at, status_updated_at)
		VALUES
			('sha256:stable-platform-order', 'x86_64', 'pending', NOW(), NOW(), NOW()),
			('sha256:stable-platform-order', 'aarch64', 'pending', NOW(), NOW(), NOW())
	`)
	require.NoError(t, err)

	conn, err := testDB.Pool.Acquire(ctx)
	require.NoError(t, err)
	defer conn.Release()

	t.Run("time filter can combine both timestamp indexes", func(t *testing.T) {
		plan := explainPlan(t, ctx, conn.Conn(), `
			SELECT digest
			FROM external_image_sbom_platform_status
			WHERE created_at > NOW() - INTERVAL '1 hour'
			   OR status_updated_at > NOW() - INTERVAL '1 hour'
		`)

		assert.Contains(t, plan, "external_image_sbom_platform_status_created_at_idx")
		assert.Contains(t, plan, "external_image_sbom_platform_status_status_updated_at_idx")
	})

	t.Run("status filter can use the dashboard listing index", func(t *testing.T) {
		plan := explainPlan(t, ctx, conn.Conn(), `
			SELECT digest, arch, status, updated_at
			FROM external_image_sbom_platform_status
			WHERE status = 'failed'
			ORDER BY
				CASE status
					WHEN 'generating' THEN 0
					WHEN 'pending' THEN 1
					WHEN 'failed' THEN 2
					ELSE 3
				END,
				updated_at DESC NULLS LAST,
				digest,
				arch
			LIMIT 50
		`)

		assert.Contains(t, plan, "external_image_sbom_platform_status_status_updated_idx")
	})

	t.Run("platform breaks otherwise identical pagination ties", func(t *testing.T) {
		rows, err := conn.Query(ctx, `
			SELECT arch
			FROM external_image_sbom_platform_status
			WHERE digest = 'sha256:stable-platform-order'
			ORDER BY
				CASE status
					WHEN 'generating' THEN 0
					WHEN 'pending' THEN 1
					WHEN 'failed' THEN 2
					ELSE 3
				END,
				updated_at DESC NULLS LAST,
				digest,
				arch
		`)
		require.NoError(t, err)
		defer rows.Close()

		var arches []string
		for rows.Next() {
			var arch string
			require.NoError(t, rows.Scan(&arch))
			arches = append(arches, arch)
		}
		require.NoError(t, rows.Err())
		assert.Equal(t, []string{"aarch64", "x86_64"}, arches)
	})
}

func explainPlan(t *testing.T, ctx context.Context, conn *pgx.Conn, query string) string {
	t.Helper()
	rows, err := conn.Query(ctx, "EXPLAIN (COSTS OFF) "+query)
	require.NoError(t, err)
	defer rows.Close()

	var lines []string
	for rows.Next() {
		var line string
		require.NoError(t, rows.Scan(&line))
		lines = append(lines, line)
	}
	require.NoError(t, rows.Err())
	return strings.Join(lines, "\n")
}
