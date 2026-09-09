//go:build integration

package listener

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

func TestCustomPackagePublicationWaitsAndTimesOut(t *testing.T) {
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	t.Cleanup(func() { testutil.TeardownTestDatabase(ctx, t, db) })

	var stage atomic.Int32
	parentOnly := publicationTestIndex(t, "example")
	allOutputs := publicationTestIndex(t, "example", "example-cli")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if stage.Load() == 3 {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		index := parentOnly
		if stage.Load() == 2 || (stage.Load() == 1 && r.URL.Path == "/aarch64/APKINDEX.tar.gz") {
			index = allOutputs
		}
		_, _ = w.Write(index)
	}))
	t.Cleanup(server.Close)
	ctx = param.WithParam(ctx, &param.Param{DBURI: db.ConnStr, ApkRepository: server.URL})
	require.NoError(t, persistence.InitPostgres(ctx))
	t.Cleanup(func() { persistence.ClosePool(ctx) })

	_, err := db.Pool.Exec(ctx, `
		INSERT INTO custom_build_request (id, team_id, image_name, image_tag, commit_sha, status, created_at)
		VALUES ('request', 'team', 'example', 'test', 'sha', 'building', NOW());
		INSERT INTO execution (id, created_at, package_id, package_version_id, version_label, status,
			x86_64_status, aarch64_status, x86_64_status_updated_at, aarch64_status_updated_at)
		VALUES ('execution', NOW(), 'package', 'version', '10.3.1-r2', 'publishing',
			'success', 'success', NOW(), NOW());
	`)
	require.NoError(t, err)
	trigger := &BuildAPKOTriggerPackage{
		PackagesByArchitecture: map[string][]string{
			"aarch64": {"example", "example-cli"},
			"x86_64":  {"example", "example-cli"},
		},
		Version: "10.3.1", APKRelease: 2,
	}

	for i := int32(0); i < 2; i++ {
		stage.Store(i)
		ready, err := customPackagePublicationReady(ctx, "execution", "request", trigger)
		require.NoError(t, err)
		require.False(t, ready, "partial publication must not count as package completion")
		var status string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT status FROM execution WHERE id = 'execution'`).Scan(&status))
		require.Equal(t, "publishing", status)
	}
	stage.Store(2)
	ready, err := customPackagePublicationReady(ctx, "execution", "request", trigger)
	require.NoError(t, err)
	require.True(t, ready)

	// A transient repository error must not make the package count as complete.
	stage.Store(3)
	ready, err = customPackagePublicationReady(ctx, "execution", "request", trigger)
	require.False(t, ready)
	require.NoError(t, err)

	// A restart does not reset the deadline: it comes from stored completion times.
	stage.Store(0)
	_, err = db.Pool.Exec(ctx, `UPDATE execution SET x86_64_status_updated_at = $1, aarch64_status_updated_at = $1 WHERE id = 'execution'`, time.Now().Add(-repositoryPublicationTimeout-time.Minute))
	require.NoError(t, err)
	ready, err = customPackagePublicationReady(ctx, "execution", "request", trigger)
	require.False(t, ready)
	require.ErrorContains(t, err, "publication timed out")
	var executionStatus, requestStatus, requestError string
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT status FROM execution WHERE id = 'execution'`).Scan(&executionStatus))
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT status, error FROM custom_build_request WHERE id = 'request'`).Scan(&requestStatus, &requestError))
	require.Equal(t, "failed", executionStatus)
	require.Equal(t, "failed", requestStatus)
	require.Contains(t, requestError, "publication timed out")
}

func TestCustomPackagePublicationRejectsSingleArchitecture(t *testing.T) {
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	t.Cleanup(func() { testutil.TeardownTestDatabase(ctx, t, db) })
	ctx = param.WithParam(ctx, &param.Param{DBURI: db.ConnStr})
	require.NoError(t, persistence.InitPostgres(ctx))
	t.Cleanup(func() { persistence.ClosePool(ctx) })
	_, err := db.Pool.Exec(ctx, `
		INSERT INTO custom_build_request (id, team_id, image_name, image_tag, commit_sha, status, created_at)
		VALUES ('request', 'team', 'example', 'test', 'sha', 'building', NOW());
		INSERT INTO execution (id, created_at, package_id, package_version_id, version_label, status)
		VALUES ('execution', NOW(), 'package', 'version', '10.3.1-r2', 'publishing');
	`)
	require.NoError(t, err)
	ready, err := customPackagePublicationReady(ctx, "execution", "request", &BuildAPKOTriggerPackage{
		PackagesByArchitecture: map[string][]string{"aarch64": {"example"}},
		Version:                "10.3.1", APKRelease: 2,
	})
	require.False(t, ready)
	require.True(t, IsNonRetryableError(err))
	require.ErrorContains(t, err, "x86_64")
	var status, message string
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT status, error FROM custom_build_request WHERE id = 'request'`).Scan(&status, &message))
	require.Equal(t, "failed", status)
	require.Contains(t, message, "x86_64")
}
