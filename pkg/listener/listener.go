package listener

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

// NotificationHandler is a function type that handles notifications.
// The context always contains attempt info (see GetAttemptInfo); the listener sets it for every handler invocation.
type NotificationHandler func(ctx context.Context, notification *pgconn.Notification) error

// attemptInfoKey is the context key for attempt/maxAttempts.
type attemptInfoKey struct{}

// AttemptInfo holds attempt count and max attempts for a work queue message.
type AttemptInfo struct {
	Attempt     int
	MaxAttempts int
}

// WithAttemptInfo returns a context with attempt and maxAttempts set. The listener calls this for every handler by default.
// attempt must be 1-based (first attempt = 1) so GetAttemptInfo and logs are consistent with the default when context is unset.
func WithAttemptInfo(ctx context.Context, attempt, maxAttempts int) context.Context {
	return context.WithValue(ctx, attemptInfoKey{}, &AttemptInfo{Attempt: attempt, MaxAttempts: maxAttempts})
}

// GetAttemptInfo returns 1-based attempt and maxAttempts from the context, or 1 and MaxRetryAttempts if not set.
// Attempt is always 1-based (first attempt = 1) so logs and tests are consistent whether invoked from the listener or directly.
func GetAttemptInfo(ctx context.Context) (attempt, maxAttempts int) {
	if v := ctx.Value(attemptInfoKey{}); v != nil {
		if a, ok := v.(*AttemptInfo); ok {
			return a.Attempt, a.MaxAttempts
		}
	}
	return 1, MaxRetryAttempts
}

// resultKey is the context key for handler results.
type resultKey struct{}

// resultHolder is a mutable container so handlers can set a result that the
// listener reads after the handler returns. Using a pointer allows the handler
// to modify the value without needing to return a new context.
type resultHolder struct {
	mu     sync.Mutex
	result json.RawMessage
}

// WithResult returns a context that contains a mutable result holder.
// The handler calls SetResult on the value retrieved via GetResultSetter.
func WithResult(ctx context.Context) context.Context {
	return context.WithValue(ctx, resultKey{}, &resultHolder{})
}

// SetResult stores a handler result (JSON-serializable) in the context.
// The handler calls this to communicate its result to the listener.
func SetResult(ctx context.Context, result json.RawMessage) {
	if v := ctx.Value(resultKey{}); v != nil {
		if h, ok := v.(*resultHolder); ok {
			h.mu.Lock()
			h.result = result
			h.mu.Unlock()
		}
	}
}

// GetResult retrieves the handler result from the context, or nil if not set.
func GetResult(ctx context.Context) json.RawMessage {
	if v := ctx.Value(resultKey{}); v != nil {
		if h, ok := v.(*resultHolder); ok {
			h.mu.Lock()
			r := h.result
			h.mu.Unlock()
			return r
		}
	}
	return nil
}

// NonRetryableError wraps errors that should not be retried
type NonRetryableError struct {
	Err error
}

func (e *NonRetryableError) Error() string {
	return fmt.Sprintf("non-retryable: %s", e.Err.Error())
}

func (e *NonRetryableError) Unwrap() error {
	return e.Err
}

// NewNonRetryableError creates a new non-retryable error
func NewNonRetryableError(err error) *NonRetryableError {
	return &NonRetryableError{Err: err}
}

// IsNonRetryableError checks if an error is non-retryable
func IsNonRetryableError(err error) bool {
	var nonRetryable *NonRetryableError
	return errors.As(err, &nonRetryable)
}

// Listener manages PostgreSQL LISTEN/NOTIFY subscriptions
type Listener struct {
	conn              *pgxpool.Conn
	handlers          map[string]NotificationHandler
	reconnectInterval time.Duration
	maxReconnectRetry int
	processors        map[string]*queueProcessor
	pgURI             string // Store the connection string for pooled connections
}

const (
	WorkQueueTable   = "work_queue"
	MaxRetryAttempts = 5 // Maximum number of retry attempts before giving up
)

type queueProcessor struct {
	channel     string
	handler     NotificationHandler
	workerPool  chan struct{}
	processing  bool
	pollTicker  *time.Ticker
	maxWorkers  int
	maxDuration time.Duration // Maximum time a task can be processing before considered failed
}

// NewListener creates a new Listener instance
func NewListener(ctx context.Context) *Listener {
	return &Listener{
		handlers:          make(map[string]NotificationHandler),
		reconnectInterval: 10 * time.Second,
		maxReconnectRetry: 10,
		processors:        make(map[string]*queueProcessor),
		pgURI:             param.GetParam(ctx).DBURI,
	}
}

// AddHandler registers a handler for a specific type of work
func (l *Listener) AddHandler(ctx context.Context, channel string, maxWorkers int, maxDuration time.Duration, handler NotificationHandler) error {
	l.handlers[channel] = handler

	// Initialize queue processor
	l.processors[channel] = &queueProcessor{
		channel:     channel,
		handler:     handler,
		workerPool:  make(chan struct{}, maxWorkers),
		pollTicker:  time.NewTicker(5 * time.Second),
		maxWorkers:  maxWorkers,
		maxDuration: maxDuration,
	}

	return nil
}

// Start begins listening for notifications
func (l *Listener) Start(ctx context.Context) error {
	var err error
	l.conn, err = persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	// Listen on all channels that have registered handlers
	for channel := range l.handlers {
		if _, err := l.conn.Exec(ctx, fmt.Sprintf("LISTEN %s", channel)); err != nil {
			return fmt.Errorf("failed to listen on channel %s: %w", channel, err)
		}

		// Check for existing work in each queue
		processor := l.processors[channel]
		if !processor.processing {
			processor.processing = true
			go l.processQueue(ctx, processor)
		}
	}

	// Send a notification to each channel to trigger immediate processing of any stuck tasks
	for channel := range l.handlers {
		if _, err := l.conn.Exec(ctx, fmt.Sprintf("NOTIFY %s, ''", channel)); err != nil {
			logger.Warn("failed to send startup notification",
				zap.String("channel", channel),
				zap.Error(err))
		} else {
			logger.Debug("sent startup notification", zap.String("channel", channel))
		}
	}

	// Start processing notifications
	go l.processNotifications(ctx)

	return nil
}

// processNotifications now triggers message processing instead of directly handling
func (l *Listener) processNotifications(ctx context.Context) {
	for {
		notification, err := l.conn.Conn().WaitForNotification(ctx)
		if err != nil {
			if ctx.Err() != nil {
				// Context was canceled, exit gracefully
				return
			}
			logger.Error(fmt.Errorf("failed to wait for notification: %w", err))

			// Attempt to reconnect
			if err := l.reconnect(ctx); err != nil {
				logger.Error(fmt.Errorf("failed to reconnect: %w", err))
				return
			}
			continue
		}

		processor, exists := l.processors[notification.Channel]
		if !exists {
			logger.Warn("no processor registered for channel", zap.String("channel", notification.Channel))
			continue
		}

		// Trigger processing if not already processing
		if !processor.processing {
			processor.processing = true
			go l.processQueue(ctx, processor)
		}
	}
}

// processQueue handles message processing for a specific queue
func (l *Listener) processQueue(ctx context.Context, processor *queueProcessor) {
	logger.Debug("processing queue", zap.String("channel", processor.channel))
	defer func() {
		processor.processing = false
		logger.Debug("processing queue done", zap.String("channel", processor.channel))
	}()

	for {
		select {
		case <-ctx.Done():
			logger.Debug("context done", zap.String("channel", processor.channel))
			return
		case <-processor.pollTicker.C:
			// Continue processing on ticker
		default:
			// Process immediately on notification
		}

		// Process messages in a separate function to ensure proper connection cleanup
		shouldContinue := l.processMessagesForQueue(ctx, processor)
		if !shouldContinue {
			logger.Debug("no messages to process", zap.String("channel", processor.channel))
			return
		}
	}
}

// queueMessage is a single locked work-queue row.
type queueMessage struct {
	id           string
	payload      []byte
	attemptCount int
}

// fetchAndLockMessages acquires a pooled connection, runs queue stats and locks
// the next batch of messages, then releases the connection before returning.
// Holding the pool connection only for the duration of the queries (instead of
// the full processing iteration) avoids pool starvation while goroutines wait
// for worker slots or run handlers that acquire their own connections.
//
// A non-nil error indicates a transient pool acquisition failure and the
// caller should retry. Fatal query errors are logged here and surfaced as an
// empty result so the caller stops polling until the next notification.
func (l *Listener) fetchAndLockMessages(ctx context.Context, processor *queueProcessor) ([]queueMessage, error) {
	poolConn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
	if err != nil {
		return nil, err
	}
	defer poolConn.Release()

	var total, inFlight, available int
	var oldestMessageCreatedAt sql.NullTime
	err = poolConn.QueryRow(ctx, fmt.Sprintf(`
		SELECT
			COUNT(*) as total,
			COUNT(CASE WHEN processing_started_at IS NOT NULL AND completed_at IS NULL THEN 1 END) as in_flight,
			COUNT(CASE WHEN processing_started_at IS NULL AND completed_at IS NULL THEN 1 END) as available,
			MIN(created_at) as oldest_message_created_at
		FROM %s
		WHERE channel = $1
		AND completed_at IS NULL`, WorkQueueTable), processor.channel).Scan(&total, &inFlight, &available, &oldestMessageCreatedAt)
	if err != nil {
		logger.Error(fmt.Errorf("failed to get queue statistics: %w", err))
		return nil, nil
	}

	if oldestMessageCreatedAt.Valid {
		logger.Info("queue status",
			zap.String("channel", processor.channel),
			zap.Int("total", total),
			zap.Int("in_flight", inFlight),
			zap.Int("available", available),
			zap.String("oldest_message_created_at", oldestMessageCreatedAt.Time.UTC().Format(time.RFC3339)))
	} else {
		logger.Info("queue status",
			zap.String("channel", processor.channel),
			zap.Int("total", total),
			zap.Int("in_flight", inFlight),
			zap.Int("available", available))
	}

	channelTag := fmt.Sprintf("channel:%s", processor.channel)
	telemetry.Gauge("securebuild.worker.queue.total", float64(total), []string{channelTag})

	// Query and lock unprocessed messages atomically
	// Order by priority DESC (higher priority first), then created_at ASC (oldest first)
	// Priority: 0/NULL = normal, 1 = high
	rows, err := poolConn.Query(ctx, fmt.Sprintf(`
		WITH next_available_messages AS (
			SELECT id, payload
			FROM %s
			WHERE completed_at IS NULL
			AND channel = $1
			AND (
				processing_started_at IS NULL
				OR processing_started_at < NOW() - $2::interval
			)
			ORDER BY COALESCE(priority, 0) DESC, created_at ASC
			LIMIT %d
			FOR UPDATE SKIP LOCKED
		)
		UPDATE %s AS wq
		SET processing_started_at = NOW(),
			attempt_count = COALESCE(attempt_count, 0) + CASE
				WHEN processing_started_at IS NOT NULL THEN 1
				ELSE 0
			END
		FROM next_available_messages
		WHERE wq.id = next_available_messages.id
		RETURNING wq.id, wq.payload, COALESCE(wq.attempt_count, 0)::int`,
		WorkQueueTable, processor.maxWorkers, WorkQueueTable),
		processor.channel, processor.maxDuration.String())
	if err != nil {
		logger.Error(fmt.Errorf("failed to query messages: %w", err))
		return nil, nil
	}
	defer rows.Close()

	var messages []queueMessage
	for rows.Next() {
		var msg queueMessage
		if err := rows.Scan(&msg.id, &msg.payload, &msg.attemptCount); err != nil {
			logger.Error(fmt.Errorf("failed to scan message: %w", err))
			continue
		}
		messages = append(messages, msg)
	}

	return messages, nil
}

// processMessagesForQueue handles a single iteration of message processing
func (l *Listener) processMessagesForQueue(ctx context.Context, processor *queueProcessor) bool {
	messages, err := l.fetchAndLockMessages(ctx, processor)
	if err != nil {
		logger.Warn("failed to get pooled connection in time for listener, continuing with next iteration", zap.String("channel", processor.channel), zap.Error(err))
		return true
	}

	if len(messages) > 0 {
		logger.Info("processing messages",
			zap.Int("count", len(messages)),
			zap.String("channel", processor.channel))
	}

	// Process the messages
	for _, msg := range messages {
		if msg.attemptCount >= MaxRetryAttempts {
			logger.Warn("message exceeded retry limit, marking as completed with error",
				zap.String("id", msg.id),
				zap.String("channel", processor.channel),
				zap.String("payload", string(msg.payload)),
				zap.Int("attempts", msg.attemptCount),
				zap.Int("max_attempts", MaxRetryAttempts))

			updateConn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
			if err == nil {
				updateConn.Exec(ctx, fmt.Sprintf(`
				UPDATE %s
				SET completed_at = NOW(),
				    last_error = $2
				WHERE id = $1`, WorkQueueTable), msg.id, "max retry attempts exceeded")
				updateConn.Release()
			}
			continue
		}

		if msg.attemptCount > 0 {
			logger.Info("retrying message",
				zap.String("id", msg.id),
				zap.Int("attempt", msg.attemptCount+1), // 1-based for consistent indexing with GetAttemptInfo
				zap.String("timeout", processor.maxDuration.String()))
		}

		// Wait for worker slot
		processor.workerPool <- struct{}{}

		go func(messageID string, messagePayload []byte, attemptCount int) {
			defer func() { <-processor.workerPool }()

			startTime := time.Now()
			// attempt_count from DB is 0-based; use 1-based for context so GetAttemptInfo matches tests and logs
			attemptOneBased := attemptCount + 1
			handlerCtx := WithAttemptInfo(ctx, attemptOneBased, MaxRetryAttempts)
			handlerCtx = WithResult(handlerCtx)

			logger.Debug("Starting handler execution",
				zap.String("id", messageID),
				zap.String("channel", processor.channel),
				zap.Int("attempt", attemptOneBased),
				zap.Int("max_attempts", MaxRetryAttempts))

			// Create notification with payload
			notification := &pgconn.Notification{
				Channel: processor.channel,
				Payload: string(messagePayload),
			}

			// Process message
			handlerErr := processor.handler(handlerCtx, notification)

			logger.Debug("Handler execution completed",
				zap.String("id", messageID),
				zap.String("channel", processor.channel),
				zap.Bool("had_error", handlerErr != nil))

			// Use a new pooled connection for updating the message
			updateConn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
			if err != nil {
				logger.Error(fmt.Errorf("failed to connect to database for message update: %w", err))
				return
			}
			defer updateConn.Release()

			if handlerErr != nil {
				// Check if this is a non-retryable error
				if IsNonRetryableError(handlerErr) {
					logger.Warn("handler returned non-retryable error, marking as completed with error",
						zap.String("id", messageID),
						zap.String("channel", processor.channel),
						zap.String("payload", string(messagePayload)),
						zap.Error(handlerErr))

					// Mark as completed with error (don't retry)
					_, updateErr := updateConn.Exec(ctx, fmt.Sprintf(`
						UPDATE %s
						SET completed_at = NOW(),
						    last_error = $2
						WHERE id = $1`, WorkQueueTable),
						messageID, handlerErr.Error())
					if updateErr != nil {
						logger.Error(fmt.Errorf("failed to mark non-retryable message %s as completed: %w", messageID, updateErr))
					}
					return
				}

				// If processing failed, mark it as available for retry
				_, updateErr := updateConn.Exec(ctx, fmt.Sprintf(`
					UPDATE %s
					SET processing_started_at = NULL,
						last_error = $2,
						attempt_count = COALESCE(attempt_count, 0) + 1
					WHERE id = $1`, WorkQueueTable),
					messageID, handlerErr.Error())
				if updateErr != nil {
					logger.Error(fmt.Errorf("failed to mark message %s as failed: %w", messageID, updateErr))
				}
				return
			}

			// Mark completed message in queue (preserve row for status queries)
			result := GetResult(handlerCtx)
			_, err = updateConn.Exec(ctx, fmt.Sprintf(`
				UPDATE %s
				SET completed_at = NOW(),
				    result = $2,
				    last_error = NULL
				WHERE id = $1`, WorkQueueTable), messageID, result)
			if err != nil {
				logger.Error(fmt.Errorf("failed to mark message %s as completed: %w", messageID, err))
				return
			}

			// Log successful completion with duration
			logger.Info("message processed",
				zap.String("id", messageID),
				zap.String("channel", processor.channel),
				zap.String("duration", time.Since(startTime).String()))
		}(msg.id, msg.payload, msg.attemptCount)
	}

	// If no messages found, stop processing until next notification
	if len(messages) == 0 {
		return false
	}

	return true
}

// reconnect attempts to reestablish the database connection
func (l *Listener) reconnect(ctx context.Context) error {
	var err error
	for i := 0; i < l.maxReconnectRetry; i++ {
		if l.conn != nil {
			l.conn.Release()
		}

		l.conn, err = persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
		if err == nil {
			// Resubscribe to all channels
			for channel := range l.handlers {
				if _, err := l.conn.Exec(ctx, fmt.Sprintf("LISTEN %s", channel)); err != nil {
					return fmt.Errorf("failed to relisten on channel %s: %w", channel, err)
				}
			}
			return nil
		}

		time.Sleep(l.reconnectInterval)
	}
	return fmt.Errorf("failed to reconnect after %d attempts", l.maxReconnectRetry)
}

// Stop gracefully shuts down the listener
func (l *Listener) Stop(ctx context.Context) error {
	if l.conn != nil {
		l.conn.Release()
	}
	return nil
}
