package package_family

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

var (
	ErrPackageFamilyNotFound = fmt.Errorf("package family not found")
)

func GetPackageFamily(ctx context.Context, id string) (*PackageFamily, error) {
	logger.Debug("getting package family", zap.String("id", id))

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT
		id, name, monitoring_enabled,
		check_frequency_minutes, version_pattern,
		major_version_filter, package_name_template,
		dry_run_mode, min_version, notify_on_detection,
		notify_on_build_failure, check_for_updates_at, last_check_at,
		last_error, consecutive_errors, created_at, updated_at,
		image_tag_template
		FROM package_family WHERE id = $1`

	var pf PackageFamily
	err := conn.QueryRow(ctx, query, id).Scan(
		&pf.ID, &pf.Name, &pf.MonitoringEnabled,
		&pf.CheckFrequencyMinutes, &pf.VersionPattern,
		&pf.MajorVersionFilter, &pf.PackageNameTemplate,
		&pf.DryRunMode, &pf.MinVersion, &pf.NotifyOnDetection,
		&pf.NotifyOnBuildFailure, &pf.CheckForUpdatesAt, &pf.LastCheckAt,
		&pf.LastError, &pf.ConsecutiveErrors, &pf.CreatedAt, &pf.UpdatedAt,
		&pf.ImageTagTemplate,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			logger.Warn("package family not found", zap.String("id", id))
			return nil, ErrPackageFamilyNotFound
		}
		return nil, fmt.Errorf("get package family: %w", err)
	}

	return &pf, nil
}
