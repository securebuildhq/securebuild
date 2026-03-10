package sbpackage

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func RemovePackageVersion(ctx context.Context, tx pgx.Tx, pkgVersionID string) error {
	query := `DELETE FROM package_version WHERE id = $1`
	_, err := tx.Exec(ctx, query, pkgVersionID)
	if err != nil {
		return fmt.Errorf("failed to remove package version: %w", err)
	}

	query = `DELETE FROM package_version_dependency_runtime WHERE package_version_id = $1`
	_, err = tx.Exec(ctx, query, pkgVersionID)
	if err != nil {
		return fmt.Errorf("failed to remove package version dependency runtime: %w", err)
	}

	query = `DELETE FROM package_version_dependency_buildtime WHERE package_version_id = $1`
	_, err = tx.Exec(ctx, query, pkgVersionID)
	if err != nil {
		return fmt.Errorf("failed to remove package version dependency buildtime: %w", err)
	}

	query = `DELETE FROM package_version_provides WHERE package_version_id = $1`
	_, err = tx.Exec(ctx, query, pkgVersionID)
	if err != nil {
		return fmt.Errorf("failed to remove package version provides: %w", err)
	}

	query = `DELETE FROM execution WHERE package_version_id = $1`
	_, err = tx.Exec(ctx, query, pkgVersionID)
	if err != nil {
		return fmt.Errorf("failed to remove execution history: %w", err)
	}

	return nil
}

func RemovePackage(ctx context.Context, tx pgx.Tx, pkgID string, pkgName string) error {
	// Delete from package_family_package table first
	query := `DELETE FROM package_family_package WHERE package_id = $1`
	_, err := tx.Exec(ctx, query, pkgID)
	if err != nil {
		return fmt.Errorf("failed to remove package from package_family_package: %w", err)
	}

	query = `DELETE FROM package WHERE id = $1`
	_, err = tx.Exec(ctx, query, pkgID)
	if err != nil {
		return fmt.Errorf("failed to remove package: %w", err)
	}

	x86_64Filenames, aarch64Filenames, err := ListAPKFilenamesForPackage(ctx, tx, pkgName)
	if err != nil {
		return fmt.Errorf("failed to list apk filenames for package: %w", err)
	}

	for _, filename := range x86_64Filenames {
		query := `UPDATE apk_catalog SET is_withdrawn = true WHERE filename = $1`
		_, err := tx.Exec(ctx, query, filename)
		if err != nil {
			return fmt.Errorf("failed to update apk catalog: %w", err)
		}
	}

	for _, filename := range aarch64Filenames {
		query := `UPDATE apk_catalog SET is_withdrawn = true WHERE filename = $1`
		_, err := tx.Exec(ctx, query, filename)
		if err != nil {
			return fmt.Errorf("failed to update apk catalog: %w", err)
		}
	}

	return nil
}

func ListAPKFilenamesForPackage(ctx context.Context, tx pgx.Tx, packageName string) ([]string, []string, error) {
	query := `SELECT filename, arch FROM apk_catalog WHERE (index_content::jsonb ->> 'origin') = $1`
	rows, err := tx.Query(ctx, query, packageName)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list apk filenames for package: %w", err)
	}
	defer rows.Close()

	x86_64Filenames := []string{}
	aarch64Filenames := []string{}
	for rows.Next() {
		var filename string
		var arch string
		err := rows.Scan(&filename, &arch)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to scan apk filename: %w", err)
		}

		if arch == "x86_64" {
			x86_64Filenames = append(x86_64Filenames, filename)
		} else if arch == "aarch64" {
			aarch64Filenames = append(aarch64Filenames, filename)
		}
	}

	return x86_64Filenames, aarch64Filenames, nil
}
