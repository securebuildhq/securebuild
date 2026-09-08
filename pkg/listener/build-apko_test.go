package listener

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

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
	require.True(t, errors.Is(retryAfter.Err, ErrRepositoryPackageUnavailable))
}

func TestHandleBuildAPKOUsesNormalRetryForRepositoryErrors(t *testing.T) {
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
	require.False(t, errors.As(err, &retryAfter))
	require.ErrorContains(t, err, "503 Service Unavailable")
}
