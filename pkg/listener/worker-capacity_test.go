package listener

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestWorkerCapacitySignals(t *testing.T) {
	newProcessor := func(workers int) *queueProcessor {
		return &queueProcessor{maxWorkers: workers, workerPool: make(chan struct{}, workers), workerAvailable: make(chan struct{}, 1)}
	}
	t.Run("completion before or during wait is not lost", func(t *testing.T) {
		p := newProcessor(1)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		for i := 0; i < 100; i++ {
			p.workerPool <- struct{}{}
			ready := make(chan bool, 1)
			go func() { ready <- p.waitForCapacity(ctx) }()
			p.releaseWorkerSlot()
			require.True(t, <-ready)
		}
	})
	t.Run("stale signal does not bypass saturation or cancellation", func(t *testing.T) {
		p := newProcessor(1)
		p.workerPool <- struct{}{}
		p.releaseWorkerSlot()      // leave a buffered completion
		p.workerPool <- struct{}{} // capacity has since been consumed
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		ready := make(chan bool, 1)
		go func() { ready <- p.waitForCapacity(ctx) }()
		select {
		case <-ready:
			t.Fatal("stale completion bypassed a full worker pool")
		case <-time.After(20 * time.Millisecond):
		}
		cancel()
		select {
		case ok := <-ready:
			require.False(t, ok)
		case <-time.After(time.Second):
			t.Fatal("capacity wait ignored cancellation")
		}
	})
	t.Run("multiple completions never block without a waiter", func(t *testing.T) {
		p := newProcessor(2)
		p.workerPool <- struct{}{}
		p.workerPool <- struct{}{}
		done := make(chan struct{})
		go func() {
			p.releaseWorkerSlot()
			p.releaseWorkerSlot()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("handler completion blocked without a waiter")
		}
		require.Empty(t, p.workerPool)
		require.True(t, p.waitForCapacity(context.Background()))
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		require.False(t, p.waitForCapacity(ctx))
	})
}
