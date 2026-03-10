package team

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

var (
	ErrImageNotFound = errors.New("image not found")
)

func RecordImagePull(ctx context.Context, teamID, serviceAccountID, imageCatalogID, imageName, tag string) error {
	logger.Debug("Recording image pull",
		zap.String("teamID", teamID),
		zap.String("serviceAccountID", serviceAccountID),
		zap.String("imageName", imageName),
		zap.String("tag", tag),
	)

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id from image_catalog where name = $1 and tag = $2 and is_published = true`

	id, err := securerandom.Hex(32)
	if err != nil {
		return fmt.Errorf("failed to generate random ID: %w", err)
	}

	query = `insert into image_pull (id, image_catalog_id, team_id, service_account_id, image_name, image_tag, created_at) values ($1, $2, $3, $4, $5, $6, $7)`
	_, err = conn.Exec(ctx, query, id, imageCatalogID, teamID, serviceAccountID, imageName, tag, time.Now())
	if err != nil {
		return fmt.Errorf("failed to insert image pull: %w", err)
	}

	return nil
}

func TeamHasAccessToImage(ctx context.Context, teamID string, imageName string) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// some teams have full catalog access
	query := `select full_catalog_access from securebuild_team where id = $1`
	row := conn.QueryRow(ctx, query, teamID)
	var fullCatalogAccess bool
	err := row.Scan(&fullCatalogAccess)
	if err != nil {
		return false, err
	}

	if fullCatalogAccess {
		return true, nil
	}

	query = `
		SELECT 1
		FROM team_subscription ts
		JOIN catalog_image ci ON ts.catalog_item_id = ci.catalog_id
		JOIN image i ON ci.image_id = i.id
		WHERE ts.team_id = $1
		  AND i.name = $2
		  AND (
		    ts.status = 'active'
		    OR (ts.status = 'canceled' AND ts.current_period_end > $3)
		  )
		LIMIT 1`

	rows, err := conn.Query(ctx, query, teamID, imageName, time.Now())
	if err != nil {
		return false, err
	}
	defer rows.Close()

	return rows.Next(), nil
}
