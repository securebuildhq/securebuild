package externalimage

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/image"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

type PullCredential struct {
	Type     string
	Username string
	Password string
}

// GetExternalImagePullCredential returns a live, job-scoped pull credential.
// The ownership and image predicates prevent a queue payload from using a
// credential outside the request that created it.
func GetExternalImagePullCredential(ctx context.Context, id, teamID, registry, imageName string) (*PullCredential, error) {
	if id == "" {
		return nil, fmt.Errorf("pull credential id is required")
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	row := conn.QueryRow(ctx, `
		SELECT credential_type, username, password
		FROM external_image_pull_credential
		WHERE id = $1
		  AND team_id = $2
		  AND registry = $3
		  AND image_name = $4
		  AND delete_after > NOW()
		  AND (provider_expires_at IS NULL OR provider_expires_at > NOW())
	`, id, teamID, registry, imageName)

	var credential PullCredential
	var encryptedPassword string
	if err := row.Scan(&credential.Type, &credential.Username, &encryptedPassword); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("pull credential is unavailable")
		}
		return nil, fmt.Errorf("read pull credential: %w", err)
	}

	password, err := image.DecryptExternalRegistryPassword(ctx, encryptedPassword)
	if err != nil {
		return nil, fmt.Errorf("decrypt pull credential: %w", err)
	}
	credential.Password = password
	return &credential, nil
}

func DeleteExternalImagePullCredential(ctx context.Context, id string) error {
	if id == "" {
		return nil
	}
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	if _, err := conn.Exec(ctx, `DELETE FROM external_image_pull_credential WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete pull credential: %w", err)
	}
	return nil
}

func DeleteExpiredExternalImagePullCredentials(ctx context.Context) (int64, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	result, err := conn.Exec(ctx, `
		DELETE FROM external_image_pull_credential
		WHERE delete_after <= NOW()
		   OR (provider_expires_at IS NOT NULL AND provider_expires_at <= NOW())
	`)
	if err != nil {
		return 0, fmt.Errorf("delete expired pull credentials: %w", err)
	}
	return result.RowsAffected(), nil
}
