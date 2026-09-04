package execution

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/execution/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackagetypes "github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

// sanitizeOutput removes null bytes and other invalid UTF-8 sequences that would cause PostgreSQL errors
func sanitizeOutput(input string) string {
	// Remove null bytes which are invalid in PostgreSQL UTF-8
	sanitized := strings.ReplaceAll(input, "\x00", "")

	// Ensure the string is valid UTF-8 by replacing invalid sequences
	if !utf8.ValidString(sanitized) {
		// Convert to valid UTF-8, replacing invalid sequences with replacement character
		sanitized = strings.ToValidUTF8(sanitized, "")
	}

	return sanitized
}

func GetExecutionBuildStatusUpdatedAt(ctx context.Context, executionID string, arch string) (*time.Time, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := ""

	if arch == "x86_64" {
		query = `
			SELECT x86_64_status_updated_at FROM execution WHERE id = $1
		`
	} else if arch == "aarch64" {
		query = `
			SELECT aarch64_status_updated_at FROM execution WHERE id = $1
		`
	} else {
		return nil, fmt.Errorf("invalid architecture: %s", arch)
	}

	row := conn.QueryRow(ctx, query, executionID)
	var updatedAt sql.NullTime
	err := row.Scan(&updatedAt)
	if err != nil {
		return nil, err
	}

	if !updatedAt.Valid {
		return nil, nil
	}

	return &updatedAt.Time, nil
}

// GetExecutionRepositoryVerifiedAt returns when the public repository was
// verified to contain the execution's complete publication manifest.
func GetExecutionRepositoryVerifiedAt(ctx context.Context, executionID string, arch string) (*time.Time, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	switch arch {
	case "x86_64":
		query = `SELECT x86_64_repository_verified_at FROM execution WHERE id = $1`
	case "aarch64":
		query = `SELECT aarch64_repository_verified_at FROM execution WHERE id = $1`
	default:
		return nil, fmt.Errorf("invalid architecture: %s", arch)
	}

	var verifiedAt sql.NullTime
	if err := conn.QueryRow(ctx, query, executionID).Scan(&verifiedAt); err != nil {
		return nil, err
	}
	if !verifiedAt.Valid {
		return nil, nil
	}

	return &verifiedAt.Time, nil
}

// MarkExecutionRepositoryVerified records the final publication boundary. It
// must only be called after the public APKINDEX and every APK in the manifest
// have been fetched and verified.
func MarkExecutionRepositoryVerified(ctx context.Context, executionID string, arch string) error {
	var query string
	switch arch {
	case "x86_64":
		query = `UPDATE execution SET x86_64_repository_verified_at = COALESCE(x86_64_repository_verified_at, NOW()) WHERE id = $1`
	case "aarch64":
		query = `UPDATE execution SET aarch64_repository_verified_at = COALESCE(aarch64_repository_verified_at, NOW()) WHERE id = $1`
	default:
		return fmt.Errorf("invalid architecture: %s", arch)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	_, err := conn.Exec(ctx, query, executionID)
	return err
}

func ExecutionRequiresRepositoryPublication(ctx context.Context, executionID string) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var required bool
	if err := conn.QueryRow(ctx, `SELECT repository_publication_required FROM execution WHERE id = $1`, executionID).Scan(&required); err != nil {
		return false, err
	}
	return required, nil
}

// IsLatestExecutionForPackageVersion prevents a stale manifest from an older
// retry from overwriting the artifact selected by a newer execution.
func IsLatestExecutionForPackageVersion(ctx context.Context, executionID string) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var latest bool
	err := conn.QueryRow(ctx, `
		SELECT NOT EXISTS (
			SELECT 1
			FROM execution newer
			WHERE newer.package_version_id = current.package_version_id
			  AND (newer.created_at, newer.id) > (current.created_at, current.id)
			  AND newer.status NOT IN ('failed', 'vm_deleted')
		)
		FROM execution current
		WHERE current.id = $1
	`, executionID).Scan(&latest)
	if err != nil {
		return false, err
	}
	return latest, nil
}

func SetArchStatus(ctx context.Context, executionID string, arch string, status string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now().UTC()
	var query string
	if arch == "x86_64" {
		query = `
			UPDATE execution
			SET x86_64_status = $1, x86_64_status_updated_at = $3
			WHERE id = $2 and x86_64_status <> $1
		`
	} else if arch == "aarch64" {
		query = `
			UPDATE execution
			SET aarch64_status = $1, aarch64_status_updated_at = $3
			WHERE id = $2 and aarch64_status <> $1
		`
	} else {
		return fmt.Errorf("invalid architecture: %s", arch)
	}

	if _, err := conn.Exec(ctx, query, status, executionID, now); err != nil {
		return err
	}

	return nil
}

func GetExecutionIDsWithStatus(ctx context.Context, status types.ExecutionStatus) ([]string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id FROM execution WHERE status = $1
	`

	rows, err := conn.Query(ctx, query, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var executionIDs []string
	for rows.Next() {
		var executionID string
		err := rows.Scan(&executionID)
		if err != nil {
			return nil, err
		}
		executionIDs = append(executionIDs, executionID)
	}

	return executionIDs, nil
}

func GetExecutionUseRoot(ctx context.Context, executionID string) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT use_root FROM execution WHERE id = $1
	`

	row := conn.QueryRow(ctx, query, executionID)
	useRoot := false
	err := row.Scan(&useRoot)
	if err != nil {
		return false, err
	}

	return useRoot, nil
}

func IsExecutionPaused(ctx context.Context) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT value FROM execution_control WHERE key = 'pause'
	`

	row := conn.QueryRow(ctx, query)
	var value sql.NullString
	err := row.Scan(&value)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}

	return value.String == "true", nil
}

func GetExecutionBuildStatus(ctx context.Context, executionID string, arch string) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	if arch == "x86_64" {
		query = `
			SELECT x86_64_status FROM execution WHERE id = $1
		`
	} else if arch == "aarch64" {
		query = `
			SELECT aarch64_status FROM execution WHERE id = $1
		`
	} else {
		return "", fmt.Errorf("invalid architecture: %s", arch)
	}

	row := conn.QueryRow(ctx, query, executionID)
	var status sql.NullString
	err := row.Scan(&status)
	if err != nil {
		return "", err
	}

	if !status.Valid {
		return string(types.ExecutionStatusBuilding), nil
	}

	return status.String, nil
}

func GetExecutionVMIDForArch(ctx context.Context, executionID string, arch string) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	if arch == "x86_64" {
		query = `
			SELECT x86_64_builder_id FROM execution WHERE id = $1
		`
	} else if arch == "aarch64" {
		query = `
			SELECT aarch64_builder_id FROM execution WHERE id = $1
		`
	} else {
		return "", fmt.Errorf("invalid architecture: %s", arch)
	}

	row := conn.QueryRow(ctx, query, executionID)
	var builderID sql.NullString
	err := row.Scan(&builderID)
	if err != nil {
		return "", err
	}

	return builderID.String, nil
}

func GetExcecutionStatusForPackageVersionID(ctx context.Context, packageVersionID string) (types.ExecutionStatus, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT status FROM execution WHERE package_version_id = $1 ORDER BY created_at DESC LIMIT 1
	`

	row := conn.QueryRow(ctx, query, packageVersionID)
	var status types.ExecutionStatus
	err := row.Scan(&status)
	if err != nil {
		if err == pgx.ErrNoRows {
			return types.ExecutionStatusNone, nil
		}
		return types.ExecutionStatusNone, err
	}

	return status, nil
}

func GetPackageVersionIDForExecutionID(ctx context.Context, executionID string) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT package_version_id FROM execution WHERE id = $1
	`

	row := conn.QueryRow(ctx, query, executionID)
	var packageVersionID string
	err := row.Scan(&packageVersionID)
	if err != nil {
		return "", err
	}

	return packageVersionID, nil
}

func GetExecutionStatus(ctx context.Context, executionID string) (types.ExecutionStatus, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT status FROM execution WHERE id = $1
	`

	row := conn.QueryRow(ctx, query, executionID)
	var status types.ExecutionStatus
	err := row.Scan(&status)
	if err != nil {
		return "", err
	}

	return status, nil
}

func GetExecutionTimeoutAt(ctx context.Context, executionID string) (*time.Time, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT timeout_at FROM execution WHERE id = $1
	`

	row := conn.QueryRow(ctx, query, executionID)
	var timeoutAt sql.NullTime
	err := row.Scan(&timeoutAt)
	if err != nil {
		return nil, err
	}

	if !timeoutAt.Valid {
		return nil, nil
	}

	return &timeoutAt.Time, nil
}

func CreateExecution(ctx context.Context, packageID string, pkgVersion *sbpackagetypes.PackageVersion, cause string, causeID string) (*types.Execution, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	id, err := securerandom.Hex(24)
	if err != nil {
		return nil, err
	}

	logger.Debug("creating execution",
		zap.String("id", id),
		zap.String("packageID", packageID),
		zap.String("pkgVersionID", pkgVersion.ID),
		zap.String("versionLabel", pkgVersion.Version),
		zap.Bool("useRoot", pkgVersion.UseRoot),
	)

	query := `
		INSERT INTO execution (id, package_id, package_version_id, version_label, status, created_at, use_root, cause, cause_id, repository_publication_required)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
		RETURNING id, created_at
	`

	row := conn.QueryRow(ctx, query, id, packageID, pkgVersion.ID, pkgVersion.Version, types.ExecutionStatusPending, time.Now().UTC(), pkgVersion.UseRoot, cause, causeID)

	var execution types.Execution
	err = row.Scan(&execution.ID, &execution.CreatedAt)
	if err != nil {
		return nil, err
	}

	return &execution, nil
}

// CreateExecutionIfNoActive serializes creation by package version so two
// queue deliveries cannot publish different bytes for the same APK coordinate
// at the same time. The bool reports whether this call created the execution.
func CreateExecutionIfNoActive(ctx context.Context, packageID string, pkgVersion *sbpackagetypes.PackageVersion, cause string, causeID string) (*types.Execution, bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("begin execution creation: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, pkgVersion.ID); err != nil {
		return nil, false, fmt.Errorf("lock package version execution: %w", err)
	}

	var existing types.Execution
	err = tx.QueryRow(ctx, `
		SELECT id, created_at, status
		FROM execution
		WHERE package_version_id = $1
		  AND status NOT IN ('success', 'failed', 'vm_deleted')
		ORDER BY created_at DESC
		LIMIT 1
	`, pkgVersion.ID).Scan(&existing.ID, &existing.CreatedAt, &existing.Status)
	if err == nil {
		if err := tx.Commit(ctx); err != nil {
			return nil, false, fmt.Errorf("commit existing execution lookup: %w", err)
		}
		return &existing, false, nil
	}
	if err != pgx.ErrNoRows {
		return nil, false, fmt.Errorf("find active execution: %w", err)
	}

	id, err := securerandom.Hex(24)
	if err != nil {
		return nil, false, err
	}
	createdAt := time.Now().UTC()
	var created types.Execution
	err = tx.QueryRow(ctx, `
		INSERT INTO execution (id, package_id, package_version_id, version_label, status, created_at, use_root, cause, cause_id, repository_publication_required)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
		RETURNING id, created_at, status
	`, id, packageID, pkgVersion.ID, pkgVersion.Version, types.ExecutionStatusPending, createdAt, pkgVersion.UseRoot, cause, causeID).Scan(&created.ID, &created.CreatedAt, &created.Status)
	if err != nil {
		return nil, false, fmt.Errorf("insert execution: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, fmt.Errorf("commit execution creation: %w", err)
	}
	return &created, true, nil
}

func UpdateExecutionStatus(ctx context.Context, executionID string, status types.ExecutionStatus) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		UPDATE execution
		SET status = $1, x86_64_status = $1, aarch64_status = $1
		WHERE id = $2 AND status <> 'failed'
	`

	_, err := conn.Exec(ctx, query, status, executionID)
	if err != nil {
		return err
	}

	return nil
}

// UpdateExecutionOverallStatus updates only the aggregate execution state.
// It is used while an execution waits for repository publication so the
// builder-reported per-architecture success states remain intact.
func UpdateExecutionOverallStatus(ctx context.Context, executionID string, status types.ExecutionStatus) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		UPDATE execution
		SET status = $1
		WHERE id = $2 AND status <> 'failed'
	`

	if _, err := conn.Exec(ctx, query, status, executionID); err != nil {
		return err
	}
	return nil
}

func SetExecutionBuildCommand(ctx context.Context, executionID string, arch string, command string, bootstrapEnabled bool) error {
	var commandToStore string

	if bootstrapEnabled {
		// Bootstrap mode: store full command with redacted secrets for debugging
		commandToStore = command
		commandToStore = strings.ReplaceAll(commandToStore, "--cloudflare-cache-purge-token "+param.GetParam(ctx).CloudflareCachePurgeToken, "--cloudflare-cache-purge-token ***REDACTED***")
		commandToStore = strings.ReplaceAll(commandToStore, "--r2-access-key "+param.GetParam(ctx).R2AccessKey, "--r2-access-key ***REDACTED***")
		commandToStore = strings.ReplaceAll(commandToStore, "--r2-secret-key "+param.GetParam(ctx).R2SecretKey, "--r2-secret-key ***REDACTED***")
	} else {
		// Standard mode: store generic message
		commandToStore = "build command"
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	if arch == "x86_64" {
		query = `
			UPDATE execution
			SET x86_64_build_command = $1
			WHERE id = $2
		`
	} else if arch == "aarch64" {
		query = `
		UPDATE execution
		SET aarch64_build_command = $1
		WHERE id = $2
	`
	} else {
		return fmt.Errorf("invalid architecture: %s", arch)
	}

	_, err := conn.Exec(ctx, query, commandToStore, executionID)
	if err != nil {
		return err
	}

	return nil
}

func SetExecutionBuildStartedAt(ctx context.Context, executionID string, arch string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	if arch == "x86_64" {
		query = `
			UPDATE execution
			SET x86_64_build_started_at = NOW()
		WHERE id = $1
	`
	} else if arch == "aarch64" {
		query = `
			UPDATE execution
			SET aarch64_build_started_at = NOW()
			WHERE id = $1
		`
	} else {
		return fmt.Errorf("invalid architecture: %s", arch)
	}

	_, err := conn.Exec(ctx, query, executionID)
	if err != nil {
		return err
	}

	return nil
}

// GetExecution returns the execution by ID, including build_started_at fields for timeout checks.
func GetExecution(ctx context.Context, executionID string) (*types.Execution, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, status, created_at,
		       x86_64_build_started_at, aarch64_build_started_at
		FROM execution WHERE id = $1
	`
	row := conn.QueryRow(ctx, query, executionID)
	var exec types.Execution
	var x86Started, aarch64Started sql.NullTime
	err := row.Scan(&exec.ID, &exec.Status, &exec.CreatedAt, &x86Started, &aarch64Started)
	if err != nil {
		return nil, err
	}
	if x86Started.Valid {
		exec.X86_64BuildStartedAt = &x86Started.Time
	}
	if aarch64Started.Valid {
		exec.Aarch64BuildStartedAt = &aarch64Started.Time
	}
	return &exec, nil
}

func GetExecutionBuildFinishedAt(ctx context.Context, executionID string, arch string) (*time.Time, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	if arch == "x86_64" {
		query = `
			SELECT x86_64_build_finished_at FROM execution WHERE id = $1
		`
	} else if arch == "aarch64" {
		query = `
			SELECT aarch64_build_finished_at FROM execution WHERE id = $1
		`
	} else {
		return nil, fmt.Errorf("invalid architecture: %s", arch)
	}

	row := conn.QueryRow(ctx, query, executionID)
	var finishedAt sql.NullTime
	err := row.Scan(&finishedAt)
	if err != nil {
		return nil, err
	}

	if finishedAt.Valid {
		return &finishedAt.Time, nil
	}

	return nil, nil
}

func SetExecutionBuildFinishedAt(ctx context.Context, executionID string, arch string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	if arch == "x86_64" {
		query = `
			UPDATE execution
			SET x86_64_build_finished_at = NOW()
			WHERE id = $1 AND x86_64_build_finished_at IS NULL
		`
	} else if arch == "aarch64" {
		query = `
			UPDATE execution
			SET aarch64_build_finished_at = NOW()
			WHERE id = $1 AND aarch64_build_finished_at IS NULL
		`
	} else {
		return fmt.Errorf("invalid architecture: %s", arch)
	}

	_, err := conn.Exec(ctx, query, executionID)
	if err != nil {
		return err
	}

	return nil
}

func SetExecutionBuildStdout(ctx context.Context, executionID string, arch string, stdout string) error {
	logger.Trace("updating execution build stdout", zap.String("executionID", executionID), zap.String("stdout", stdout))

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Sanitize output to remove null bytes and invalid UTF-8 sequences
	sanitizedStdout := sanitizeOutput(stdout)

	// Limit log size to 1MB (1,048,576 characters) to prevent memory issues
	const maxLogSize = 1048576

	// Truncate if content exceeds max size
	if len(sanitizedStdout) > maxLogSize {
		sanitizedStdout = sanitizedStdout[len(sanitizedStdout)-maxLogSize:]
	}

	var query string
	if arch == "x86_64" {
		query = `
			UPDATE execution
			SET x86_64_build_stdout = $1
			WHERE id = $2
		`
	} else if arch == "aarch64" {
		query = `
			UPDATE execution
			SET aarch64_build_stdout = $1
			WHERE id = $2
		`
	} else {
		return fmt.Errorf("invalid architecture: %s", arch)
	}

	_, err := conn.Exec(ctx, query, sanitizedStdout, executionID)
	if err != nil {
		return err
	}

	return nil
}

func SetExecutionBuildStderr(ctx context.Context, executionID string, arch string, stderr string) error {
	logger.Trace("updating execution build stderr", zap.String("executionID", executionID), zap.String("stderr", stderr))

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Sanitize output to remove null bytes and invalid UTF-8 sequences
	sanitizedStderr := sanitizeOutput(stderr)

	// Limit log size to 1MB (1,048,576 characters) to prevent memory issues
	const maxLogSize = 1048576

	// Truncate if content exceeds max size
	if len(sanitizedStderr) > maxLogSize {
		sanitizedStderr = sanitizedStderr[len(sanitizedStderr)-maxLogSize:]
	}

	var query string
	if arch == "x86_64" {
		query = `
			UPDATE execution
			SET x86_64_build_stderr = $1
			WHERE id = $2
		`
	} else if arch == "aarch64" {
		query = `
			UPDATE execution
			SET aarch64_build_stderr = $1
			WHERE id = $2
		`
	} else {
		return fmt.Errorf("invalid architecture: %s", arch)
	}

	_, err := conn.Exec(ctx, query, sanitizedStderr, executionID)
	if err != nil {
		return err
	}

	return nil
}

func SetExecutionBuildExitCode(ctx context.Context, executionID string, arch string, exitCode int) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	if arch == "x86_64" {
		query = `
			UPDATE execution
			SET x86_64_build_exit_code = $1
			WHERE id = $2
		`
	} else if arch == "aarch64" {
		query = `
			UPDATE execution
			SET aarch64_build_exit_code = $1
			WHERE id = $2
		`
	} else {
		return fmt.Errorf("invalid architecture: %s", arch)
	}

	_, err := conn.Exec(ctx, query, exitCode, executionID)
	if err != nil {
		return err
	}

	return nil
}

func SetExecutionPublishCommand(ctx context.Context, executionID string, command string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		UPDATE execution
		SET publish_command = $1
		WHERE id = $2
	`

	_, err := conn.Exec(ctx, query, command, executionID)
	if err != nil {
		return err
	}

	return nil
}

func SetExecutionPublishOutput(ctx context.Context, executionID string, arch string, stdout string) error {
	if strings.TrimSpace(stdout) == "" {
		return nil
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Sanitize output to remove null bytes and invalid UTF-8 sequences
	sanitizedStdout := sanitizeOutput(stdout)

	// Add newline to preserve line breaks when individual lines are sent
	stdoutWithNewline := sanitizedStdout + "\n"

	// Limit log size to 1MB (1,048,576 characters) to prevent memory issues
	const maxLogSize = 1048576

	var stdoutWithNewlineLimited string
	if len(stdoutWithNewline) > maxLogSize {
		stdoutWithNewlineLimited = stdoutWithNewline[:maxLogSize]
	} else {
		stdoutWithNewlineLimited = stdoutWithNewline
	}

	var query string
	if arch == "x86_64" {
		query = `
			UPDATE execution
			SET x86_64_publish_output = $1
			WHERE id = $2
		`
	} else if arch == "aarch64" {
		query = `
			UPDATE execution
			SET aarch64_publish_output = $1
			WHERE id = $2
		`
	} else {
		return fmt.Errorf("invalid architecture: %s", arch)
	}

	_, err := conn.Exec(ctx, query, stdoutWithNewlineLimited, executionID)
	if err != nil {
		return err
	}

	return nil
}

func HasQueuedExecution(ctx context.Context) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT COUNT(*) FROM execution WHERE status = 'queued'
	`

	row := conn.QueryRow(ctx, query)
	var count int
	err := row.Scan(&count)
	if err != nil {
		return false, err
	}

	return count > 0, nil
}

func SetExecutionBuilderID(ctx context.Context, executionID string, arch string, builderID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var query string
	if arch == "x86_64" {
		query = `
			UPDATE execution
			SET x86_64_builder_id = $1
			WHERE id = $2
		`
	} else if arch == "aarch64" {
		query = `
			UPDATE execution
			SET aarch64_builder_id = $1
			WHERE id = $2
		`
	} else {
		return fmt.Errorf("invalid architecture: %s", arch)
	}

	_, err := conn.Exec(ctx, query, builderID, executionID)
	if err != nil {
		return err
	}

	return nil
}

func UpdateExecutionCreatedAt(ctx context.Context, executionID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		UPDATE execution
		SET created_at = NOW()
		WHERE id = $1
	`

	_, err := conn.Exec(ctx, query, executionID)
	if err != nil {
		return err
	}

	return nil
}

// GetExecutionsByPackageVersionID gets all executions for a package version
func GetExecutionsByPackageVersionID(ctx context.Context, packageVersionID string) ([]types.Execution, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, status, created_at
		FROM execution
		WHERE package_version_id = $1
		ORDER BY created_at DESC
	`

	rows, err := conn.Query(ctx, query, packageVersionID)
	if err != nil {
		return nil, fmt.Errorf("failed to query executions: %w", err)
	}
	defer rows.Close()

	var executions []types.Execution
	for rows.Next() {
		var exec types.Execution
		if err := rows.Scan(&exec.ID, &exec.Status, &exec.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan execution: %w", err)
		}
		executions = append(executions, exec)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating executions: %w", err)
	}

	return executions, nil
}
