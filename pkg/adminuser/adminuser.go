package adminuser

import (
	"context"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// EnsureInitialAdminUser creates the initial admin user if:
// - param.AuthMethod == "password"
// - param.AdminUserEmail is non-empty
// - No buildadmin_user with that email exists yet
//
// If param.AdminUserPassword is also set, stores its bcrypt hash.
// If only email is set (no password), leaves password_hash NULL.
// If password is set but email is not, logs a warning and skips.
// Idempotent: safe to call on every startup.
func EnsureInitialAdminUser(ctx context.Context) error {
	p := param.GetParam(ctx)

	if p.AuthMethod != "password" {
		return nil
	}

	if p.AdminUserEmail == "" && p.AdminUserPassword != "" {
		logger.Warn("admin_user_password is set but admin_user_email is empty; skipping initial admin user creation")
		return nil
	}

	if p.AdminUserEmail == "" {
		return nil
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var count int
	err := conn.QueryRow(ctx, `SELECT COUNT(1) FROM buildadmin_user WHERE email = $1`, p.AdminUserEmail).Scan(&count)
	if err != nil {
		return err
	}

	if count > 0 {
		// User already exists; nothing to do.
		return nil
	}

	id, err := securerandom.Hex(12)
	if err != nil {
		return err
	}

	var passwordHash *string
	if p.AdminUserPassword != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(p.AdminUserPassword), bcryptCost)
		if err != nil {
			return err
		}
		h := string(hash)
		passwordHash = &h
	}

	now := time.Now()
	_, err = conn.Exec(ctx, `
		INSERT INTO buildadmin_user (id, email, name, image_url, created_at, is_admin, password_hash)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, id, p.AdminUserEmail, p.AdminUserEmail, "", now, true, passwordHash)
	if err != nil {
		return err
	}

	logger.Info("initial admin user created", zap.String("email", p.AdminUserEmail))
	return nil
}
