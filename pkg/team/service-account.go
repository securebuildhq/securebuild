package team

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/team/types"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

var (
	// ErrServiceAccountNotFound is returned when a service account is not found
	ErrServiceAccountNotFound = errors.New("service account not found")
)

// UpdateServiceAccountLastActive updates the last used timestamp for a service account
//
// It returns an error if the update fails.
func UpdateServiceAccountLastActive(ctx context.Context, serviceAccountID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `update service_account set last_used_at = now() where id = $1`

	_, err := conn.Exec(ctx, query, serviceAccountID)
	if err != nil {
		return fmt.Errorf("failed to update service account last active: %w", err)
	}

	return nil
}

// FindServiceAccountWithValue looks up a service account by its plain text value, first trying SHA-256 and then bcrypt
//
// If the service account is found, it returns the service account and nil.
// If the service account is not found, it returns nil and an error.
// If the service account is found with bcrypt, it will automatically migrate it to SHA-256.
func FindServiceAccountWithValue(ctx context.Context, teamID string, plainTextValue string) (*types.ServiceAccount, error) {
	serviceAccount, err := findServiceAccountWithValueSHA256(ctx, teamID, plainTextValue)
	if err == nil {
		return serviceAccount, nil
	} else if !errors.Is(err, ErrServiceAccountNotFound) {
		return nil, fmt.Errorf("failed to find service account with value SHA-256: %w", err)
	}

	return findServiceAccountWithValueBcrypt(ctx, teamID, plainTextValue)
}

func findServiceAccountWithValueSHA256(ctx context.Context, teamID string, plainTextValue string) (*types.ServiceAccount, error) {
	logger.Debug("looking for service account for team", zap.String("teamID", teamID))
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Fast path: Try SHA-256 lookup first (for new tokens)
	sha256Hash := hashTokenSHA256(plainTextValue)
	sha256Query := `
		SELECT id, name, expires_at, hash_algorithm
		FROM service_account
		WHERE team_id = $1
		  AND bcrypt_hash = $2
		  AND hash_algorithm = $3
		  AND (expires_at IS NULL OR expires_at > NOW())
	`

	var serviceAccount types.ServiceAccount
	var expiresAt sql.NullTime
	var hashAlgorithm string

	err := conn.QueryRow(ctx, sha256Query, teamID, sha256Hash, algorithmSHA256).Scan(
		&serviceAccount.ID,
		&serviceAccount.Name,
		&expiresAt,
		&hashAlgorithm,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrServiceAccountNotFound
		}
		return nil, fmt.Errorf("failed to find service account with value SHA-256: %w", err)
	}

	// Found with SHA-256 - fast path
	serviceAccount.ExpiresAt = &expiresAt.Time
	logger.Debug("found service account with SHA-256",
		zap.String("teamID", teamID),
		zap.String("serviceAccountID", serviceAccount.ID))
	return &serviceAccount, nil
}

func findServiceAccountWithValueBcrypt(ctx context.Context, teamID string, plainTextValue string) (*types.ServiceAccount, error) {
	logger.Debug("looking for service account for team", zap.String("teamID", teamID))
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Slow path: Fall back to bcrypt for legacy tokens
	// Use partial_value filter to reduce bcrypt comparisons
	partialValue := serviceAccountGetPartialValue(plainTextValue)
	query := `
		SELECT id, name, expires_at, bcrypt_hash
		FROM service_account
		WHERE team_id = $1
		  AND hash_algorithm = $2
		  AND partial_value = $3
		  AND (expires_at IS NULL OR expires_at > NOW())
	`

	serivceAccounts := map[string]types.ServiceAccount{}

	rows, err := conn.Query(ctx, query, teamID, algorithmBcrypt, partialValue)
	if err != nil {
		return nil, fmt.Errorf("failed to find service account with value bcrypt: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var serviceAccount types.ServiceAccount
		var expiresAt sql.NullTime
		var bcrpytHash string
		if err := rows.Scan(&serviceAccount.ID, &serviceAccount.Name, &expiresAt, &bcrpytHash); err != nil {
			return nil, fmt.Errorf("failed to scan service account: %w", err)
		}

		serviceAccount.ExpiresAt = &expiresAt.Time
		serivceAccounts[bcrpytHash] = serviceAccount
	}

	rows.Close()

	for hash, sa := range serivceAccounts {
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(plainTextValue)) == nil {
			fields := []zap.Field{
				zap.String("serviceAccountID", sa.ID),
				zap.String("teamID", teamID),
			}

			logger.Debug("found service account with bcrypt", fields...)

			// Auto-migrate to SHA-256
			newHash := hashTokenSHA256(plainTextValue)
			migrationQuery := `
					UPDATE service_account
					SET bcrypt_hash = $1, hash_algorithm = $2
					WHERE id = $3
				`
			_, err := conn.Exec(ctx, migrationQuery, newHash, algorithmSHA256, sa.ID)
			if err != nil {
				logger.GetLogger().Error("failed to migrate token to SHA-256 for service account",
					append(fields, zap.Error(err))...)
				// Don't fail authentication if migration fails
			} else {
				logger.Info("migrated service account token from bcrypt to SHA-256", fields...)
			}
			return &sa, nil
		}
	}

	return nil, ErrServiceAccountNotFound
}
