package team

import (
	"context"
	"database/sql"
	"slices"

	"github.com/lib/pq"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/team/types"
)

func GetInvite(ctx context.Context, id string) (*types.Invite, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id, token, team_id, email, role, created_at, last_sent_at from securebuild_invite where id = $1`

	var invite types.Invite
	var lastSentAt sql.NullTime
	if err := conn.QueryRow(ctx, query, id).Scan(&invite.ID, &invite.Token, &invite.TeamID, &invite.Email, &invite.Role, &invite.CreatedAt, &lastSentAt); err != nil {
		return nil, err
	}

	if lastSentAt.Valid {
		invite.LastSentAt = &lastSentAt.Time
	}

	return &invite, nil
}

func SetInviteSent(ctx context.Context, id string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `update securebuild_invite set last_sent_at = now() where id = $1`

	_, err := conn.Exec(ctx, query, id)
	if err != nil {
		return err
	}

	return nil
}

func GetTeam(ctx context.Context, id string) (*types.Team, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id, name from securebuild_team where id = $1`

	var team types.Team
	if err := conn.QueryRow(ctx, query, id).Scan(&team.ID, &team.Name); err != nil {
		return nil, err
	}

	return &team, nil
}

// GetTeamWithFeatureFlags returns a team with all fields including feature_flags
func GetTeamWithFeatureFlags(ctx context.Context, id string) (*types.Team, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id, name, created_at, stripe_customer_id, payment_email, registry_username, full_catalog_access, feature_flags 
			  from securebuild_team where id = $1`

	var team types.Team
	if err := conn.QueryRow(ctx, query, id).Scan(
		&team.ID,
		&team.Name,
		&team.CreatedAt,
		&team.StripeCustomerID,
		&team.PaymentEmail,
		&team.RegistryUsername,
		&team.FullCatalogAccess,
		pq.Array(&team.FeatureFlags),
	); err != nil {
		return nil, err
	}

	return &team, nil
}

// HasFeatureFlag checks if a team has a specific feature flag
func HasFeatureFlag(ctx context.Context, teamId string, flag string) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select feature_flags from securebuild_team where id = $1`

	var featureFlags pq.StringArray
	if err := conn.QueryRow(ctx, query, teamId).Scan(pq.Array(&featureFlags)); err != nil {
		return false, err
	}

	return slices.Contains(featureFlags, flag), nil
}

// UpdateTeamFeatureFlags updates a team's feature flags (for admin API)
func UpdateTeamFeatureFlags(ctx context.Context, teamId string, flags []string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `update securebuild_team set feature_flags = $1 where id = $2`

	_, err := conn.Exec(ctx, query, pq.Array(flags), teamId)
	if err != nil {
		return err
	}

	return nil
}
