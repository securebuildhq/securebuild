package listener

import (
	"context"
	"encoding/json"
	"fmt"

	image "github.com/securebuildhq/securebuild/pkg/image"
	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

type BuildAPKOPayload struct {
	ImageID string `json:"imageId"`
	APKOID  string `json:"apkoId"`
}

// handleBuildAPKO orchestrates the build process for a single APKO configuration
func handleBuildAPKO(ctx context.Context, payload string) error {
	var buildAPKOPayload BuildAPKOPayload
	if err := json.Unmarshal([]byte(payload), &buildAPKOPayload); err != nil {
		return fmt.Errorf("failed to unmarshal build apko payload: %w", err)
	}

	logger.Info("building single APKO",
		zap.String("imageId", buildAPKOPayload.ImageID),
		zap.String("apkoId", buildAPKOPayload.APKOID))

	img, err := image.GetImage(ctx, buildAPKOPayload.ImageID)
	if err != nil {
		return fmt.Errorf("failed to get image: %w", err)
	}

	// Find the specific APKO to build
	var targetAPKO *imagetypes.ImageAPKO
	for _, apko := range img.APKOs {
		if apko.ID == buildAPKOPayload.APKOID {
			targetAPKO = apko
			break
		}
	}

	if targetAPKO == nil {
		return fmt.Errorf("APKO with ID %s not found in image %s", buildAPKOPayload.APKOID, buildAPKOPayload.ImageID)
	}

	// Create image build record for the specific APKO version
	imageBuild, err := image.CreateImageBuild(ctx, targetAPKO.LatestVersion.ID)
	if err != nil {
		return fmt.Errorf("failed to create image build record for APKO %s: %w", targetAPKO.ID, err)
	}

	logger.Debug("created image build record for single APKO",
		zap.String("buildID", imageBuild.ID),
		zap.String("imageApkoVersionID", targetAPKO.LatestVersion.ID),
		zap.String("imageName", img.Name),
		zap.String("apkoID", targetAPKO.ID))

	// Update status to queued
	if err := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusQueued); err != nil {
		logger.Warn("failed to update image build status to queued", zap.Error(err))
	}

	// Assign VM for image building
	vmID, workDir, err := assignVMForImageBuild(ctx, imageBuild.ID)
	if err != nil {
		logger.Warn("IMAGE BUILD FAILED: VM assignment failure - could not assign VM for image build",
			zap.String("imageApkoVersionID", targetAPKO.LatestVersion.ID),
			zap.String("imageName", img.Name),
			zap.String("buildID", imageBuild.ID),
			zap.String("apkoID", targetAPKO.ID),
			zap.Error(err))

		// Mark build as failed
		if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("VM assignment failure: %w", err)); statusErr != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
		}

		return fmt.Errorf("failed to assign VM for build: %w", err)
	}

	// Update build record with VM ID
	if err := image.SetImageBuildBuilderID(ctx, imageBuild.ID, vmID); err != nil {
		logger.Warn("failed to set image build builder ID", zap.Error(err))
	}

	// Queue the image building with VM assigned
	buildImageWithVMAssignedPayload := BuildImageWithVMAssignedPayload{
		VMID:    vmID,
		BuildID: imageBuild.ID,
		WorkDir: workDir,
	}

	marshalledPayload, err := json.Marshal(buildImageWithVMAssignedPayload)
	if err != nil {
		// Mark build as failed
		if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("JSON marshalling failure: %w", err)); statusErr != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
		}
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	if err := persistence.EnqueueWork(ctx, "build_image_with_vm_assigned", string(marshalledPayload)); err != nil {
		// Mark build as failed
		if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("work queue enqueue failure: %w", err)); statusErr != nil {
			logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
		}
		return fmt.Errorf("failed to enqueue work: %w", err)
	}

	return nil
}
