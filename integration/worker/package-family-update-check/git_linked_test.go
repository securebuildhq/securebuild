package package_family_update_check

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/go-github/v61/github"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	pkgtestutil "github.com/securebuildhq/securebuild/pkg/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	gitLinkedFamilyID = "pf-git-linked-test"
)

const gitLinkedMelangeYAML = `package:
  name: test-git-linked
  version: "0.0.0"
  epoch: 0
  description: "Test git-linked package"
  copyright:
    - license: MIT

environment:
  contents:
    packages:
      - busybox

pipeline:
  - runs: echo "Building test package"
`

const gitLinkedApkoYAML = `contents:
  packages:
    - test-git-linked-1.0
    - busybox
`

func setupGitLinkedTestEnv(t *testing.T, ctx context.Context) (context.Context, *testutil.TestDatabase, *listener.Listener) {
	t.Helper()

	testDB := testutil.SetupTestDatabase(ctx, t)

	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "package-family-update-check", "testdata", "git-linked-seed-data")
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

	l := listener.NewListener(ctx)
	listener.StartPackageFamilyUpdateCheckListener(ctx, l)

	return ctx, testDB, l
}

func startGitLinkedGitHubMock(t *testing.T, tag, commitSHA string) *httptest.Server {
	t.Helper()

	melangeBase64 := base64.StdEncoding.EncodeToString([]byte(gitLinkedMelangeYAML))
	apkoBase64 := base64.StdEncoding.EncodeToString([]byte(gitLinkedApkoYAML))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case strings.HasSuffix(path, "/git/ref/tags/"+tag):
			ref := github.Reference{
				Ref: github.String("refs/tags/" + tag),
				Object: &github.GitObject{
					Type: github.String("commit"),
					SHA:  github.String(commitSHA),
				},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(ref)

		case strings.Contains(path, "/contents/"):
			var content *github.RepositoryContent
			if strings.Contains(path, "melange.yaml") {
				content = &github.RepositoryContent{
					Type:     github.String("file"),
					Name:     github.String("melange.yaml"),
					Path:     github.String("securebuild/package/melange.yaml"),
					Content:  github.String(melangeBase64),
					Encoding: github.String("base64"),
				}
			} else if strings.Contains(path, "apko-test.yaml") {
				content = &github.RepositoryContent{
					Type:     github.String("file"),
					Name:     github.String("apko-test.yaml"),
					Path:     github.String("securebuild/image/apko-test.yaml"),
					Content:  github.String(apkoBase64),
					Encoding: github.String("base64"),
				}
			} else {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(content)

		case strings.Contains(path, "/git/trees/"):
			tree := &github.Tree{
				SHA: github.String(commitSHA),
				Entries: []*github.TreeEntry{
					{
						Path: github.String("securebuild/package/melange.yaml"),
						Type: github.String("blob"),
						SHA:  github.String(commitSHA),
					},
					{
						Path: github.String("securebuild/image/apko-test.yaml"),
						Type: github.String("blob"),
						SHA:  github.String(commitSHA),
					},
				},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(tree)

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))

	t.Cleanup(server.Close)
	return server
}

func newMockGitHubClient(server *httptest.Server) *github.Client {
	client := github.NewClient(nil)
	u, _ := url.Parse(server.URL + "/")
	client.BaseURL = u
	client.UploadURL = u
	return client
}

func TestGitLinkedUpdateCheckNewPackage(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()
	ctx, testDB, l := setupGitLinkedTestEnv(t, ctx)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)
	defer persistence.ClosePool(ctx)

	tag := "v2.0.0"
	commitSHA := "newpackage123commit000000000000000000abc"

	githubServer := startGitLinkedGitHubMock(t, tag, commitSHA)
	githubClient := newMockGitHubClient(githubServer)

	listenerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	listenerCtx = listener.WithGithubClientOverride(listenerCtx, githubClient)

	createPackageReceived := make(chan string, 5)
	err := l.AddHandler(listenerCtx, "create_package", 1, time.Second*10, func(ctx context.Context, notification *pgconn.Notification) error {
		t.Logf("Received create_package event: %s", notification.Payload)
		createPackageReceived <- notification.Payload
		return nil
	})
	require.NoError(t, err)

	go l.Start(listenerCtx)
	defer l.Stop(listenerCtx)

	time.Sleep(1 * time.Second)

	payload := listener.PackageFamilyUpdateCheckPayload{
		PackageFamilyID:   gitLinkedFamilyID,
		Tag:               tag,
		Force:             true,
		SkipImageCreation: true,
	}
	payloadBytes, err := json.Marshal(payload)
	require.NoError(t, err)

	err = persistence.EnqueueWork(ctx, "package_family_update_check", payloadBytes)
	require.NoError(t, err)

	select {
	case <-createPackageReceived:
		t.Log("Received create_package event")
	case <-time.After(15 * time.Second):
		require.Fail(t, "Timeout waiting for create_package event")
	}

	var packageName string
	err = testDB.Pool.QueryRow(ctx,
		`SELECT name FROM package WHERE name = 'test-git-linked-2.0'`,
	).Scan(&packageName)
	require.NoError(t, err, "Package test-git-linked-2.0 should have been created")
	assert.Equal(t, "test-git-linked-2.0", packageName)

	var pfpCount int
	err = testDB.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM package_family_package WHERE package_family_id = $1 AND version_major = 2 AND version_minor = 0`,
		gitLinkedFamilyID,
	).Scan(&pfpCount)
	require.NoError(t, err)
	assert.Equal(t, 1, pfpCount, "package_family_package should have a row for version 2.0")

	var versionStr, gitTag, gitCommitSHA string
	err = testDB.Pool.QueryRow(ctx, `
		SELECT version, git_tag, git_commit_sha
		FROM package_version
		WHERE package_id = (SELECT id FROM package WHERE name = 'test-git-linked-2.0')
		ORDER BY created_at DESC LIMIT 1
	`).Scan(&versionStr, &gitTag, &gitCommitSHA)
	require.NoError(t, err, "Package version should have been created")
	assert.Equal(t, "2.0.0", versionStr)
	assert.Equal(t, tag, gitTag)
	assert.Equal(t, commitSHA, gitCommitSHA)

	var lastError *string
	err = testDB.Pool.QueryRow(ctx, "SELECT last_error FROM package_family WHERE id = $1", gitLinkedFamilyID).Scan(&lastError)
	require.NoError(t, err)
	assert.Nil(t, lastError, "package_family last_error should be cleared on success")
}

func TestGitLinkedUpdateCheckExistingPackagePatchRelease(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()
	ctx, testDB, l := setupGitLinkedTestEnv(t, ctx)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)
	defer persistence.ClosePool(ctx)

	tag := "v1.0.1"
	commitSHA := "patchrelease456commit0000000000000000def"

	githubServer := startGitLinkedGitHubMock(t, tag, commitSHA)
	githubClient := newMockGitHubClient(githubServer)

	listenerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	listenerCtx = listener.WithGithubClientOverride(listenerCtx, githubClient)

	buildPackageChainReceived := make(chan string, 5)
	err := l.AddHandler(listenerCtx, "build_package_chain", 1, time.Second*10, func(ctx context.Context, notification *pgconn.Notification) error {
		t.Logf("Received build_package_chain event: %s", notification.Payload)
		buildPackageChainReceived <- notification.Payload
		return nil
	})
	require.NoError(t, err)

	go l.Start(listenerCtx)
	defer l.Stop(listenerCtx)

	time.Sleep(1 * time.Second)

	var existingPkgCount int
	err = testDB.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM package_family_package WHERE package_family_id = $1`,
		gitLinkedFamilyID,
	).Scan(&existingPkgCount)
	require.NoError(t, err)
	require.Equal(t, 1, existingPkgCount, "Seed data should have 1 package_family_package row")

	payload := listener.PackageFamilyUpdateCheckPayload{
		PackageFamilyID:   gitLinkedFamilyID,
		Tag:               tag,
		Force:             true,
		SkipImageCreation: true,
	}
	payloadBytes, err := json.Marshal(payload)
	require.NoError(t, err)

	err = persistence.EnqueueWork(ctx, "package_family_update_check", payloadBytes)
	require.NoError(t, err)

	select {
	case payloadStr := <-buildPackageChainReceived:
		t.Logf("Received build_package_chain event: %s", payloadStr)
	case <-time.After(15 * time.Second):
		require.Fail(t, "Timeout waiting for build_package_chain event")
	}

	var newVersionCount int
	err = testDB.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM package_version
		WHERE package_id = 'pkg-git-linked-1.0-test'
	`).Scan(&newVersionCount)
	require.NoError(t, err)
	assert.Equal(t, 2, newVersionCount, "Should have 2 versions: seed 1.0.0 + new 1.0.1")

	var versionStr, gitTag, gitCommitSHA string
	err = testDB.Pool.QueryRow(ctx, `
		SELECT version, git_tag, git_commit_sha
		FROM package_version
		WHERE package_id = 'pkg-git-linked-1.0-test'
		ORDER BY created_at DESC LIMIT 1
	`).Scan(&versionStr, &gitTag, &gitCommitSHA)
	require.NoError(t, err)
	assert.Equal(t, "1.0.1", versionStr)
	assert.Equal(t, tag, gitTag)
	assert.Equal(t, commitSHA, gitCommitSHA)

	var pfpCount int
	err = testDB.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM package_family_package WHERE package_family_id = $1`,
		gitLinkedFamilyID,
	).Scan(&pfpCount)
	require.NoError(t, err)
	assert.Equal(t, 1, pfpCount, "No new package_family_package row should be created for a patch release")

	var lastError *string
	err = testDB.Pool.QueryRow(ctx, "SELECT last_error FROM package_family WHERE id = $1", gitLinkedFamilyID).Scan(&lastError)
	require.NoError(t, err)
	assert.Nil(t, lastError, "package_family last_error should be cleared on success")
}

func TestGitLinkedImageUpdateCheckWithVPrefix(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()
	ctx, testDB, l := setupGitLinkedTestEnv(t, ctx)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)
	defer persistence.ClosePool(ctx)

	// Seed the image data
	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	imageSeedDir := filepath.Join(projectRoot, "integration", "worker", "package-family-update-check", "testdata", "git-linked-seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, imageSeedDir, true)
	require.NoError(t, err)

	tag := "v1.0.0"
	commitSHA := "abc123initialcommit00000000000000000abc"

	githubServer := startGitLinkedGitHubMock(t, tag, commitSHA)
	githubClient := newMockGitHubClient(githubServer)

	listenerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	listenerCtx = listener.WithGithubClientOverride(listenerCtx, githubClient)

	// Start the image update check listener
	listener.StartImageUpdateCheckListener(listenerCtx, l)

	go l.Start(listenerCtx)
	defer l.Stop(listenerCtx)

	time.Sleep(1 * time.Second)

	// Trigger image update check with v-prefixed tag
	payload := listener.ImageUpdateCheckPayload{
		ImageID: "img-git-linked-test",
		Tag:     tag,
	}
	payloadBytes, err := json.Marshal(payload)
	require.NoError(t, err)

	err = persistence.EnqueueWork(ctx, "image_update_check", payloadBytes)
	require.NoError(t, err)

	// Wait for the handler to process (may retry once if VM assignment fails,
	// but the image_apko records are created on the first attempt)
	time.Sleep(5 * time.Second)

	// Verify image_apko was created with the correct git_tag
	var apkoID, apkoGitTag string
	err = testDB.Pool.QueryRow(ctx, `
		SELECT id, git_tag
		FROM image_apko
		WHERE image_id = $1
	`, "img-git-linked-test").Scan(&apkoID, &apkoGitTag)
	require.NoError(t, err, "image_apko should have been created")
	assert.Equal(t, tag, apkoGitTag, "git_tag should preserve the v prefix")

	// Verify image_apko_version has the package pinned correctly
	var apkoYAML string
	err = testDB.Pool.QueryRow(ctx, `
		SELECT apko_yaml
		FROM image_apko_version
		WHERE image_apko_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, apkoID).Scan(&apkoYAML)
	require.NoError(t, err, "image_apko_version should have been created")

	// The core bug: without the fix, the package would remain unpinned
	// because pinCorePackageForImage queries pv.version = 'v1.0.0' which
	// does not match the normalized '1.0.0' stored in the DB.
	assert.Contains(t, apkoYAML, "test-git-linked-1.0~1.0.0",
		"APKO YAML should have the core package pinned to the normalized version")

	// Verify the image_package link was created
	var pinnedVersion string
	err = testDB.Pool.QueryRow(ctx, `
		SELECT pinned_version
		FROM image_package
		WHERE apko_id = $1
	`, apkoID).Scan(&pinnedVersion)
	require.NoError(t, err, "image_package link should have been created")
	assert.Equal(t, "1.0.0", pinnedVersion, "pinned_version should be the normalized version")
}
