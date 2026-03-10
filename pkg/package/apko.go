package sbpackage

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

func GetGenerateApko(ctx context.Context, id string) (*types.GenerateApko, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, user_id, session_id, melange_yaml, created_at, apko_yaml
		FROM package_generate_apko
		WHERE id = $1
	`

	var generateApko types.GenerateApko
	var apkoYaml sql.NullString
	err := conn.QueryRow(ctx, query, id).Scan(
		&generateApko.ID,
		&generateApko.UserID,
		&generateApko.SessionID,
		&generateApko.MelangeYaml,
		&generateApko.CreatedAt,
		&apkoYaml,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to get generate apko: %w", err)
	}

	if apkoYaml.Valid {
		generateApko.ApkoYaml = apkoYaml.String
	}

	return &generateApko, nil
}
