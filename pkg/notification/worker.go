package notification

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
)

const (
	// Worker configuration
	pollInterval  = 10 * time.Second // How often to check for new events
	maxWorkers    = 5                // Maximum concurrent delivery workers
	batchSize     = 10               // How many events to process per poll
	workerTimeout = 5 * time.Minute  // Timeout for individual delivery attempts
)

// WorkerManager manages the notification delivery workers
type WorkerManager struct {
	ctx             context.Context
	workerSemaphore chan struct{} // Semaphore to limit concurrent workers
	wg              sync.WaitGroup
	running         bool
	mu              sync.RWMutex
}

// StartNotificationWorkers starts the notification delivery system
func StartNotificationWorkers(ctx context.Context) error {
	logger.Info("Starting notification delivery workers")

	manager := &WorkerManager{
		ctx:             ctx,
		workerSemaphore: make(chan struct{}, maxWorkers),
		running:         true,
	}

	// Start the main polling loop
	go manager.pollLoop()

	// Wait for context cancellation
	<-ctx.Done()

	logger.Info("Shutting down notification delivery workers")
	manager.shutdown()

	return nil
}

// pollLoop is the main polling loop that checks for ready events
func (wm *WorkerManager) pollLoop() {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-wm.ctx.Done():
			return
		case <-ticker.C:
			wm.processReadyEvents()
		}
	}
}

// processReadyEvents retrieves and processes events that are ready for delivery
func (wm *WorkerManager) processReadyEvents() {
	wm.mu.RLock()
	if !wm.running {
		wm.mu.RUnlock()
		return
	}
	wm.mu.RUnlock()

	// Get ready events from the database
	events, err := getReadyEvents(wm.ctx, batchSize)
	if err != nil {
		logger.Error(fmt.Errorf("failed to get ready events: %w", err))
		return
	}

	if len(events) == 0 {
		// No events to process, this is normal
		return
	}

	logger.Info(fmt.Sprintf("Found %d notification events ready for delivery", len(events)))

	// Process each event concurrently (up to maxWorkers)
	for _, event := range events {
		select {
		case <-wm.ctx.Done():
			return
		case wm.workerSemaphore <- struct{}{}: // Acquire semaphore
			wm.wg.Add(1)
			go wm.processEventWithTimeout(event)
		default:
			// All workers are busy, event will be picked up in the next poll
			logger.Info(fmt.Sprintf("All workers busy, event %s will be retried in next poll", event.ID))
		}
	}
}

// processEventWithTimeout processes an event with a timeout
func (wm *WorkerManager) processEventWithTimeout(event NotificationEvent) {
	defer func() {
		<-wm.workerSemaphore // Release semaphore
		wm.wg.Done()
	}()

	// Create a context with timeout for this specific delivery
	ctx, cancel := context.WithTimeout(wm.ctx, workerTimeout)
	defer cancel()

	// Process the event
	processEvent(ctx, event)
}

// shutdown gracefully shuts down the worker manager
func (wm *WorkerManager) shutdown() {
	wm.mu.Lock()
	wm.running = false
	wm.mu.Unlock()

	logger.Info("Waiting for notification workers to complete...")

	// Wait for all workers to complete with a timeout
	done := make(chan struct{})
	go func() {
		wm.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		logger.Info("All notification workers completed")
	case <-time.After(30 * time.Second):
		logger.Info("Timeout waiting for notification workers, forcing shutdown")
	}
}
