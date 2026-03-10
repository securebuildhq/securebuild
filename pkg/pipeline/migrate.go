package pipeline

import (
	"context"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// MigratePipelineTables migrates data from the old package_pipeline table to
// the new unified pipeline table.
// This function is idempotent.
// TODO: Remove this once the migration is complete.
func MigratePipelineTables(ctx context.Context, logger *zap.Logger) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	logger.Info("Starting pipeline table migration")

	// Check if package_pipeline table exists
	var exists bool
	checkQuery := `
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_name = 'package_pipeline'
		)
	`
	err := conn.QueryRow(ctx, checkQuery).Scan(&exists)
	if err != nil {
		return fmt.Errorf("failed to check if package_pipeline table exists: %w", err)
	}

	if !exists {
		logger.Info("package_pipeline table does not exist, migration already complete or not needed")
		return nil
	}

	logger.Info("package_pipeline table found, starting migration to pipeline table")

	// Start a transaction for the migration
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Migrate data from package_pipeline to pipeline table
	migrateQuery := `
		INSERT INTO pipeline (id, pipeline_type, path, yaml_content, description, created_at, updated_at)
		SELECT
			id,
			'package' as pipeline_type,
			path,
			yaml_content,
			description,
			created_at,
			updated_at
		FROM package_pipeline
		ON CONFLICT (pipeline_type, path) DO NOTHING
	`
	result, err := tx.Exec(ctx, migrateQuery)
	if err != nil {
		return fmt.Errorf("failed to migrate package pipelines: %w", err)
	}

	rowsAffected := result.RowsAffected()
	logger.Info("Migrated package pipelines to pipeline table", zap.Int64("rows", rowsAffected))

	// Drop the old package_pipeline table
	dropQuery := `DROP TABLE package_pipeline CASCADE`
	_, err = tx.Exec(ctx, dropQuery)
	if err != nil {
		return fmt.Errorf("failed to drop package_pipeline table: %w", err)
	}

	logger.Info("Dropped old package_pipeline table")

	// Commit the transaction
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit migration transaction: %w", err)
	}

	logger.Info("pipeline table migration completed successfully")
	return nil
}
