package dynamicparam

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

func GetDynamicParam(ctx context.Context, key string) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT value FROM dynamic_config WHERE key = $1`
	var value string
	err := conn.QueryRow(ctx, query, key).Scan(&value)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("failed to get dynamic config: %w", err)
	}
	return value, nil
}

func SetDynamicParam(ctx context.Context, key string, value string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `INSERT INTO dynamic_config (key, value) VALUES ($1, $2)`
	_, err := conn.Exec(ctx, query, key, value)
	if err != nil {
		return fmt.Errorf("failed to set dynamic config: %w", err)
	}
	return nil
}

// GetVMTTLDuration returns the configured VM TTL duration from dynamic config
// Returns default of 24h if not configured
func GetVMTTLDuration(ctx context.Context) (time.Duration, error) {
	value, err := GetDynamicParam(ctx, "vm_ttl_duration")
	if err != nil {
		return 0, fmt.Errorf("failed to get VM TTL duration from dynamic config: %w", err)
	}
	if value == "" {
		return 24 * time.Hour, nil // Default
	}
	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("failed to parse VM TTL duration '%s': %w", value, err)
	}
	return duration, nil
}

// SetVMTTLDuration sets the VM TTL duration in dynamic config
func SetVMTTLDuration(ctx context.Context, duration time.Duration) error {
	return SetDynamicParam(ctx, "vm_ttl_duration", duration.String())
}

func EnsureDynamicParams(ctx context.Context) error {

	x86_64APKIndexID, err := GetDynamicParam(ctx, "apk_index_id_x86_64")
	if err != nil {
		return fmt.Errorf("failed to get x86_64 APK index ID: %w", err)
	}
	if x86_64APKIndexID == "" {
		id, err := securerandom.Hex(24)
		if err != nil {
			return fmt.Errorf("failed to generate x86_64 APK index ID: %w", err)
		}
		if err := SetDynamicParam(ctx, "apk_index_id_x86_64", id); err != nil {
			return fmt.Errorf("failed to set x86_64 APK index ID: %w", err)
		}
		logger.Info("initialized x86_64 APK index ID", zap.String("id", id))
	}

	aarch64APKIndexID, err := GetDynamicParam(ctx, "apk_index_id_aarch64")
	if err != nil {
		return fmt.Errorf("failed to get aarch64 APK index ID: %w", err)
	}
	if aarch64APKIndexID == "" {
		id, err := securerandom.Hex(24)
		if err != nil {
			return fmt.Errorf("failed to generate aarch64 APK index ID: %w", err)
		}
		if err := SetDynamicParam(ctx, "apk_index_id_aarch64", id); err != nil {
			return fmt.Errorf("failed to set aarch64 APK index ID: %w", err)
		}
		logger.Info("initialized aarch64 APK index ID", zap.String("id", id))
	}

	p := param.GetParam(ctx)
	if p.R2UseDynamicFolder {
		existingDir, err := GetDynamicParam(ctx, "r2_directory")
		if err != nil {
			return fmt.Errorf("failed to get r2 directory: %w", err)
		}
		if existingDir == "" {
			dir, err := securerandom.Hex(24)
			if err != nil {
				return fmt.Errorf("failed to generate r2 directory: %w", err)
			}
			if err := SetDynamicParam(ctx, "r2_directory", dir); err != nil {
				return fmt.Errorf("failed to set r2 directory: %w", err)
			}
			logger.Info("initialized r2 directory", zap.String("dir", dir))
		}
	}

	return nil
}
