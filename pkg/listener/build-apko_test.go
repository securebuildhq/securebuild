package listener

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestWaitForRepositoryPackageRetriesUntilAvailable(t *testing.T) {
	var attempts atomic.Int32
	check := func(context.Context) (bool, error) {
		return attempts.Add(1) >= 3, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	err := waitForRepositoryPackage(
		ctx,
		time.Millisecond,
		check,
	)
	require.NoError(t, err)
	require.EqualValues(t, 3, attempts.Load())
}

func TestWaitForRepositoryPackageStopsAtDeadline(t *testing.T) {
	var attempts atomic.Int32
	check := func(context.Context) (bool, error) {
		attempts.Add(1)
		return false, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := waitForRepositoryPackage(
		ctx,
		time.Millisecond,
		check,
	)
	require.Error(t, err)
	require.True(t, errors.Is(err, context.DeadlineExceeded))
	require.Greater(t, attempts.Load(), int32(1))
}
