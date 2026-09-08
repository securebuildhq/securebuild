package listener

import (
	"context"
	"encoding/json"
	"errors"
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
	ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	err = handleBuildAPKO(ctx, string(payload))

	var retryAfter *RetryAfterError
	require.ErrorAs(t, err, &retryAfter)
	require.ErrorIs(t, err, ErrRepositoryPackageUnavailable)
	require.Equal(t, repositoryPublicationRetryInterval, retryAfter.Delay)
	require.True(t, errors.Is(retryAfter.Err, ErrRepositoryPackageUnavailable))
}

func TestWaitForRepositoryPackageRetriesUntilAvailable(t *testing.T) {
	var attempts atomic.Int32
	err := waitForRepositoryPackage(context.Background(), time.Millisecond, func(context.Context) (bool, error) {
		return attempts.Add(1) >= 3, nil
	})

	require.NoError(t, err)
	require.EqualValues(t, 3, attempts.Load())
}
