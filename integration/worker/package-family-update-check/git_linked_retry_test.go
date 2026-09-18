package package_family_update_check

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/execution"
	"github.com/securebuildhq/securebuild/pkg/listener"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	retryVersionID = "pkgv-git-linked-1.0.0-test"
	retryPackageID = "pkg-git-linked-1.0-test"
	retryTag       = "v1.0.0"
	retryCommitSHA = "abc123initialcommit00000000000000000abc"
)

func startGitLinkedRetryTest(t *testing.T) (context.Context, *testutil.TestDatabase) {
	t.Helper()
	ctx, db, l := setupGitLinkedTestEnv(t, context.Background())
	t.Cleanup(func() {
		persistence.ClosePool(ctx)
		testutil.TeardownTestDatabase(ctx, t, db)
	})

	server := startGitLinkedGitHubMock(t, retryTag, retryCommitSHA)
	listenerCtx, cancel := context.WithCancel(listener.WithGithubClientOverride(ctx, newMockGitHubClient(server)))
	require.NoError(t, l.Start(listenerCtx))
	t.Cleanup(func() {
		cancel()
		l.Stop(listenerCtx)
	})
	return ctx, db
}

func requestGitLinkedRetry(t *testing.T, ctx context.Context, db *testutil.TestDatabase) string {
	t.Helper()
	payload, err := json.Marshal(listener.PackageFamilyUpdateCheckPayload{
		PackageFamilyID:   gitLinkedFamilyID,
		Tag:               retryTag,
		Force:             true,
		SkipImageCreation: true,
	})
	require.NoError(t, err)
	require.NoError(t, persistence.EnqueueWork(ctx, "package_family_update_check", payload))

	var jobID string
	require.NoError(t, db.Pool.QueryRow(ctx, `
		SELECT id FROM work_queue WHERE channel = 'package_family_update_check'
		ORDER BY created_at DESC LIMIT 1`).Scan(&jobID))

	// Wait for the persisted job result, not just the handler's side effects.
	var versionID string
	require.Eventually(t, func() bool {
		var completed bool
		var lastError *string
		err := db.Pool.QueryRow(ctx, `
			SELECT completed_at IS NOT NULL, last_error, COALESCE(result->>'package_version_id', '')
			FROM work_queue WHERE id = $1`, jobID).Scan(&completed, &lastError, &versionID)
		if err != nil || !completed {
			return false
		}
		require.Nil(t, lastError)
		return true
	}, 15*time.Second, 50*time.Millisecond)
	require.NotEmpty(t, versionID)
	return versionID
}

func recordGitLinkedBuild(t *testing.T, ctx context.Context, db *testutil.TestDatabase, versionID, status string, createdAt time.Time) {
	t.Helper()
	_, err := db.Pool.Exec(ctx, `
		INSERT INTO execution (id, package_id, package_version_id, version_label, status, created_at, cause, cause_id)
		VALUES ($1, $2, $3, '1.0.0', $4, $5, 'rebuild chain', 'test-chain-link')`,
		fmt.Sprintf("execution-%d", createdAt.UnixNano()), retryPackageID, versionID, status, createdAt)
	require.NoError(t, err)
}

func TestGitLinkedUpdateCheckRetriesFailedBuild(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	for _, status := range []string{"failed", "vm_deleted"} {
		t.Run(status, func(t *testing.T) {
			ctx, db := startGitLinkedRetryTest(t)
			recordGitLinkedBuild(t, ctx, db, retryVersionID, "failed", time.Now().Add(-time.Hour))
			recordGitLinkedBuild(t, ctx, db, retryVersionID, status, time.Now())

			versionID := requestGitLinkedRetry(t, ctx, db)
			require.Equal(t, retryVersionID, versionID, "Retry must use the existing revision")

			var version, tag, sha, melange string
			var release int
			require.NoError(t, db.Pool.QueryRow(ctx, `
				SELECT version, apk_release, git_tag, git_commit_sha, melange_yaml
				FROM package_version WHERE id = $1`, versionID).Scan(&version, &release, &tag, &sha, &melange))
			assert.Equal(t, "1.0.0", version)
			assert.Equal(t, 0, release)
			assert.Equal(t, retryTag, tag)
			assert.Equal(t, retryCommitSHA, sha)
			assert.Contains(t, melange, "epoch: 0")

			var buildPayload []byte
			require.NoError(t, db.Pool.QueryRow(ctx, `
				SELECT payload FROM work_queue WHERE channel = 'build_package'`).Scan(&buildPayload))
			var build listener.BuildPackagePayload
			require.NoError(t, json.Unmarshal(buildPayload, &build))
			assert.Equal(t, retryPackageID, build.PackageID)
			assert.Equal(t, versionID, build.PackageVersionID)
			assert.Equal(t, "test-chain-link", build.CauseID)
			assert.Equal(t, "rebuild chain", build.Cause)
			assert.NotEmpty(t, build.RetryOfExecutionID)

			var executions int
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM execution WHERE package_version_id = $1`, versionID).Scan(&executions))
			assert.Equal(t, 2, executions, "Previous executions must be preserved; the build handler creates the next one")

			// A repeated request before the build starts must reuse the queued attempt.
			assert.Equal(t, versionID, requestGitLinkedRetry(t, ctx, db))
			var buildCount, versionCount int
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel = 'build_package'`).Scan(&buildCount))
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM package_version WHERE package_id = $1`, retryPackageID).Scan(&versionCount))
			assert.Equal(t, 1, buildCount)
			assert.Equal(t, 1, versionCount)
		})
	}
}

func TestGitLinkedUpdateCheckReusesSuccessfulAndActiveBuilds(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	ctx, db := startGitLinkedRetryTest(t)
	assert.Equal(t, retryVersionID, requestGitLinkedRetry(t, ctx, db), "No execution yet means the build is still pending")

	// Successful and active executions must never enqueue retries.
	recordGitLinkedBuild(t, ctx, db, retryVersionID, "failed", time.Now().Add(-time.Hour))
	for i, status := range []string{"pending", "provisioning", "queued", "building", "testing", "publishing", "success"} {
		t.Run(status, func(t *testing.T) {
			recordGitLinkedBuild(t, ctx, db, retryVersionID, status, time.Now().Add(time.Duration(i)*time.Second))
			assert.Equal(t, retryVersionID, requestGitLinkedRetry(t, ctx, db))
		})
	}
	var buildCount, versionCount int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel IN ('build_package', 'build_package_chain', 'create_package')`).Scan(&buildCount))
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM package_version WHERE package_id = $1`, retryPackageID).Scan(&versionCount))
	assert.Zero(t, buildCount)
	assert.Equal(t, 1, versionCount)
}

func TestGitLinkedRetryNeverRebuildsSuccessfulRevision(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	ctx, db := startGitLinkedRetryTest(t)
	// A legacy later failure must not make a previously successful revision
	// eligible again. Likewise, an older active build must block a new retry.
	for _, earlierStatus := range []string{"success", "building"} {
		t.Run(earlierStatus, func(t *testing.T) {
			_, err := db.Pool.Exec(ctx, `DELETE FROM execution WHERE package_version_id = $1`, retryVersionID)
			require.NoError(t, err)
			recordGitLinkedBuild(t, ctx, db, retryVersionID, earlierStatus, time.Now().Add(-time.Hour))
			failedAt := time.Now().Add(-time.Minute)
			recordGitLinkedBuild(t, ctx, db, retryVersionID, "failed", failedAt)
			assert.Equal(t, retryVersionID, requestGitLinkedRetry(t, ctx, db))
			var queued int
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM work_queue WHERE channel = 'build_package'`).Scan(&queued))
			assert.Zero(t, queued)

			// Also reject a stale retry that was already in the queue before
			// the success (or active attempt) became visible.
			payload, err := json.Marshal(listener.BuildPackagePayload{
				PackageID: retryPackageID, PackageVersionID: retryVersionID,
				RetryOfExecutionID: fmt.Sprintf("execution-%d", failedAt.UnixNano()),
			})
			require.NoError(t, err)
			require.NoError(t, listener.HandleBuildPackage(ctx, string(payload)))
			var attempts int
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM execution WHERE package_version_id = $1`, retryVersionID).Scan(&attempts))
			assert.Equal(t, 2, attempts)
		})
	}
}

func TestGitLinkedRetryClaimsFailedAttemptOnce(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	ctx, db := startGitLinkedRetryTest(t)
	failedAt := time.Now().Add(-time.Minute)
	recordGitLinkedBuild(t, ctx, db, retryVersionID, "failed", failedAt)
	assert.Equal(t, retryVersionID, requestGitLinkedRetry(t, ctx, db))
	var payload []byte
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT payload FROM work_queue WHERE channel = 'build_package'`).Scan(&payload))
	var build listener.BuildPackagePayload
	require.NoError(t, json.Unmarshal(payload, &build))
	pkgVersion, err := sbpackage.GetPackageVersion(ctx, retryVersionID)
	require.NoError(t, err)

	// Concurrent deliveries must atomically create only one new execution.
	var wg sync.WaitGroup
	results := make(chan string, 8)
	errors := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			exe, err := execution.CreateRetryExecution(ctx, retryPackageID, pkgVersion, build.Cause, build.CauseID, build.RetryOfExecutionID)
			if err != nil {
				errors <- err
			} else if exe != nil {
				results <- exe.ID
			}
		}()
	}
	wg.Wait()
	close(errors)
	close(results)
	for err := range errors {
		require.NoError(t, err)
	}
	var claimed []string
	for id := range results {
		claimed = append(claimed, id)
	}
	require.Len(t, claimed, 1)

	// The same queue item must remain a no-op after its attempt fails or
	// succeeds; another failure requires a fresh, explicit retry request.
	for _, status := range []string{"pending", "failed", "success"} {
		_, err := db.Pool.Exec(ctx, `UPDATE execution SET status = $1 WHERE id = $2`, status, claimed[0])
		require.NoError(t, err)
		require.NoError(t, listener.HandleBuildPackage(ctx, string(payload)))
		var attempts int
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM execution WHERE package_version_id = $1`, retryVersionID).Scan(&attempts))
		assert.Equal(t, 2, attempts)
	}
}
