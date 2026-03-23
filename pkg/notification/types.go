package notification

import "time"

// NotificationEvent represents a queued notification delivery
type NotificationEvent struct {
	ID             string    `json:"id"`
	NotificationID string    `json:"notification_id"`
	EventType      string    `json:"event_type"`
	ImageName      string    `json:"image_name"`
	ImageTag       string    `json:"image_tag"`
	ImageDigest    string    `json:"image_digest"`
	PreviousDigest *string   `json:"previous_digest"`
	Payload        string    `json:"payload"`
	Status         string    `json:"status"`
	Attempts       int       `json:"attempts"`
	MaxAttempts    int       `json:"max_attempts"`
	NextRetryAt    time.Time `json:"next_retry_at"`
	LastError      *string   `json:"last_error"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Notification represents a notification configuration
type Notification struct {
	ID               string     `json:"id"`
	TeamID           string     `json:"team_id"`
	ImageID          string     `json:"image_id"`
	NotificationType string     `json:"notification_type"`
	Target           string     `json:"target"`
	WebhookSecret    *string    `json:"webhook_secret"`
	Events           string     `json:"events"`
	TagFilterMode    string     `json:"tag_filter_mode"`
	TagFilters       *string    `json:"tag_filters"`
	Enabled          bool       `json:"enabled"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	LastTriggeredAt  *time.Time `json:"last_triggered_at"`
	TriggerCount     int        `json:"trigger_count"`
}

// EventStatus constants
const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusDelivered  = "delivered"
	StatusFailed     = "failed"
)

// Event types
const (
	EventTagUpdated = "tag_updated"
	EventNewTag     = "new_tag"
	EventCVEFound   = "cve_found"
)

// Notification types
const (
	NotificationTypeWebhook = "webhook"
)
