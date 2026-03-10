package listener

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/pipeline"
	"go.uber.org/zap"
)

type PipelineSyncPayload struct {
	Path      string `json:"path"`              // Pipeline path (e.g., "tests/basic-test" for packages, "tests/basic-execution" for images)
	OldPath   string `json:"oldPath,omitempty"` // For updates: original path before change
	Operation string `json:"operation"`         // "create", "update", or "delete"
	Type      string `json:"type"`              // "package" or "image" - determines which pipeline system to use
}

func handlePipelineSync(ctx context.Context, payload string) error {
	logger.Debug("Received pipeline sync", zap.String("payload", payload))

	var p PipelineSyncPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		logger.Error(err)
		return fmt.Errorf("failed to unmarshal pipeline sync payload: %w", err)
	}

	// Type field is now required to distinguish between package and image pipelines
	if p.Type == "" {
		return fmt.Errorf("pipeline sync payload missing required 'type' field")
	}
	if p.Path == "" {
		return fmt.Errorf("pipeline sync payload missing required 'path' field")
	}

	pipelineType := p.Type

	logger.Debug("handling pipeline sync",
		zap.String("type", pipelineType),
		zap.String("operation", p.Operation))

	// Dispatch to appropriate pipeline manager based on type
	if err := syncPipeline(ctx, &p); err != nil {
		return err
	}

	// After syncing to local directory, trigger GitHub sync
	if err := persistence.EnqueueWork(ctx, "github_sync", map[string]interface{}{}); err != nil {
		logger.Warn("failed to enqueue github_sync", zap.Error(err))
		// Don't fail the entire operation if github sync queueing fails
	}

	return nil
}

// syncPipeline handles syncing of both package and image pipelines using a unified approach
func syncPipeline(ctx context.Context, p *PipelineSyncPayload) error {
	// Convert string type to PipelineType
	var pipelineType pipeline.PipelineType
	switch p.Type {
	case "package":
		pipelineType = pipeline.TypePackage
	case "image":
		pipelineType = pipeline.TypeImage
	default:
		return fmt.Errorf("unknown pipeline type: %s", p.Type)
	}

	switch p.Operation {
	case "create", "update":
		// For updates: if path changed, remove the old file first
		if p.Operation == "update" && p.OldPath != "" && p.OldPath != p.Path {
			if err := pipeline.DeletePipelineFromDirectory(ctx, pipelineType, p.OldPath); err != nil {
				logger.Warn("failed to delete old pipeline file during update",
					zap.String("type", p.Type),
					zap.String("oldPath", p.OldPath),
					zap.Error(err))
				// Don't fail the entire operation - continue with the sync
			} else {
				logger.Debug("deleted old pipeline file during update",
					zap.String("type", p.Type),
					zap.String("oldPath", p.OldPath))
			}
		}

		// Fetch the pipeline from database
		pl, err := pipeline.GetPipeline(ctx, pipelineType, p.Path)
		if err != nil {
			logger.Error(err)
			return fmt.Errorf("failed to get %s pipeline %s: %w", p.Type, p.Path, err)
		}

		// Sync to local directory
		if err := pipeline.SyncPipelineToDirectory(ctx, pl); err != nil {
			logger.Error(err)
			return fmt.Errorf("failed to sync %s pipeline to directory: %w", p.Type, err)
		}

		logger.Debug("synced pipeline to local directory",
			zap.String("type", p.Type),
			zap.String("path", p.Path),
			zap.String("operation", p.Operation))

	case "delete":
		// Remove from local directory
		if err := pipeline.DeletePipelineFromDirectory(ctx, pipelineType, p.Path); err != nil {
			logger.Error(err)
			return fmt.Errorf("failed to delete %s pipeline from directory: %w", p.Type, err)
		}

		logger.Debug("removed pipeline from local directory",
			zap.String("type", p.Type),
			zap.String("path", p.Path))

	default:
		return fmt.Errorf("unknown pipeline sync operation: %s", p.Operation)
	}

	return nil
}
