package externalimage

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExternalImageSBOMStatusWriteErrorPreservesContextTermination(t *testing.T) {
	t.Run("canceled context takes precedence", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		err := externalImageSBOMStatusWriteError(ctx, errors.New("database error"), "write status", "sha256:test")
		require.ErrorIs(t, err, context.Canceled)
		assert.Equal(t, context.Canceled, err)
	})

	t.Run("expired deadline takes precedence", func(t *testing.T) {
		ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
		defer cancel()

		err := externalImageSBOMStatusWriteError(ctx, errors.New("database error"), "write status", "sha256:test")
		require.ErrorIs(t, err, context.DeadlineExceeded)
		assert.Equal(t, context.DeadlineExceeded, err)
	})

	t.Run("database context error remains direct", func(t *testing.T) {
		databaseErr := fmt.Errorf("query interrupted: %w", context.Canceled)
		err := externalImageSBOMStatusWriteError(context.Background(), databaseErr, "write status", "sha256:test")
		assert.Equal(t, databaseErr, err)
	})

	t.Run("ordinary database error remains descriptive", func(t *testing.T) {
		databaseErr := errors.New("database error")
		err := externalImageSBOMStatusWriteError(context.Background(), databaseErr, "write status", "sha256:test")
		require.ErrorIs(t, err, databaseErr)
		assert.EqualError(t, err, "failed to write status for digest sha256:test: database error")
	})
}
