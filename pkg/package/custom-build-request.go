package sbpackage

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

// GetCustomBuildRequestIDForPackageVersion gets the custom_build_request_id for a package version
func GetCustomBuildRequestIDForPackageVersion(ctx context.Context, packageVersionID string) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT custom_build_request_id FROM package_version WHERE id = $1`

	var customBuildRequestID sql.NullString
	err := conn.QueryRow(ctx, query, packageVersionID).Scan(&customBuildRequestID)
	if err != nil {
		return "", fmt.Errorf("failed to get custom_build_request_id: %w", err)
	}

	if !customBuildRequestID.Valid {
		return "", nil
	}

	return customBuildRequestID.String, nil
}

// GetPackageVersionsByCustomBuildRequestID gets all package versions for a custom build request
func GetPackageVersionsByCustomBuildRequestID(ctx context.Context, customBuildRequestID string) ([]types.PackageVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, package_id, version, apk_release, use_root,
		       bootstrap_enabled, melange_yaml
		FROM package_version
		WHERE custom_build_request_id = $1
		ORDER BY created_at ASC
	`

	rows, err := conn.Query(ctx, query, customBuildRequestID)
	if err != nil {
		return nil, fmt.Errorf("failed to query package versions: %w", err)
	}
	defer rows.Close()

	var packageVersions []types.PackageVersion
	for rows.Next() {
		var pv types.PackageVersion
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
