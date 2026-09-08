package work_queue_scheduled_retry

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	pkgtestutil "github.com/securebuildhq/securebuild/pkg/testutil"
	"github.com/stretchr/testify/require"
)

func TestScheduledRetryEventuallyProcessesTheOriginalMessage(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	ctx := context.Background()
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	var err error
	ctx, err = param.Init(param.InitSourceEnvironment, map[string]string{
		"DB_URI":       testDB.ConnStr,
		"PIPELINE_DIR": pkgtestutil.SetupTestPipelineDir(t),
	})
	require.NoError(t, err)
	require.NoError(t, persistence.InitPostgres(ctx))
	defer persistence.ClosePool(ctx)

	const channel = "scheduled_retry_test"
	var attempts atomic.Int32
	completed := make(chan struct{})

	l := listener.NewListener(ctx)
	require.NoError(t, l.AddHandler(ctx, channel, 1, time.Second, func(context.Context, *pgconn.Notification) error {
		if attempts.Add(1) == 1 {
			return listener.NewRetryAfterError(errors.New("package is not published yet"), 100*time.Millisecond, time.Minute)
		}
		close(completed)
		return nil
	}))

	listenerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	require.NoError(t, l.Start(listenerCtx))
	defer l.Stop(listenerCtx)

	require.NoError(t, persistence.EnqueueWork(ctx, channel, map[string]string{"package": "example=10.3.1-r2"}))

	select {
	case <-completed:
	case <-time.After(10 * time.Second):
		t.Fatal("scheduled retry did not process the message")
	}

	require.EqualValues(t, 2, attempts.Load())

	var rowCount, attemptCount int
	var completedSuccessfully bool
	require.Eventually(t, func() bool {
		err = testDB.Pool.QueryRow(ctx, `
			SELECT COUNT(*),
			       BOOL_AND(completed_at IS NOT NULL AND last_error IS NULL),
			       COALESCE(MAX(attempt_count), 0)
			FROM work_queue
			WHERE channel = $1`, channel).Scan(&rowCount, &completedSuccessfully, &attemptCount)
		return err == nil && completedSuccessfully
	}, 2*time.Second, 10*time.Millisecond)
	require.Equal(t, 1, rowCount, "scheduled retries must reuse the original queue row")
	require.True(t, completedSuccessfully)
	require.Zero(t, attemptCount, "publication waits must not consume failure attempts")
}
