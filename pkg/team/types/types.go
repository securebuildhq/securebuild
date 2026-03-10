package types

import (
	"database/sql"
	"time"

	"github.com/lib/pq"
)

type ServiceAccount struct {
	ID        string
	Name      string
	ExpiresAt *time.Time
}

type Invite struct {
	ID         string
	Token      string
	TeamID     string
	Email      string
	Role       string
	CreatedAt  time.Time
	LastSentAt *time.Time
}

type Team struct {
	ID                string         `json:"id"`
	Name              string         `json:"name"`
	CreatedAt         time.Time      `json:"created_at"`
	StripeCustomerID  sql.NullString `json:"stripe_customer_id,omitempty"`
	PaymentEmail      sql.NullString `json:"payment_email,omitempty"`
	RegistryUsername  sql.NullString `json:"registry_username,omitempty"`
	FullCatalogAccess bool           `json:"full_catalog_access"`
	FeatureFlags      pq.StringArray `json:"feature_flags"`
}

type ActivityEventType string

const (
	ActivityEventTypeImagePull ActivityEventType = "image_pull"
)
