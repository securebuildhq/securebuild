package package_family_update_check

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

const unpinnedImageYAML = "contents: {packages: [test-git-linked, test-migrations, busybox]}"

func TestGitLinkedImagePins(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	for _, tc := range []struct {
		name, channel string
		movedTag      bool
		alreadyPinned bool
	}{
		{name: "manual rebuild repairs unchanged tag", channel: "build_apko"},
		{name: "whole image rebuild repairs unchanged tag", channel: "build_image"},
		{name: "API repairs unchanged tag despite successful build", channel: "image_update_check"},
		{name: "manual rebuild retains pins after tag moves", channel: "build_apko", movedTag: true, alreadyPinned: true},
		{name: "API retains pins after tag moves", channel: "image_update_check", movedTag: true, alreadyPinned: true},
		{name: "API reuses correctly pinned successful build", channel: "image_update_check", alreadyPinned: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			sha := retryCommitSHA
			if tc.movedTag {
				sha = "def456movedcommit0000000000000000000def"
			}
			ctx, db := setupImagePinTest(t, sha)
			if tc.alreadyPinned {
				_, err := db.Pool.Exec(ctx, `UPDATE image_apko_version SET apko_yaml = $1 WHERE id = 'apkov-pin-test'`, pinnedTestImageYAML())
				require.NoError(t, err)
			}
			requestImagePinBuild(t, ctx, db, tc.channel, false)

			var versionID, yaml, storedSHA string
			require.NoError(t, db.Pool.QueryRow(ctx, `
				SELECT id, apko_yaml, git_commit_sha FROM image_apko_version
				WHERE image_apko_id = 'apko-pin-test' ORDER BY created_at DESC LIMIT 1`).Scan(&versionID, &yaml, &storedSHA))
			require.Equal(t, sha, storedSHA)
			require.Contains(t, yaml, "test-git-linked~1.0.0")
			require.Contains(t, yaml, "test-migrations~1.0.0")
			require.Contains(t, yaml, "busybox")
			var versions, builds, dispatches int
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM image_apko_version`).Scan(&versions))
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM image_build`).Scan(&builds))
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM work_queue WHERE channel = 'build_image_with_vm_assigned'`).Scan(&dispatches))
			if tc.alreadyPinned && !tc.movedTag {
				require.Equal(t, "apkov-pin-test", versionID)
				require.Equal(t, 1, versions)
				require.Equal(t, 1, builds)
				require.Zero(t, dispatches)
				return
			}
			require.NotEqual(t, "apkov-pin-test", versionID)
			require.Equal(t, 2, versions)
			require.Equal(t, 2, builds)
			require.Equal(t, 1, dispatches)
			var buildVersion, pin, testYAML string
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT image_apko_version_id FROM image_build WHERE id <> 'old-image-build'`).Scan(&buildVersion))
			require.Equal(t, versionID, buildVersion)
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT pinned_version FROM image_package WHERE apko_id = 'apko-pin-test'`).Scan(&pin))
			require.Equal(t, "1.0.0", pin)
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT yaml_content FROM image_test WHERE apko_version_id = $1`, versionID).Scan(&testYAML))
			require.Equal(t, "pipeline: [{runs: test --version}]", testYAML)

			// Repair is idempotent: an API retry reuses the new queued build.
			requestImagePinBuild(t, ctx, db, "image_update_check", false)
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM image_apko_version`).Scan(&versions))
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM image_build`).Scan(&builds))
			require.Equal(t, 2, versions)
			require.Equal(t, 2, builds)
		})
	}
}

func TestGitLinkedImagePinFailuresDoNotBuild(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	for _, channel := range []string{"build_apko", "build_image", "image_update_check"} {
		t.Run(channel, func(t *testing.T) {
			t.Parallel()
			ctx, db := setupImagePinTest(t, retryCommitSHA)
			_, err := db.Pool.Exec(ctx, `UPDATE package_version SET version = '9.0.0'`)
			require.NoError(t, err)
			requestImagePinBuild(t, ctx, db, channel, true)
			var versions, builds, dispatches int
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM image_apko_version`).Scan(&versions))
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM image_build`).Scan(&builds))
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM work_queue WHERE channel = 'build_image_with_vm_assigned'`).Scan(&dispatches))
			require.Equal(t, 1, versions)
			require.Equal(t, 1, builds)
			require.Zero(t, dispatches)
		})
	}
}

func TestGitLinkedImageCreationPins(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	for _, missingPackage := range []bool{false, true} {
		name := "pins new recipe"
		if missingPackage {
			name = "rejects new recipe when package version is missing"
		}
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			ctx, db := setupImagePinTest(t, retryCommitSHA)
			_, err := db.Pool.Exec(ctx, `DELETE FROM image_build; DELETE FROM image_test; DELETE FROM image_apko_version; DELETE FROM image_apko`)
			require.NoError(t, err)
			if missingPackage {
				_, err = db.Pool.Exec(ctx, `UPDATE package_version SET version = '9.0.0'`)
				require.NoError(t, err)
			}
			requestImagePinBuild(t, ctx, db, "image_update_check", missingPackage)
			var builds, versions int
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM image_build`).Scan(&builds))
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM image_apko_version`).Scan(&versions))
			if missingPackage {
				require.Zero(t, builds)
				require.Zero(t, versions)
				return
			}
			require.Equal(t, 1, builds)
			require.Equal(t, 1, versions)
			var yaml string
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT apko_yaml FROM image_apko_version`).Scan(&yaml))
			require.Contains(t, yaml, "test-git-linked~1.0.0")
			require.Contains(t, yaml, "test-migrations~1.0.0")
		})
	}
}

func TestGitLinkedSubpackageImagePins(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	ctx, db := setupImagePinTest(t, retryCommitSHA)
	_, err := db.Pool.Exec(ctx, `UPDATE image_apko_version SET apko_yaml = 'contents: {packages: [test-migrations, busybox]}'`)
	require.NoError(t, err)
	requestImagePinBuild(t, ctx, db, "build_apko", false)
	var yaml string
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT apko_yaml FROM image_apko_version ORDER BY created_at DESC LIMIT 1`).Scan(&yaml))
	require.Contains(t, yaml, "test-migrations~1.0.0")
	require.NotContains(t, yaml, "test-git-linked")
}

func TestGitLinkedImageRejectsUnrecognizedCorePackage(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	ctx, db := setupImagePinTest(t, retryCommitSHA)
	_, err := db.Pool.Exec(ctx, `UPDATE image_apko_version SET apko_yaml = 'contents: {packages: [unknown-package, busybox]}'`)
	require.NoError(t, err)
	requestImagePinBuild(t, ctx, db, "build_apko", true)
	var builds int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM image_build`).Scan(&builds))
	require.Equal(t, 1, builds)
}

func TestGitLinkedStandaloneImageCanBuild(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	ctx, db := setupImagePinTest(t, retryCommitSHA)
	_, err := db.Pool.Exec(ctx, `UPDATE package_family SET git_remote = NULL`)
	require.NoError(t, err)
	requestImagePinBuild(t, ctx, db, "build_apko", false)
	var yaml string
	var versions, builds int
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT apko_yaml FROM image_apko_version WHERE id = 'apkov-pin-test'`).Scan(&yaml))
	require.Equal(t, unpinnedImageYAML, yaml)
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM image_apko_version`).Scan(&versions))
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT count(*) FROM image_build`).Scan(&builds))
	require.Equal(t, 1, versions)
	require.Equal(t, 2, builds)
}

func pinnedTestImageYAML() string {
	yaml := strings.ReplaceAll(unpinnedImageYAML, "test-git-linked", "test-git-linked~1.0.0")
	return strings.ReplaceAll(yaml, "test-migrations", "test-migrations~1.0.0")
}

func setupImagePinTest(t *testing.T, sha string) (context.Context, *testutil.TestDatabase) {
	t.Helper()
	ctx, db, l := setupGitLinkedTestEnv(t, context.Background())
	t.Cleanup(func() {
		persistence.ClosePool(ctx)
		testutil.TeardownTestDatabase(ctx, t, db)
	})
	root, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, db.ConnStr, filepath.Join(root, "integration/worker/package-family-update-check/testdata/image-pin-seed-data"), true))
	server := startGitLinkedGitHubMock(t, retryTag, sha, unpinnedImageYAML)
	ctx = listener.WithGithubClientOverride(ctx, newMockGitHubClient(server))
	ctx = buildbackend.WithBackend(ctx, imagePinBackend{})
	listener.StartImageUpdateCheckListener(ctx, l)
	listener.StartBuildAPKOListener(ctx, l)
	listener.StartBuildImageListener(ctx, l)
	listenerCtx, cancel := context.WithCancel(ctx)
	require.NoError(t, l.Start(listenerCtx))
	t.Cleanup(func() {
		cancel()
		_ = l.Stop(ctx)
	})
	return ctx, db
}

func requestImagePinBuild(t *testing.T, ctx context.Context, db *testutil.TestDatabase, channel string, wantError bool) {
	t.Helper()
	payload, err := json.Marshal(map[string]string{
		"id": "img-git-linked-test", "imageId": "img-git-linked-test", "apkoId": "apko-pin-test", "tag": retryTag,
	})
	require.NoError(t, err)
	require.NoError(t, persistence.EnqueueWork(ctx, channel, payload))
	var jobID string
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT id FROM work_queue WHERE channel = $1 ORDER BY created_at DESC LIMIT 1`, channel).Scan(&jobID))
	var lastError *string
	require.Eventually(t, func() bool {
		var done bool
		err := db.Pool.QueryRow(ctx, `
			SELECT completed_at IS NOT NULL, last_error
			FROM work_queue WHERE id = $1`, jobID).Scan(&done, &lastError)
		return err == nil && done
	}, 15*time.Second, 20*time.Millisecond)
	if !wantError {
		require.Nil(t, lastError)
	} else {
		require.NotNil(t, lastError)
		require.NotEmpty(t, *lastError)
	}
}

type imagePinBackend struct{}

func (imagePinBackend) Type() buildbackend.BackendType        { return buildbackend.BackendStatic }
func (imagePinBackend) SeedMachinePool(context.Context) error { return nil }
func (imagePinBackend) AvailableArchitectures(context.Context) ([]string, error) {
	return []string{"aarch64"}, nil
}
func (imagePinBackend) AcquireBuildMachine(context.Context, buildbackend.AcquireOptions) (*buildbackend.BuildMachine, error) {
	return &buildbackend.BuildMachine{ID: "test-vm", WorkDir: "/tmp/test-image-pin"}, nil
}
