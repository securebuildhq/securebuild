package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/securebuildhq/securebuild/pkg/param"
	"go.uber.org/zap"
)

// hasIncorrectlyPlacedPipelineFiles checks if there are any files or directories
// in the pipeline root directory that are not "packages" or "images"
func hasIncorrectlyPlacedPipelineFiles(pipelineDir string) (bool, error) {
	entries, err := os.ReadDir(pipelineDir)
	if err != nil {
		return false, fmt.Errorf("failed to read pipeline directory: %w", err)
	}

	for _, entry := range entries {
		name := entry.Name()

		// Skip the expected subdirectories
		if name == "packages" || name == "images" {
			continue
		}

		// If we found anything else, there are incorrectly placed files
		return true, nil
	}

	return false, nil
}

// cleanupIncorrectPipelineFiles removes pipeline files that are stored directly
// in the root pipeline directory instead of in the correct packages/ or images/ subdirectories.
// This cleanup is needed due to a previous bug that placed files incorrectly.
// This function is idempotent - if there are no incorrectly placed files, it does nothing.
func cleanupIncorrectPipelineFiles(ctx context.Context, logger *zap.Logger) error {
	p := param.GetParam(ctx)
	if p.PipelineDir == "" {
		logger.Debug("pipeline directory not configured, skipping cleanup")
		return nil
	}

	// Check if root pipeline directory exists
	if _, err := os.Stat(p.PipelineDir); os.IsNotExist(err) {
		logger.Debug("pipeline directory does not exist, skipping cleanup")
		return nil
	}

	// Check if there are any incorrectly placed files/directories
	// If not, cleanup has already been done or isn't needed
	hasIncorrectFiles, err := hasIncorrectlyPlacedPipelineFiles(p.PipelineDir)
	if err != nil {
		return fmt.Errorf("failed to check for incorrectly placed files: %w", err)
	}
	if !hasIncorrectFiles {
		logger.Debug("no incorrectly placed pipeline files found, skipping cleanup")
		return nil
	}

	logger.Info("cleaning up incorrectly placed pipeline files", zap.String("dir", p.PipelineDir))

	// Walk the root pipeline directory
	return filepath.Walk(p.PipelineDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return fmt.Errorf("error walking pipeline directory: %w", err)
		}

		// Skip the root directory itself
		if path == p.PipelineDir {
			return nil
		}

		// Get relative path from root
		relPath, err := filepath.Rel(p.PipelineDir, path)
		if err != nil {
			return fmt.Errorf("failed to get relative path: %w", err)
		}

		// Check if this is a direct child of the root directory
		pathSegments := strings.Split(relPath, string(filepath.Separator))
		if len(pathSegments) == 0 {
			return nil
		}

		firstSegment := pathSegments[0]

		// If the first segment is NOT "packages" or "images", this file/directory is incorrectly placed
		if firstSegment != "packages" && firstSegment != "images" {
			logger.Debug("removing incorrectly placed pipeline file/directory",
				zap.String("path", path),
				zap.String("relPath", relPath),
				zap.Bool("isDir", info.IsDir()))

			// Remove the incorrectly placed file or directory
			if err := os.RemoveAll(path); err != nil {
				logger.Warn("failed to remove incorrectly placed pipeline file",
					zap.String("path", path),
					zap.Error(err))
				// Continue with cleanup even if one file fails
			} else {
				logger.Debug("successfully removed incorrectly placed pipeline file", zap.String("path", path))
			}

			// If we removed a directory, skip walking into it
			if info.IsDir() {
				return filepath.SkipDir
			}
		}

		return nil
	})
}
