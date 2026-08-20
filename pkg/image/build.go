package image

import (
	"context"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

var DefaultImageBuildTimeout = time.Minute * 30

// CreateImageBuild creates a new image build record
func CreateImageBuild(ctx context.Context, imageApkoVersionID string) (*types.ImageBuild, error) {
	if err := imageApkoVersionExists(ctx, imageApkoVersionID); err != nil {
		return nil, fmt.Errorf("failed to verify image_apko_version: %s exists: %w", imageApkoVersionID, err)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	id, err := securerandom.Hex(24)
	if err != nil {
		return nil, fmt.Errorf("failed to create image build ID: %w", err)
	}

	timeoutAt := time.Now().Add(DefaultImageBuildTimeout).UTC()

	logger.Debug("creating image build",
		zap.String("id", id),
		zap.String("imageApkoVersionID", imageApkoVersionID),
		zap.String("timeoutAt", timeoutAt.Format(time.RFC3339)),
	)

	query := `
		INSERT INTO image_build (id, image_apko_version_id, status, created_at, timeout_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`

	row := conn.QueryRow(ctx, query, id, imageApkoVersionID, types.ImageBuildStatusPending, time.Now().UTC(), timeoutAt)

	var imageBuild types.ImageBuild
	err = row.Scan(&imageBuild.ID, &imageBuild.CreatedAt)
	if err != nil {
		return nil, err
	}

	return &imageBuild, nil
}

// imageApkoVersionExists checks if an image_apko_version exists and is linked
// to a valid image.  If this query returns no rows we can assume the
// image_apko_version is orphaned and should not be used to create a build.
func imageApkoVersionExists(ctx context.Context, imageApkoVersionID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT 1
		FROM image_apko_version iav
		INNER JOIN image_apko ia ON iav.image_apko_id = ia.id
		INNER JOIN image i ON ia.image_id = i.id
		WHERE iav.id = $1
	`

	var exists int
	err := conn.QueryRow(ctx, query, imageApkoVersionID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("failed to check if image_apko_version exists: %w", err)
	}

	return nil
}

// UpdateImageBuildStatus updates the status of an image build and optionally sets worker error
func UpdateImageBuildStatus(ctx context.Context, buildID string, status types.ImageBuildStatus, workerError ...error) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	var args []interface{}

	if len(workerError) > 0 && workerError[0] != nil {
		query = `
			UPDATE image_build
			SET status = $1, worker_error = $2
			WHERE id = $3 AND status <> 'failed'
		`
		args = []interface{}{status, workerError[0].Error(), buildID}
	} else {
		query = `
			UPDATE image_build
			SET status = $1
			WHERE id = $2 AND status <> 'failed'
		`
		args = []interface{}{status, buildID}
	}

	_, err := conn.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to update image build status: %w", err)
	}

	return nil
}

// UpdateImageBuildStatusIfCurrent updates a build only if it is still in the
// expected status. This prevents a delayed producer update from overwriting a
// status already advanced by a worker.
func UpdateImageBuildStatusIfCurrent(ctx context.Context, buildID string, current, next types.ImageBuildStatus) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	_, err := conn.Exec(ctx, `
		UPDATE image_build
		SET status = $1
		WHERE id = $2 AND status = $3
	`, next, buildID, current)
	if err != nil {
		return fmt.Errorf("failed to conditionally update image build status: %w", err)
	}

	return nil
}

// GetImageBuildStatus retrieves the status of an image build
func GetImageBuildStatus(ctx context.Context, buildID string) (types.ImageBuildStatus, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT status FROM image_build WHERE id = $1
	`

	row := conn.QueryRow(ctx, query, buildID)
	var status types.ImageBuildStatus
	err := row.Scan(&status)
	if err != nil {
		return "", err
	}

	return status, nil
}

// GetImageBuildIDsWithStatuses retrieves all image build IDs that match any of the provided statuses.
func GetImageBuildIDsWithStatuses(ctx context.Context, statuses []types.ImageBuildStatus) ([]string, error) {
	if len(statuses) == 0 {
		return nil, nil
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id FROM image_build
		WHERE status = ANY($1::text[])
	`

	statusStrings := make([]string, len(statuses))
	for i, status := range statuses {
		statusStrings[i] = string(status)
	}

	rows, err := conn.Query(ctx, query, statusStrings)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var buildIDs []string
	for rows.Next() {
		var buildID string
		err := rows.Scan(&buildID)
		if err != nil {
			return nil, err
		}
		buildIDs = append(buildIDs, buildID)
	}

	return buildIDs, nil
}

// GetTimedOutImageBuilds retrieves all image builds that have timed out
// Checks all active statuses (building, testing, publishing) since builds can get stuck in any of these states
func GetTimedOutImageBuilds(ctx context.Context) ([]string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id FROM image_build
		WHERE status IN ('building', 'testing', 'publishing')
		AND timeout_at < NOW()
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var buildIDs []string
	for rows.Next() {
		var buildID string
		err := rows.Scan(&buildID)
		if err != nil {
			return nil, err
		}
		buildIDs = append(buildIDs, buildID)
	}

	return buildIDs, nil
}

// SetImageBuildStartedAt sets the build started timestamp
func SetImageBuildStartedAt(ctx context.Context, buildID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		UPDATE image_build
		SET build_started_at = NOW()
		WHERE id = $1
	`

	_, err := conn.Exec(ctx, query, buildID)
	if err != nil {
		return err
	}

	return nil
}

// SetImageBuildFinishedAt sets the build finished timestamp
func SetImageBuildFinishedAt(ctx context.Context, buildID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		UPDATE image_build
		SET build_finished_at = NOW()
		WHERE id = $1
	`

	_, err := conn.Exec(ctx, query, buildID)
	if err != nil {
		return err
	}

	return nil
}

// GetImageBuildByID retrieves a complete image build record by ID
func GetImageBuildByID(ctx context.Context, buildID string) (*types.ImageBuild, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, image_apko_version_id, status, created_at, timeout_at, builder_id, build_started_at, build_finished_at, worker_error
		FROM image_build
		WHERE id = $1
	`

	row := conn.QueryRow(ctx, query, buildID)
	var imageBuild types.ImageBuild
	err := row.Scan(&imageBuild.ID, &imageBuild.ImageApkoVersionID, &imageBuild.Status, &imageBuild.CreatedAt, &imageBuild.TimeoutAt, &imageBuild.BuilderID, &imageBuild.BuildStartedAt, &imageBuild.BuildFinishedAt, &imageBuild.WorkerError)
	if err != nil {
		return nil, err
	}

	return &imageBuild, nil
}

// GetImageBuildsByImageApkoVersionID retrieves all build records for a specific image apko version
func GetImageBuildsByImageApkoVersionID(ctx context.Context, imageApkoVersionID string) ([]*types.ImageBuild, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, image_apko_version_id, status, created_at, timeout_at, builder_id, build_started_at, build_finished_at, worker_error
		FROM image_build
		WHERE image_apko_version_id = $1
		ORDER BY created_at DESC
	`

	rows, err := conn.Query(ctx, query, imageApkoVersionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var imageBuilds []*types.ImageBuild
	for rows.Next() {
		var imageBuild types.ImageBuild
		err := rows.Scan(&imageBuild.ID, &imageBuild.ImageApkoVersionID, &imageBuild.Status, &imageBuild.CreatedAt, &imageBuild.TimeoutAt, &imageBuild.BuilderID, &imageBuild.BuildStartedAt, &imageBuild.BuildFinishedAt, &imageBuild.WorkerError)
		if err != nil {
			return nil, err
		}
		imageBuilds = append(imageBuilds, &imageBuild)
	}

	return imageBuilds, nil
}

// GetLatestImageBuildByImageApkoVersionID retrieves the most recent build for a specific image apko version
func GetLatestImageBuildByImageApkoVersionID(ctx context.Context, imageApkoVersionID string) (*types.ImageBuild, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, image_apko_version_id, status, created_at, timeout_at, builder_id, build_started_at, build_finished_at, worker_error
		FROM image_build
		WHERE image_apko_version_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`

	row := conn.QueryRow(ctx, query, imageApkoVersionID)
	var imageBuild types.ImageBuild
	err := row.Scan(&imageBuild.ID, &imageBuild.ImageApkoVersionID, &imageBuild.Status, &imageBuild.CreatedAt, &imageBuild.TimeoutAt, &imageBuild.BuilderID, &imageBuild.BuildStartedAt, &imageBuild.BuildFinishedAt, &imageBuild.WorkerError)
	if err != nil {
		return nil, err
	}

	return &imageBuild, nil
}

// UpdateImageBuildStdout updates the stdout for a specific process in the image build
func UpdateImageBuildStdout(ctx context.Context, buildID string, process string, stdout string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	switch process {
	case "apko":
		query = `UPDATE image_build SET apko_stdout = $1 WHERE id = $2`
	case "builder":
		query = `UPDATE image_build SET builder_stdout = $1 WHERE id = $2`
	default:
		return fmt.Errorf("unknown process: %s", process)
	}

	_, err := conn.Exec(ctx, query, stdout, buildID)
	return err
}

// UpdateImageBuildStderr updates the stderr for a specific process in the image build
func UpdateImageBuildStderr(ctx context.Context, buildID string, process string, stderr string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	switch process {
	case "apko":
		query = `UPDATE image_build SET apko_stderr = $1 WHERE id = $2`
	case "grype_aarch64":
		query = `UPDATE image_build SET grype_aarch64_stderr = $1 WHERE id = $2`
	case "grype_x86_64":
		query = `UPDATE image_build SET grype_x86_64_stderr = $1 WHERE id = $2`
	case "grype_alternate_aarch64":
		query = `UPDATE image_build SET grype_alternate_aarch64_stderr = $1 WHERE id = $2`
	case "grype_alternate_x86_64":
		query = `UPDATE image_build SET grype_alternate_x86_64_stderr = $1 WHERE id = $2`
	default:
		return fmt.Errorf("unknown process: %s", process)
	}

	_, err := conn.Exec(ctx, query, stderr, buildID)
	return err
}

// SetImageBuildBuilderID sets the builder ID for an image build
func SetImageBuildBuilderID(ctx context.Context, buildID string, builderID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		UPDATE image_build
		SET builder_id = $1
		WHERE id = $2
	`

	_, err := conn.Exec(ctx, query, builderID, buildID)
	if err != nil {
		return err
	}

	return nil
}
