package sbpackage

import (
	"context"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// MigrateDependencyData fixes existing bad dependency data where depends_on_package_id = depends_on_package_name.
// This migration runs as a background goroutine and processes package versions one by one,
// extracting dependencies from melange YAML and rewriting them with correct package IDs.
// It checks both package_version_dependency_buildtime and package_version_dependency_runtime tables,
// migrating buildtime first, then runtime.
func MigrateDependencyData(ctx context.Context) error {
	logger.Info("starting dependency data migration")

	// Find all distinct package versions that have bad dependency data in buildtime table
	// Bad data is identified by depends_on_package_id = depends_on_package_name (should be UUID vs name)
	buildtimeQuery := `
		SELECT DISTINCT pv.id
		FROM package_version_dependency_buildtime pvdb
		JOIN package_version pv ON pvdb.package_version_id = pv.id
		WHERE pvdb.depends_on_package_id = pvdb.depends_on_package_name
		ORDER BY pv.id
	`

	conn := persistence.MustGetPooledPostgresSession(ctx)
	rows, err := conn.Query(ctx, buildtimeQuery)
	if err != nil {
		conn.Release()
		return fmt.Errorf("query package versions with bad buildtime dependency data: %w", err)
	}

	var buildtimePackageVersionIDs []string
	for rows.Next() {
		var packageVersionID string
		if err := rows.Scan(&packageVersionID); err != nil {
			rows.Close()
			conn.Release()
			return fmt.Errorf("scan package version id from buildtime: %w", err)
		}
		buildtimePackageVersionIDs = append(buildtimePackageVersionIDs, packageVersionID)
	}

	if err := rows.Err(); err != nil {
		rows.Close()
		conn.Release()
		return fmt.Errorf("error iterating buildtime package version rows: %w", err)
	}
	rows.Close()
	conn.Release()

	logger.Info("found package versions with bad buildtime dependency data",
		zap.Int("count", len(buildtimePackageVersionIDs)))

	// Migrate buildtime dependencies
	if err := migratePackageVersionDependencies(ctx, buildtimePackageVersionIDs); err != nil {
		return fmt.Errorf("migrate buildtime dependencies: %w", err)
	}

	// Find all distinct package versions that have bad dependency data in runtime table
	// This is expected to return significantly fewer rows
	runtimeQuery := `
		SELECT DISTINCT pv.id
		FROM package_version_dependency_runtime pvdr
		JOIN package_version pv ON pvdr.package_version_id = pv.id
		WHERE pvdr.depends_on_package_id = pvdr.depends_on_package_name
		ORDER BY pv.id
	`

	conn = persistence.MustGetPooledPostgresSession(ctx)
	rows, err = conn.Query(ctx, runtimeQuery)
	if err != nil {
		conn.Release()
		return fmt.Errorf("query package versions with bad runtime dependency data: %w", err)
	}

	var runtimePackageVersionIDs []string
	for rows.Next() {
		var packageVersionID string
		if err := rows.Scan(&packageVersionID); err != nil {
			rows.Close()
			conn.Release()
			return fmt.Errorf("scan package version id from runtime: %w", err)
		}
		runtimePackageVersionIDs = append(runtimePackageVersionIDs, packageVersionID)
	}

	if err := rows.Err(); err != nil {
		rows.Close()
		conn.Release()
		return fmt.Errorf("error iterating runtime package version rows: %w", err)
	}
	rows.Close()
	conn.Release()

	logger.Info("found package versions with bad runtime dependency data",
		zap.Int("count", len(runtimePackageVersionIDs)))

	// Migrate runtime dependencies
	if err := migratePackageVersionDependencies(ctx, runtimePackageVersionIDs); err != nil {
		return fmt.Errorf("migrate runtime dependencies: %w", err)
	}

	logger.Info("dependency data migration completed")
	return nil
}

// migratePackageVersionDependencies processes a list of package version IDs and fixes their dependency data
// by extracting dependencies from melange YAML and rewriting them with correct package IDs.
func migratePackageVersionDependencies(ctx context.Context, packageVersionIDs []string) error {
	logger.Info("migrating package version dependencies",
		zap.Int("count", len(packageVersionIDs)))

	// Process each package version
	processed := 0
	failed := 0

	for _, packageVersionID := range packageVersionIDs {
		// Check if context is cancelled
		select {
		case <-ctx.Done():
			logger.Info("dependency migration cancelled",
				zap.Int("processed", processed),
				zap.Int("failed", failed),
				zap.Int("remaining", len(packageVersionIDs)-processed-failed))
			return ctx.Err()
		default:
		}

		// Get the full package version with melange YAML
		packageVersion, err := GetPackageVersion(ctx, packageVersionID)
		if err != nil {
			logger.Error(fmt.Errorf("get package version %s: %w", packageVersionID, err),
				zap.String("package_version_id", packageVersionID))
			failed++
			continue
		}

		// Skip if no melange YAML (can't extract dependencies)
		if packageVersion.MelangeYaml == "" {
			logger.Debug("skipping package version with no melange YAML",
				zap.String("package_version_id", packageVersionID))
			processed++
			continue
		}

		// WritePackageVersionDependencies will delete old dependencies and write new ones
		// It accepts nil as the transaction argument and handles transactions internally
		if err := WritePackageVersionDependencies(ctx, nil, packageVersion); err != nil {
			logger.Error(fmt.Errorf("write package version dependencies for %s: %w", packageVersionID, err),
				zap.String("package_version_id", packageVersionID),
				zap.String("package_id", packageVersion.PackageID),
				zap.String("version", packageVersion.Version))
			failed++
			continue
		}

		processed++

		// Log progress every 10 packages
		if processed%10 == 0 {
			logger.Info("dependency migration progress",
				zap.Int("processed", processed),
				zap.Int("failed", failed),
				zap.Int("remaining", len(packageVersionIDs)-processed-failed))
		}

		// Small delay to avoid overwhelming the database
		time.Sleep(100 * time.Millisecond)
	}

	logger.Info("package version dependencies migration completed",
		zap.Int("total", len(packageVersionIDs)),
		zap.Int("processed", processed),
		zap.Int("failed", failed))

	return nil
}
