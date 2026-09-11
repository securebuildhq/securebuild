package listener

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/stretchr/testify/require"
)

func TestHandleBuildAPKOSchedulesRetryWhileTriggerPackageIsUnpublished(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(server.Close)

	payload, err := json.Marshal(BuildAPKOPayload{
		ImageID: "image-id",
		APKOID:  "apko-id",
		TriggerPackage: &BuildAPKOTriggerPackage{
			Name:       "example",
			Version:    "10.3.1",
			APKRelease: 2,
		},
	})
	require.NoError(t, err)

	ctx := param.WithParam(context.Background(), &param.Param{ApkRepository: server.URL})
	err = handleBuildAPKO(ctx, string(payload))

	var retryAfter *RetryAfterError
	require.ErrorAs(t, err, &retryAfter)
	require.ErrorIs(t, err, ErrRepositoryPackageUnavailable)
	require.Equal(t, repositoryPublicationRetryInterval, retryAfter.Delay)
	require.Equal(t, 30*time.Minute, retryAfter.MaxAge)
	require.True(t, errors.Is(retryAfter.Err, ErrRepositoryPackageUnavailable))
}

func TestHandleBuildAPKODelaysRetryForRepositoryErrors(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)

	payload, err := json.Marshal(BuildAPKOPayload{
		ImageID: "image-id",
		APKOID:  "apko-id",
		TriggerPackage: &BuildAPKOTriggerPackage{
			Name:       "example",
			Version:    "10.3.1",
			APKRelease: 2,
		},
	})
	require.NoError(t, err)

	ctx := param.WithParam(context.Background(), &param.Param{ApkRepository: server.URL})
	err = handleBuildAPKO(ctx, string(payload))

	var retryAfter *RetryAfterError
	require.Error(t, err)
	require.ErrorAs(t, err, &retryAfter)
	require.Equal(t, 10*time.Second, retryAfter.Delay)
	require.Equal(t, 30*time.Minute, retryAfter.MaxAge)
	require.ErrorContains(t, err, "503 Service Unavailable")
}

func TestHandleBuildAPKORejectsInvalidPresentTriggerPackage(t *testing.T) {
	t.Parallel()

	payload, err := json.Marshal(BuildAPKOPayload{
		ImageID:        "image-id",
		APKOID:         "apko-id",
		TriggerPackage: &BuildAPKOTriggerPackage{},
	})
	require.NoError(t, err)

	ctx := param.WithParam(context.Background(), &param.Param{ApkRepository: "https://repo.example"})
	err = handleBuildAPKO(ctx, string(payload))

	require.True(t, IsNonRetryableError(err))
	require.ErrorContains(t, err, "package name")
}

func TestCheckPackagePublicationWaitsForBothArchitectures(t *testing.T) {
	t.Parallel()
	var stage atomic.Int32
	index := publicationTestIndex(t, "example")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if stage.Load() == 0 && r.URL.Path == "/x86_64/APKINDEX.tar.gz" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(index)
	}))
	t.Cleanup(server.Close)
	ctx := param.WithParam(context.Background(), &param.Param{ApkRepository: server.URL})
	trigger := BuildAPKOTriggerPackage{
		Name: "example", Version: "10.3.1", APKRelease: 2,
	}
	err := checkPackagePublication(ctx, trigger)
	var retry *RetryAfterError
	require.ErrorAs(t, err, &retry)
	require.ErrorIs(t, err, ErrRepositoryPackageUnavailable)

	stage.Store(1)
	require.NoError(t, checkPackagePublication(ctx, trigger))
}

func publicationTestIndex(t *testing.T, names ...string) []byte {
	t.Helper()
	var content bytes.Buffer
	for _, name := range names {
		fmt.Fprintf(&content, "P:%s\nV:10.3.1-r2\n\n", name)
	}
	var archive bytes.Buffer
	gz := gzip.NewWriter(&archive)
	tw := tar.NewWriter(gz)
	require.NoError(t, tw.WriteHeader(&tar.Header{Name: "APKINDEX", Mode: 0o644, Size: int64(content.Len())}))
	_, err := tw.Write(content.Bytes())
	require.NoError(t, err)
	require.NoError(t, tw.Close())
	require.NoError(t, gz.Close())
	return archive.Bytes()
}

func TestCheckPackagePublicationRetriesReadAndParseFailures(t *testing.T) {
	t.Parallel()
	for _, mode := range []string{"truncated", "malformed", "disconnected", "rate-limited"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				switch mode {
				case "disconnected":
					conn, _, err := w.(http.Hijacker).Hijack()
					if err == nil {
						_ = conn.Close()
					}
				case "truncated":
					w.Header().Set("Content-Length", "100")
					_, _ = w.Write([]byte("short"))
				case "malformed":
					_, _ = w.Write([]byte("not a gzip index"))
				case "rate-limited":
					w.WriteHeader(http.StatusTooManyRequests)
				}
			}))
			t.Cleanup(server.Close)
			ctx := param.WithParam(context.Background(), &param.Param{ApkRepository: server.URL})
			err := checkPackagePublication(ctx, BuildAPKOTriggerPackage{Name: "example", Version: "10.3.1", APKRelease: 2})
			var retry *RetryAfterError
			require.ErrorAs(t, err, &retry)
			require.Equal(t, 10*time.Second, retry.Delay)
			require.Equal(t, 30*time.Minute, retry.MaxAge)
		})
	}
}

func TestCheckPackagePublicationRejectsInvalidConfiguration(t *testing.T) {
	t.Parallel()
	for _, repository := range []string{"", "ftp://repo.example", "https://", "://invalid"} {
		ctx := param.WithParam(context.Background(), &param.Param{ApkRepository: repository})
		err := checkPackagePublication(ctx, BuildAPKOTriggerPackage{Name: "example", Version: "10.3.1", APKRelease: 2})
		require.True(t, IsNonRetryableError(err), "%s: %v", repository, err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) }))
	t.Cleanup(server.Close)
	ctx := param.WithParam(context.Background(), &param.Param{ApkRepository: server.URL})
	err := checkPackagePublication(ctx, BuildAPKOTriggerPackage{Name: "example", Version: "10.3.1", APKRelease: 2})
	require.True(t, IsNonRetryableError(err))
}
