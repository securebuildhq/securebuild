package externalimage

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPullCredentialReadErrorPreservesContextTermination(t *testing.T) {
	t.Run("canceled context takes precedence", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		err := pullCredentialReadError(ctx, errors.New("database error"))
		require.ErrorIs(t, err, context.Canceled)
		assert.Equal(t, context.Canceled, err)
	})

	t.Run("expired deadline takes precedence", func(t *testing.T) {
		ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
		defer cancel()

		err := pullCredentialReadError(ctx, errors.New("database error"))
		require.ErrorIs(t, err, context.DeadlineExceeded)
		assert.Equal(t, context.DeadlineExceeded, err)
	})

	t.Run("database context error remains directly classifiable", func(t *testing.T) {
		databaseErr := fmt.Errorf("query interrupted: %w", context.Canceled)
		err := pullCredentialReadError(context.Background(), databaseErr)
		require.ErrorIs(t, err, context.Canceled)
		assert.Equal(t, databaseErr, err)
	})

	t.Run("missing credential keeps the public error", func(t *testing.T) {
		err := pullCredentialReadError(context.Background(), pgx.ErrNoRows)
		assert.EqualError(t, err, "pull credential is unavailable")
	})

	t.Run("ordinary database error remains descriptive", func(t *testing.T) {
		databaseErr := errors.New("database error")
		err := pullCredentialReadError(context.Background(), databaseErr)
		require.ErrorIs(t, err, databaseErr)
		assert.EqualError(t, err, "read pull credential: database error")
	})
}
