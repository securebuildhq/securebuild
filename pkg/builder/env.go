package builder

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

//go:embed filesystem/**
var embeddedFS embed.FS

func EmbeddedFS() embed.FS {
	return embeddedFS
}

func CopyEmbeddedFS(dest string) error {
	err := fs.WalkDir(EmbeddedFS(), "filesystem", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			logger.Debug("walk error", zap.String("path", path), zap.Error(walkErr))
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		// Compute the destination path
		relPath := strings.TrimPrefix(path, "filesystem/")
		destPath := filepath.Join(dest, relPath)

		// Create parent directories
		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			logger.Debug("error creating directory", zap.String("path", filepath.Dir(destPath)), zap.Error(err))
			return err
		}

		// Read the file content from the embedded FS
		content, err := fs.ReadFile(EmbeddedFS(), path)
		if err != nil {
			logger.Debug("error reading embedded file", zap.String("path", path), zap.Error(err))
			return err
		}

		// Write the file content
		if err := os.WriteFile(destPath, content, 0644); err != nil {
			logger.Debug("error writing file", zap.String("path", destPath), zap.Error(err))
			return err
		}
		return nil
	})
	if err != nil {
		logger.Debug("error during WalkDir", zap.Error(err))
		return err
	}

	return nil
}
