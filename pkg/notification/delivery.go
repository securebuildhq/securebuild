package notification

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/securebuildhq/securebuild/pkg/email"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

// getReadyEvents retrieves notification events that are ready to be processed
func getReadyEvents(ctx context.Context, limit int) ([]NotificationEvent, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now().UTC()

	// Use PostgreSQL's SKIP LOCKED to safely handle concurrent workers
	query := `
		UPDATE notification_event
		SET status = $1, updated_at = $2
		WHERE id IN (
			SELECT id FROM notification_event
			WHERE status = $3
			AND next_retry_at <= $4
			ORDER BY created_at
			LIMIT $5
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id, notification_id, event_type, image_name, image_tag,
		          image_digest, previous_digest, payload, status, attempts,
		          max_attempts, next_retry_at, last_error, created_at, updated_at`

	rows, err := conn.Query(ctx, query, StatusProcessing, now, StatusPending, now, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query ready events: %w", err)
	}
	defer rows.Close()

	var events []NotificationEvent
	for rows.Next() {
		var event NotificationEvent
		err := rows.Scan(
			&event.ID,
			&event.NotificationID,
			&event.EventType,
			&event.ImageName,
			&event.ImageTag,
			&event.ImageDigest,
			&event.PreviousDigest,
			&event.Payload,
			&event.Status,
			&event.Attempts,
			&event.MaxAttempts,
			&event.NextRetryAt,
			&event.LastError,
			&event.CreatedAt,
			&event.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan event: %w", err)
		}
		events = append(events, event)
	}

	return events, nil
}

// getNotification retrieves the notification configuration for an event
func getNotification(ctx context.Context, notificationID string) (*Notification, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, team_id, image_id, notification_type, target, webhook_secret,
		       events, tag_filter_mode, tag_filters, enabled, created_at, updated_at,
		       last_triggered_at, trigger_count
		FROM notification
		WHERE id = $1`

	var notification Notification
	err := conn.QueryRow(ctx, query, notificationID).Scan(
		&notification.ID,
		&notification.TeamID,
		&notification.ImageID,
		&notification.NotificationType,
		&notification.Target,
		&notification.WebhookSecret,
		&notification.Events,
		&notification.TagFilterMode,
		&notification.TagFilters,
		&notification.Enabled,
		&notification.CreatedAt,
		&notification.UpdatedAt,
		&notification.LastTriggeredAt,
		&notification.TriggerCount,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get notification: %w", err)
	}

	return &notification, nil
}

// updateEventStatus updates the status of a notification event
func updateEventStatus(ctx context.Context, eventID string, status string, errorMsg *string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now().UTC()

	query := `
		UPDATE notification_event
		SET status = $1, last_error = $2, updated_at = $3
		WHERE id = $4`

	_, err := conn.Exec(ctx, query, status, errorMsg, now, eventID)
	if err != nil {
		return fmt.Errorf("failed to update event status: %w", err)
	}

	return nil
}

// updateEventErrorMessage updates only the error message of a notification event
func updateEventErrorMessage(ctx context.Context, eventID string, errorMsg *string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now().UTC()

	query := `
		UPDATE notification_event
		SET last_error = $1, updated_at = $2
		WHERE id = $3`

	_, err := conn.Exec(ctx, query, errorMsg, now, eventID)
	if err != nil {
		return fmt.Errorf("failed to update event error message: %w", err)
	}

	return nil
}

// updateEventResponse updates the response details for a notification event
func updateEventResponse(ctx context.Context, eventID string, statusCode int, responseBody string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now().UTC()

	// Truncate response body if too long (keep first 1000 chars)
	if len(responseBody) > 1000 {
		responseBody = responseBody[:1000] + "... (truncated)"
	}

	query := `
		UPDATE notification_event
		SET response_code = $1, response_body = $2, updated_at = $3
		WHERE id = $4`

	_, err := conn.Exec(ctx, query, statusCode, responseBody, now, eventID)
	if err != nil {
		return fmt.Errorf("failed to update event response: %w", err)
	}

	return nil
}

// scheduleRetry schedules a notification event for retry with exponential backoff
func scheduleRetry(ctx context.Context, eventID string, attempts int, maxAttempts int) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	nextRetryAt := calculateNextRetryTime(attempts)
	now := time.Now().UTC()

	var status string
	var query string
	var args []interface{}

	if attempts >= maxAttempts {
		status = StatusFailed
		// For failed events, don't set a next retry time (set to NULL)
		query = `
			UPDATE notification_event
			SET status = $1, attempts = $2, next_retry_at = NULL, updated_at = $3
			WHERE id = $4`
		args = []interface{}{status, attempts, now, eventID}
	} else {
		status = StatusPending
		query = `
			UPDATE notification_event
			SET status = $1, attempts = $2, next_retry_at = $3, updated_at = $4
			WHERE id = $5`
		args = []interface{}{status, attempts, nextRetryAt, now, eventID}
	}

	_, err := conn.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to schedule retry: %w", err)
	}

	return nil
}

// calculateNextRetryTime calculates the next retry time using exponential backoff
func calculateNextRetryTime(attempts int) time.Time {
	// GitHub-style backoff: 8 attempts over 10 minutes
	// Delays: 15s, 30s, 1m, 2m, 4m, 8m, 16m, 32m (but capped at 10min total)
	delays := []time.Duration{
		15 * time.Second, // 1st retry: 15 seconds
		30 * time.Second, // 2nd retry: 30 seconds
		1 * time.Minute,  // 3rd retry: 1 minute
		2 * time.Minute,  // 4th retry: 2 minutes
		3 * time.Minute,  // 5th retry: 3 minutes (total ~7min)
		2 * time.Minute,  // 6th retry: 2 minutes (total ~9min)
		1 * time.Minute,  // 7th retry: 1 minute  (total ~10min)
		30 * time.Second, // 8th retry: 30 seconds (final attempt)
	}

	if attempts >= len(delays) {
		// After 8 attempts, stop retrying (mark as permanently failed)
		return time.Now().UTC().Add(24 * time.Hour) // Far future for manual inspection
	}

	return time.Now().UTC().Add(delays[attempts])
}

// processEvent processes a single notification event
func processEvent(ctx context.Context, event NotificationEvent) {
	logger.Info(fmt.Sprintf("Processing notification event %s (attempt %d/%d)",
		event.ID, event.Attempts+1, event.MaxAttempts))

	// Get the notification configuration
	notification, err := getNotification(ctx, event.NotificationID)
	if err != nil {
		logger.Error(fmt.Errorf("failed to get notification for event %s: %w", event.ID, err))
		errorMsg := fmt.Sprintf("Failed to get notification: %v", err)
		updateEventStatus(ctx, event.ID, StatusFailed, &errorMsg)
		return
	}

	// Check if notification is still enabled
	if !notification.Enabled {
		logger.Info(fmt.Sprintf("Notification %s is disabled, marking event %s as failed",
			notification.ID, event.ID))
		errorMsg := "Notification is disabled"
		updateEventStatus(ctx, event.ID, StatusFailed, &errorMsg)
		return
	}

	// Attempt delivery
	var deliveryErr error
	switch notification.NotificationType {
	case NotificationTypeEmail:
		deliveryErr = sendEmailNotification(ctx, notification, event)
	case NotificationTypeWebhook:
		deliveryErr = sendWebhookNotification(ctx, notification, event)
	default:
		deliveryErr = fmt.Errorf("unknown notification type: %s", notification.NotificationType)
	}

	// Handle delivery result
	newAttempts := event.Attempts + 1

	if deliveryErr != nil {
		logger.Error(fmt.Errorf("delivery failed for event %s (attempt %d/%d): %w",
			event.ID, newAttempts, event.MaxAttempts, deliveryErr))

		errorMsg := deliveryErr.Error()

		// Schedule retry or mark as failed
		if err := scheduleRetry(ctx, event.ID, newAttempts, event.MaxAttempts); err != nil {
			logger.Error(fmt.Errorf("failed to schedule retry for event %s: %w", event.ID, err))
		}

		// Only update error message if we haven't exceeded max attempts
		// (scheduleRetry already set the correct status)
		if newAttempts < event.MaxAttempts {
			if err := updateEventStatus(ctx, event.ID, StatusPending, &errorMsg); err != nil {
				logger.Error(fmt.Errorf("failed to update event status for %s: %w", event.ID, err))
			}
		} else {
			// Just update the error message for failed events, don't change status
			if err := updateEventErrorMessage(ctx, event.ID, &errorMsg); err != nil {
				logger.Error(fmt.Errorf("failed to update event error message for %s: %w", event.ID, err))
			}
		}
	} else {
		logger.Info(fmt.Sprintf("Successfully delivered notification event %s", event.ID))

		// Mark as delivered
		if err := updateEventStatus(ctx, event.ID, StatusDelivered, nil); err != nil {
			logger.Error(fmt.Errorf("failed to update event status for %s: %w", event.ID, err))
		}
	}
}

// sendEmailNotification sends an email notification via Postmark
func sendEmailNotification(ctx context.Context, notification *Notification, event NotificationEvent) error {
	logger.Info(fmt.Sprintf("Sending email notification to %s for event %s",
		notification.Target, event.ID))

	// Parse the payload to get event details
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
		return fmt.Errorf("failed to parse event payload: %w", err)
	}

	// Send the email using Postmark
	err := email.SendNotificationEmail(
		ctx,
		notification.Target,
		event.EventType,
		event.ImageName,
		event.ImageTag,
		event.ImageDigest,
		func() *string {
			if event.PreviousDigest != nil && *event.PreviousDigest != "" {
				return event.PreviousDigest
			}
			return nil
		}(),
		event.CreatedAt,
	)

	if err != nil {
		return fmt.Errorf("failed to send email notification: %w", err)
	}

	logger.Info(fmt.Sprintf("Successfully sent email notification to %s for event %s",
		notification.Target, event.ID))

	return nil
}

// sendWebhookNotification sends a webhook notification with HMAC signature
func sendWebhookNotification(ctx context.Context, notification *Notification, event NotificationEvent) error {
	logger.Info(fmt.Sprintf("Sending webhook notification to %s for event %s",
		notification.Target, event.ID))

	// Parse the payload to get event details
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
		return fmt.Errorf("failed to parse event payload: %w", err)
	}

	// Create the webhook payload
	webhookPayload := map[string]interface{}{
		"event_type":      event.EventType,
		"image_name":      event.ImageName,
		"image_tag":       event.ImageTag,
		"image_digest":    event.ImageDigest,
		"previous_digest": event.PreviousDigest,
		"timestamp":       event.CreatedAt.Format(time.RFC3339),
		"notification_id": notification.ID,
		"data":            payload,
	}

	// Convert to JSON
	jsonPayload, err := json.Marshal(webhookPayload)
	if err != nil {
		return fmt.Errorf("failed to marshal webhook payload: %w", err)
	}

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, "POST", notification.Target, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return fmt.Errorf("failed to create HTTP request: %w", err)
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "SecureBuild-Webhook/1.0")

	// Add HMAC signature if webhook secret is provided
	if notification.WebhookSecret != nil && *notification.WebhookSecret != "" {
		signature := generateHMACSignature(jsonPayload, *notification.WebhookSecret)
		req.Header.Set("X-SecureBuild-Signature", signature)
		req.Header.Set("X-SecureBuild-Signature-256", "sha256="+signature)
	}

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// Send the request
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send webhook request: %w", err)
	}
	defer resp.Body.Close()

	// Read response body for logging
	body, _ := io.ReadAll(resp.Body)

	// Log the response
	logger.Info(fmt.Sprintf("Webhook response for event %s: status=%d, body=%s",
		event.ID, resp.StatusCode, string(body)))

	// Check if response is successful (2xx status codes)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		// Update response details
		if err := updateEventResponse(ctx, event.ID, resp.StatusCode, string(body)); err != nil {
			logger.Error(fmt.Errorf("failed to update event response for %s: %w", event.ID, err))
		}
		return nil // Success
	}

	// Non-2xx response is considered a failure for retry
	// Update response details
	if err := updateEventResponse(ctx, event.ID, resp.StatusCode, string(body)); err != nil {
		logger.Error(fmt.Errorf("failed to update event response for %s: %w", event.ID, err))
	}
	return fmt.Errorf("webhook returned non-2xx status: %d, body: %s", resp.StatusCode, string(body))
}

// generateHMACSignature generates HMAC-SHA256 signature for webhook payload
func generateHMACSignature(payload []byte, secret string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write(payload)
	return hex.EncodeToString(h.Sum(nil))
}
