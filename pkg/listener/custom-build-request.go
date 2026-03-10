package listener

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackagetypes "github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

type CustomBuildRequestPayload struct {
	BuildRequestID string `json:"build_request_id"`
}

// CustomBuildRequest represents a custom build request record from the database
type CustomBuildRequest struct {
	ID        string
	TeamID    string
	ImageName string
	ImageTag  string
	CommitSHA string
	Status    string
	Error     *string
}

// HandleCustomBuildRequest processes a custom build request by creating execution records
// for all package versions associated with it and enqueueing builds
func HandleCustomBuildRequest(ctx context.Context, payload string) error {
	logger.Debug("handling custom build request", zap.String("payload", payload))

	// Parse payload
	var req CustomBuildRequestPayload
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		return fmt.Errorf("failed to unmarshal custom build request payload: %w", err)
	}

	logger.Info("processing custom build request", zap.String("buildRequestID", req.BuildRequestID))

	// Fetch build request
	buildRequest, err := getCustomBuildRequest(ctx, req.BuildRequestID)
	if err != nil {
		return fmt.Errorf("failed to get custom build request: %w", err)
	}

	// package_version and image_apko_version were already created synchronously in the API
	// with custom_build_request_id set on them
	// Now we just need to find them and create execution records

	// Find package versions created for this custom build request
	packageVersions, err := getPackageVersionsByCustomBuildRequestID(ctx, buildRequest.ID)
	if err != nil {
		updateCustomBuildRequestError(ctx, buildRequest.ID, "failed", fmt.Sprintf("failed to get package versions: %v", err))
		return fmt.Errorf("failed to get package versions: %w", err)
	}

	logger.Info("found package versions for custom build request",
		zap.String("buildRequestID", buildRequest.ID),
		zap.Int("count", len(packageVersions)))

	// Enqueue builds for each package version
	// The build_package handler will create execution records automatically
	for _, pkgVersion := range packageVersions {
		logger.Debug("enqueueing build for package version",
			zap.String("packageVersionID", pkgVersion.ID),
			zap.String("packageID", pkgVersion.PackageID),
			zap.String("version", pkgVersion.Version))

		// Trigger regular package build using standard "build_package" event
		// The handler expects packageId and packageVersionId, and will create its own execution
		buildPayload := BuildPackagePayload{
			PackageID:        pkgVersion.PackageID,
			PackageVersionID: pkgVersion.ID,
			Cause:            "custom_build_request",
			CauseID:          buildRequest.ID,
		}

		marshalledPayload, err := json.Marshal(buildPayload)
		if err != nil {
			updateCustomBuildRequestError(ctx, buildRequest.ID, "failed", fmt.Sprintf("failed to marshal build payload: %v", err))
			return fmt.Errorf("failed to marshal build package payload: %w", err)
		}

		if err := persistence.EnqueueWork(ctx, "build_package", string(marshalledPayload)); err != nil {
			updateCustomBuildRequestError(ctx, buildRequest.ID, "failed", fmt.Sprintf("failed to enqueue build: %v", err))
			return fmt.Errorf("failed to enqueue build package work: %w", err)
		}

		logger.Info("enqueued build_package for custom build request",
			zap.String("packageID", pkgVersion.PackageID),
			zap.String("packageVersionID", pkgVersion.ID),
			zap.String("buildRequestID", buildRequest.ID))
	}

	// Update status to empty string now that we've successfully queued the builds
	// (empty string means aggregate status from builds)
	if err := updateCustomBuildRequestStatus(ctx, buildRequest.ID, ""); err != nil {
		logger.Warn("failed to update custom build request status to empty", zap.Error(err))
	}

	logger.Info("custom build request processing completed successfully",
		zap.String("buildRequestID", buildRequest.ID),
		zap.Int("packagesQueued", len(packageVersions)))

	return nil
}

// getCustomBuildRequest fetches a custom build request from the database
func getCustomBuildRequest(ctx context.Context, buildRequestID string) (*CustomBuildRequest, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, team_id, image_name, image_tag, commit_sha, status, error
		FROM custom_build_request
		WHERE id = $1
	`

	row := conn.QueryRow(ctx, query, buildRequestID)

	var buildRequest CustomBuildRequest
	if err := row.Scan(
		&buildRequest.ID,
		&buildRequest.TeamID,
		&buildRequest.ImageName,
		&buildRequest.ImageTag,
		&buildRequest.CommitSHA,
		&buildRequest.Status,
		&buildRequest.Error,
	); err != nil {
		return nil, fmt.Errorf("failed to scan custom build request: %w", err)
	}

	return &buildRequest, nil
}

// getPackageVersionsByCustomBuildRequestID finds all package versions associated with a custom build request
func getPackageVersionsByCustomBuildRequestID(ctx context.Context, customBuildRequestID string) ([]sbpackagetypes.PackageVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT pv.id, pv.package_id, pv.version, pv.apk_release, pv.use_root,
		       pv.bootstrap_enabled, pv.melange_yaml
		FROM package_version pv
		WHERE pv.custom_build_request_id = $1
		ORDER BY pv.created_at ASC
	`

	rows, err := conn.Query(ctx, query, customBuildRequestID)
	if err != nil {
		return nil, fmt.Errorf("failed to query package versions: %w", err)
	}
	defer rows.Close()

	var packageVersions []sbpackagetypes.PackageVersion
	for rows.Next() {
		var pv sbpackagetypes.PackageVersion
		if err := rows.Scan(
			&pv.ID,
			&pv.PackageID,
			&pv.Version,
			&pv.APKRelease,
			&pv.UseRoot,
			&pv.BootstrapEnabled,
			&pv.MelangeYaml,
		); err != nil {
			return nil, fmt.Errorf("failed to scan package version: %w", err)
		}
		packageVersions = append(packageVersions, pv)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating package versions: %w", err)
	}

	return packageVersions, nil
}

// updateCustomBuildRequestStatus updates the status of a custom build request
func updateCustomBuildRequestStatus(ctx context.Context, buildRequestID string, status string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		UPDATE custom_build_request
		SET status = $1
		WHERE id = $2
	`

	_, err := conn.Exec(ctx, query, status, buildRequestID)
	if err != nil {
		return fmt.Errorf("failed to update custom build request status: %w", err)
	}

	logger.Info("updated custom build request status",
		zap.String("buildRequestID", buildRequestID),
		zap.String("status", status))

	return nil
}

// updateCustomBuildRequestError updates the status and error message of a custom build request
func updateCustomBuildRequestError(ctx context.Context, buildRequestID string, status string, errorMsg string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		UPDATE custom_build_request
		SET status = $1, error = $2
		WHERE id = $3
	`

	_, err := conn.Exec(ctx, query, status, errorMsg, buildRequestID)
	if err != nil {
		// Log the error but don't return it to avoid cascading errors
		logger.Warn("failed to update custom build request error",
			zap.String("buildRequestID", buildRequestID),
			zap.String("status", status),
			zap.String("errorMsg", errorMsg),
			zap.Error(err))
		return fmt.Errorf("failed to update custom build request error: %w", err)
	}

	logger.Warn("updated custom build request with error",
		zap.String("buildRequestID", buildRequestID),
		zap.String("status", status),
		zap.String("error", errorMsg))

	return nil
}
