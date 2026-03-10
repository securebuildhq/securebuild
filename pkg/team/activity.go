package team

import (
	"context"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/team/types"
	"github.com/tuvistavie/securerandom"
)

type RecordTeamActivityOpts struct {
	EventType types.ActivityEventType
	TeamID    string

	ImageCatalogID string
	ImageName      string
	ImageTag       string

	ServiceAccountID string
}

func RecordTeamActivity(ctx context.Context, opts RecordTeamActivityOpts) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	id, err := securerandom.Hex(32)
	if err != nil {
		return fmt.Errorf("failed to generate random ID: %w", err)
	}

	query := `insert into activity_log (id, event_type, team_id, image_catalog_id, image_name, image_tag, service_account_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`
	_, err = conn.Exec(ctx, query, id, opts.EventType, opts.TeamID, opts.ImageCatalogID, opts.ImageName, opts.ImageTag, opts.ServiceAccountID, time.Now())
	if err != nil {
		return fmt.Errorf("failed to insert activity log: %w", err)
	}

	return nil
}
