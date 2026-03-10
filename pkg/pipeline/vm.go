package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/securebuildhq/securebuild/pkg/builder"
	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
	"golang.org/x/crypto/ssh"
)

// CopyAllPipelinesToVM copies all pipeline types to the VM
func CopyAllPipelinesToVM(ctx context.Context, client *ssh.Client, vm *buildertypes.BuilderVM) error {
	// Copy all pipeline types to VM
	pipelineTypes := []PipelineType{
		TypePackage,
		TypeImage,
	}

	for _, pipelineType := range pipelineTypes {
		if err := CopyPipelineTypeToVM(ctx, client, vm, pipelineType); err != nil {
			return fmt.Errorf("failed to copy %s pipelines: %w", pipelineType, err)
		}
	}

	return nil
}

// CopyPipelineTypeToVM copies a specific pipeline type to the VM
func CopyPipelineTypeToVM(ctx context.Context, client *ssh.Client, vm *buildertypes.BuilderVM, pipelineType PipelineType) error {
	localPipelineDir, err := GetPipelineDir(ctx, pipelineType)
	if err != nil {
		return fmt.Errorf("failed to get pipeline directory: %w", err)
	}

	// Check if there are any pipeline files to copy
	entries, err := os.ReadDir(localPipelineDir)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to read pipeline directory: %w", err)
	}

	if len(entries) == 0 {
		logger.Debug("no pipeline files to copy to VM", zap.String("type", string(pipelineType)))
		return nil
	}

	logger.Info("copying pipeline directory to VM",
		zap.String("type", string(pipelineType)),
		zap.Int("files", len(entries)),
		zap.String("vmID", vm.ID),
		zap.String("localDir", localPipelineDir))

	// Determine remote path based on pipeline type
	var remotePipelineDir string
	switch pipelineType {
	case TypePackage:
		remotePipelineDir = "/home/builder/pipelines/packages"
	case TypeImage:
		remotePipelineDir = "/home/builder/pipelines/images"
	default:
		return fmt.Errorf("unsupported pipeline type: %s", pipelineType)
	}

	// Create the pipelines directory on VM
	if err := builder.CreateRemoteDirectory(ctx, client, vm.ID, remotePipelineDir); err != nil {
		return fmt.Errorf("failed to create pipelines directory: %w", err)
	}

	// Copy entire pipeline directory structure to VM
	err = filepath.Walk(localPipelineDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip the root directory
		if path == localPipelineDir {
			return nil
		}

		// Skip reserved_pipelines.txt cache file (used only for validation, not for builds)
		if !info.IsDir() && info.Name() == "reserved_pipelines.txt" {
			return nil
		}

		// Get relative path from pipeline dir
		relPath, err := filepath.Rel(localPipelineDir, path)
		if err != nil {
			return fmt.Errorf("failed to get relative path: %w", err)
		}

		remotePath := filepath.Join(remotePipelineDir, relPath)

		if info.IsDir() {
			// Create remote directory
			if err := builder.CreateRemoteDirectory(ctx, client, vm.ID, remotePath); err != nil {
				return fmt.Errorf("failed to create remote directory %s: %w", remotePath, err)
			}
		} else {
			// Copy file content
			content, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("failed to read local pipeline file %s: %w", path, err)
			}

			if err := builder.CreateRemoteTextFile(client, remotePath, string(content)); err != nil {
				return fmt.Errorf("failed to write remote pipeline file %s: %w", remotePath, err)
			}

			logger.Debug("copied pipeline file to VM",
				zap.String("type", string(pipelineType)),
				zap.String("vmID", vm.ID),
				zap.String("localPath", path),
				zap.String("remotePath", remotePath))
		}

		return nil
	})
	if err != nil {
		return fmt.Errorf("failed to walk pipeline directory: %w", err)
	}

	logger.Info("successfully copied pipelines to VM",
		zap.String("type", string(pipelineType)),
		zap.String("vmID", vm.ID))
	return nil
}
