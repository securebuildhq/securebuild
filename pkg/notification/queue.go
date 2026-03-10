package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

// NotificationEventPayload represents the JSON payload stored in notification events
type NotificationEventPayload struct {
	ImageName      string            `json:"image_name"`
	ImageTag       string            `json:"image_tag"`
	ImageDigest    string            `json:"image_digest"`
	PreviousDigest *string           `json:"previous_digest,omitempty"`
	EventType      string            `json:"event_type"`
	Timestamp      time.Time         `json:"timestamp"`
	Metadata       map[string]string `json:"metadata,omitempty"`
}

// QueueNotificationEvent creates notification_event records for all notifications matching the given image and event type
func QueueNotificationEvent(ctx context.Context, imageName, imageTag, imageDigest string, eventType string, previousDigest *string) error {
	logger.Debug("queuing notification events",
		zap.String("imageName", imageName),
		zap.String("imageTag", imageTag),
		zap.String("eventType", eventType))

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Get all enabled notifications for this image and event type
	notifications, err := getMatchingNotifications(ctx, imageName, imageTag, eventType)
	if err != nil {
		return fmt.Errorf("failed to get matching notifications: %w", err)
	}

	if len(notifications) == 0 {
		logger.Debug("no notifications configured for this image/event",
			zap.String("imageName", imageName),
			zap.String("imageTag", imageTag),
			zap.String("eventType", eventType))
		return nil
	}

	logger.Info("found matching notifications",
		zap.String("imageName", imageName),
		zap.String("imageTag", imageTag),
		zap.String("eventType", eventType),
		zap.Int("count", len(notifications)))

	// Create the payload
	payload := NotificationEventPayload{
		ImageName:      imageName,
		ImageTag:       imageTag,
		ImageDigest:    imageDigest,
		PreviousDigest: previousDigest,
		EventType:      eventType,
		Timestamp:      time.Now().UTC(),
		Metadata: map[string]string{
			"source": "securebuild",
		},
	}

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal notification payload: %w", err)
	}

	// Create notification events for each matching notification
	for _, notification := range notifications {
		eventID, err := securerandom.Hex(16)
		if err != nil {
			return fmt.Errorf("failed to generate event ID: %w", err)
		}
		eventID = "ne_" + eventID

		query := `
			INSERT INTO notification_event (
				id, notification_id, event_type, image_name, image_tag,
				image_digest, previous_digest, payload, status, attempts,
				max_attempts, next_retry_at, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
			)`

		now := time.Now().UTC()
		_, err = conn.Exec(ctx, query,
			eventID,             // $1
			notification.ID,     // $2
			eventType,           // $3
			imageName,           // $4
			imageTag,            // $5
			imageDigest,         // $6
			previousDigest,      // $7
			string(payloadJSON), // $8
			StatusPending,       // $9
			0,                   // $10 - attempts
			8,                   // $11 - max_attempts
			now,                 // $12 - next_retry_at (immediately available)
			now,                 // $13 - created_at
			now,                 // $14 - updated_at
		)
		if err != nil {
			return fmt.Errorf("failed to create notification event: %w", err)
		}

		logger.Info("created notification event",
			zap.String("eventID", eventID),
			zap.String("notificationID", notification.ID),
			zap.String("notificationType", notification.NotificationType),
			zap.String("target", notification.Target))
	}

	return nil
}

// getMatchingNotifications retrieves all enabled notifications that match the image and event type
func getMatchingNotifications(ctx context.Context, imageName, imageTag, eventType string) ([]Notification, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// First, get the image_id from the image_catalog table
	imageIDQuery := `
		SELECT image_id FROM image_catalog
		WHERE name = $1 AND is_published = true
		LIMIT 1`

	var imageID string
	err := conn.QueryRow(ctx, imageIDQuery, imageName).Scan(&imageID)
	if err != nil {
		logger.Debug("no published image found for notification lookup",
			zap.String("imageName", imageName),
			zap.Error(err))
		return nil, nil
	}

	logger.Debug("found image_id for notifications",
		zap.String("imageName", imageName),
		zap.String("imageID", imageID))

	// Get all enabled notifications for this image that include this event type
	query := `
		SELECT id, team_id, image_id, notification_type, target, webhook_secret,
		       events, tag_filter_mode, tag_filters, enabled, created_at, updated_at,
		       last_triggered_at, trigger_count
		FROM notification
		WHERE image_id = $1
		AND enabled = true
		AND events LIKE '%' || $2 || '%'`

	rows, err := conn.Query(ctx, query, imageID, eventType)
	if err != nil {
		return nil, fmt.Errorf("failed to query notifications: %w", err)
	}
	defer rows.Close()

	var notifications []Notification
	for rows.Next() {
		var notification Notification
		err := rows.Scan(
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
			return nil, fmt.Errorf("failed to scan notification: %w", err)
		}

		// Check if this notification should fire for this specific tag
		if shouldNotifyForTag(&notification, imageTag) {
			notifications = append(notifications, notification)
			logger.Debug("notification matches tag filter",
				zap.String("notificationID", notification.ID),
				zap.String("imageTag", imageTag),
				zap.String("tagFilterMode", notification.TagFilterMode))
		} else {
			logger.Debug("notification filtered out by tag filter",
				zap.String("notificationID", notification.ID),
				zap.String("imageTag", imageTag),
				zap.String("tagFilterMode", notification.TagFilterMode))
		}
	}

	return notifications, nil
}

// shouldNotifyForTag checks if a notification should fire for a specific tag based on tag filters
func shouldNotifyForTag(notification *Notification, imageTag string) bool {
	// If tag_filter_mode is "all", always notify
	if notification.TagFilterMode == "all" {
		return true
	}

	// If tag_filter_mode is "specific", check if the tag is in the filter list
	if notification.TagFilterMode == "specific" && notification.TagFilters != nil {
		var tagFilters []string
		if err := json.Unmarshal([]byte(*notification.TagFilters), &tagFilters); err != nil {
			// If we can't parse the filters, default to not notifying to be safe
			return false
		}

		for _, filterTag := range tagFilters {
			if filterTag == imageTag {
				return true
			}
		}
		return false
	}

	// Default to not notifying if we don't understand the filter mode
	return false
}
