package listener

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/pkg/errors"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

type CreatePackagePayload struct {
	ID string `json:"id"`
}

func handleCreatePackage(ctx context.Context, payload string) error {
	logger.Debug("Received create package", zap.String("payload", payload))

	var p CreatePackagePayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		logger.Error(err)
		return fmt.Errorf("failed to unmarshal create package payload: %w", err)
	}

	createPackage, err := sbpackage.GetCreatePackage(ctx, p.ID)
	if err != nil {
		logger.Error(err)
		return fmt.Errorf("failed to get create package: %w", err)
	}

	// Use the pre-generated package ID
	pkg, versionID, err := sbpackage.ImportPackage(ctx, []byte(createPackage.MelangeYaml), createPackage.AdditionalFilesData, createPackage.UseRoot, createPackage.CustomDiskSize, createPackage.PackageID)
	if err != nil {
		if !errors.Is(err, sbpackage.ErrPackageAlreadyExists) && !errors.Is(err, sbpackage.ErrPackageMissingDependencies) {
			return fmt.Errorf("failed to import melange yaml: %w", err)
		}

		// Delete the pending package since we're not processing it
		if deleteErr := sbpackage.DeletePendingPackage(ctx, createPackage.PackageID); deleteErr != nil {
			logger.Error(fmt.Errorf("failed to delete pending package during cleanup: %w", deleteErr))
		}

		return errors.Wrap(err, "conflict during package import")
	}

	if err := sbpackage.DeleteCreatePackage(ctx, p.ID); err != nil {
		return fmt.Errorf("failed to delete create package: %w", err)
	}

	// queue the create package by writing to the work_queue table
	cause := "create new package"
	causeID := ""
	if createPackage.CreatedByUserName != "" {
		cause = fmt.Sprintf("new package by %s", createPackage.CreatedByUserName)
	}
	if createPackage.CreatedByUserID != "" {
		causeID = createPackage.CreatedByUserID
	}

	// If version ID is empty, get the latest version
	packageVersionID := versionID
	if packageVersionID == "" {
		latestVersion, err := sbpackage.GetLatestPackageVersion(ctx, pkg.ID)
		if err != nil {
			logger.Error(err)
			return fmt.Errorf("failed to get latest package version: %w", err)
		}
		packageVersionID = latestVersion.ID
	}

	buildPackagePayload := BuildPackagePayload{
		PackageID:        pkg.ID,
		PackageVersionID: packageVersionID,
		Cause:            cause,
		CauseID:          causeID,
	}
	buildPackagePayloadBytes, err := json.Marshal(buildPackagePayload)
	if err != nil {
		return fmt.Errorf("failed to marshal build package payload: %w", err)
	}
	if err := persistence.EnqueueWork(ctx, "build_package", buildPackagePayloadBytes); err != nil {
		return fmt.Errorf("failed to enqueue work: %w", err)
	}

	return nil
}
