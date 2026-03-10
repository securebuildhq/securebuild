package sbpackage

import (
	"context"
	"database/sql"

	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

func GetGenerateMelange(ctx context.Context, id string) (*types.GenerateMelange, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id, created_at, updated_at, completed_at, user_id from generate_melange where id = $1`
	row := conn.QueryRow(ctx, query, id)

	gm := &types.GenerateMelange{}
	var completedAt sql.NullTime
	if err := row.Scan(&gm.ID, &gm.CreatedAt, &gm.UpdatedAt, &completedAt, &gm.UserID); err != nil {
		return nil, err
	}

	if completedAt.Valid {
		gm.CompletedAt = completedAt.Time
	}

	query = `select id, created_at, prompt, response, melange_yaml from generate_melange_prompt where generate_melange_id = $1 order by created_at asc`
	rows, err := conn.Query(ctx, query, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var m types.GenerateMelangeMessage
		var response sql.NullString
		var melangeYaml sql.NullString
		if err := rows.Scan(&m.ID, &m.CreatedAt, &m.Prompt, &response, &melangeYaml); err != nil {
			return nil, err
		}
		m.Response = response.String
		m.MelangeYaml = melangeYaml.String

		gm.Messages = append(gm.Messages, &m)
	}

	return gm, nil
}
