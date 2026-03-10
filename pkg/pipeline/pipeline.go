package pipeline

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// GetPipelineDir returns the persistent directory for pipeline files based on type
func GetPipelineDir(ctx context.Context, pipelineType PipelineType) (string, error) {
	p := param.GetParam(ctx)
	if p.PipelineDir == "" {
		return "", fmt.Errorf("pipeline directory is not configured")
	}

	var subdir string
	switch pipelineType {
	case TypePackage:
		subdir = "packages"
	case TypeImage:
		subdir = "images"
	default:
		return "", fmt.Errorf("unknown pipeline type: %s", pipelineType)
	}

	return filepath.Join(p.PipelineDir, subdir), nil
}

// GetPipeline fetches a specific pipeline by path
func GetPipeline(ctx context.Context, pipelineType PipelineType, path string) (*Pipeline, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, pipeline_type, path, yaml_content, description, created_at, updated_at
		FROM pipeline
		WHERE pipeline_type = $1 AND path = $2
	`

	var pipeline Pipeline
	var description sql.NullString
	err := conn.QueryRow(ctx, query, string(pipelineType), path).Scan(
		&pipeline.ID,
		&pipeline.Type,
		&pipeline.Path,
		&pipeline.YAMLContent,
		&description,
		&pipeline.CreatedAt,
		&pipeline.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrPipelineNotFound
		}
		return nil, fmt.Errorf("failed to get %s pipeline: %w", pipelineType, err)
	}

	if description.Valid {
		pipeline.Description = description.String
	}

	return &pipeline, nil
}

// SyncPipelineToDirectory writes a pipeline to the local filesystem
func SyncPipelineToDirectory(ctx context.Context, pipeline *Pipeline) error {
	pipelineDir, err := GetPipelineDir(ctx, pipeline.Type)
	if err != nil {
		return fmt.Errorf("failed to get pipeline directory: %w", err)
	}

	// Ensure directory exists
	if err := os.MkdirAll(pipelineDir, 0o755); err != nil {
		return fmt.Errorf("failed to create pipeline directory %s: %w", pipelineDir, err)
	}

	// Write the pipeline file
	pipelineFile := filepath.Join(pipelineDir, pipeline.Path+".yaml")

	// Ensure parent directories exist for the pipeline file
	if err := os.MkdirAll(filepath.Dir(pipelineFile), 0o755); err != nil {
		return fmt.Errorf("failed to create parent directory for %s: %w", pipelineFile, err)
	}

	if err := os.WriteFile(pipelineFile, []byte(pipeline.YAMLContent), 0o644); err != nil {
		return fmt.Errorf("failed to write %s pipeline file %s: %w", pipeline.Type, pipelineFile, err)
	}

	return nil
}

// SetupPipelines creates the pipeline directories and syncs all pipelines from
// the database for both package and image types. It also loads the reserved
// pipelines from GitHub or cache for package pipelines.
func SetupPipelines(ctx context.Context, logger *zap.Logger) error {
	// Clean up any incorrectly placed pipeline files first
	if err := cleanupIncorrectPipelineFiles(ctx, logger); err != nil {
		logger.Warn("failed to clean up incorrect pipeline files", zap.Error(err))
		// Don't fail setup if cleanup fails, just log warning
	}

	// Setup both package and image pipelines
	pipelineTypes := []PipelineType{TypePackage, TypeImage}

	for _, pipelineType := range pipelineTypes {
		pipelineDir, err := GetPipelineDir(ctx, pipelineType)
		if err != nil {
			return fmt.Errorf("failed to get %s pipeline directory: %w", pipelineType, err)
		}

		// Ensure pipeline directory exists
		_, err = os.Stat(pipelineDir)
		if errors.Is(err, os.ErrNotExist) {
			logger.Info("pipeline directory doesn't exist, creating it",
				zap.String("type", string(pipelineType)),
				zap.String("dir", pipelineDir))

			if err := os.MkdirAll(pipelineDir, 0o755); err != nil {
				return fmt.Errorf("failed to create %s pipeline directory: %w", pipelineType, err)
			}
		} else if err != nil {
			return fmt.Errorf("failed to check if %s pipeline directory exists: %w", pipelineType, err)
		}

		// Always sync pipelines from database to ensure filesystem is up to date
		// This ensures pipelines added via seed data or other means are synced on startup
		logger.Info("syncing pipelines from database to filesystem",
			zap.String("type", string(pipelineType)),
			zap.String("dir", pipelineDir))
		if err := syncPipelinesToDirectory(ctx, pipelineType); err != nil {
			return fmt.Errorf("failed to sync %s pipelines to local directory: %w", pipelineType, err)
		}
	}

	// Load reserved pipelines for package pipelines
	logger.Info("loading reserved package pipelines from GitHub")
	if err := LoadReservedPipelines(ctx, logger); err != nil {
		return fmt.Errorf("failed to load reserved package pipelines: %w", err)
	}

	return nil
}

// syncPipelinesToDirectory writes all pipelines from the database to the
// persistent directory
func syncPipelinesToDirectory(ctx context.Context, pipelineType PipelineType) error {
	pipelines, err := getPipelines(ctx, pipelineType)
	if err != nil {
		return fmt.Errorf("failed to get all pipelines: %w", err)
	}

	for _, p := range pipelines {
		if err := SyncPipelineToDirectory(ctx, &p); err != nil {
			return fmt.Errorf("failed to sync pipeline %s: %w", p.Path, err)
		}
	}

	return nil
}

// getPipelines fetches all pipelines from the database for a given type
func getPipelines(ctx context.Context, pipelineType PipelineType) ([]Pipeline, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, pipeline_type, path, yaml_content, description, created_at, updated_at
		FROM pipeline
		WHERE pipeline_type = $1
		ORDER BY created_at DESC
	`

	rows, err := conn.Query(ctx, query, string(pipelineType))
	if err != nil {
		return nil, fmt.Errorf("failed to query pipelines: %w", err)
	}
	defer rows.Close()

	var pipelines []Pipeline
	for rows.Next() {
		var pipeline Pipeline
		var description sql.NullString
		if err := rows.Scan(&pipeline.ID, &pipeline.Type, &pipeline.Path, &pipeline.YAMLContent, &description, &pipeline.CreatedAt, &pipeline.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan pipeline: %w", err)
		}
		if description.Valid {
			pipeline.Description = description.String
		}

		pipelines = append(pipelines, pipeline)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating pipelines: %w", err)
	}

	return pipelines, nil
}

// DeletePipelineFromDirectory removes a pipeline from the local filesystem
func DeletePipelineFromDirectory(ctx context.Context, pipelineType PipelineType, path string) error {
	pipelineDir, err := GetPipelineDir(ctx, pipelineType)
	if err != nil {
		return fmt.Errorf("failed to get pipeline directory: %w", err)
	}

	pipelineFile := filepath.Join(pipelineDir, path+".yaml")
	if err := os.Remove(pipelineFile); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete %s pipeline file %s: %w", pipelineType, pipelineFile, err)
	}

	return nil
}
