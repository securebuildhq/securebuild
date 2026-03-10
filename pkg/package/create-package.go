package sbpackage

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

func GetCreatePackage(ctx context.Context, id string) (*types.CreatePackage, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id, melange_yaml, additional_files_data, created_at, use_root, custom_disk_size, package_id, created_by_user_id, created_by_user_name from package_create where id = $1`

	var createPackage types.CreatePackage
	var additionalFilesData sql.NullString
	var useRoot sql.NullBool
	var customDiskSize sql.NullInt32
	var createdByUserID sql.NullString
	var createdByUserName sql.NullString
	err := conn.QueryRow(ctx, query, id).Scan(
		&createPackage.ID,
		&createPackage.MelangeYaml,
		&additionalFilesData,
		&createPackage.CreatedAt,
		&useRoot,
		&customDiskSize,
		&createPackage.PackageID,
		&createdByUserID,
		&createdByUserName,
	)
	if err != nil {
		return nil, fmt.Errorf("get create package: %w", err)
	}

	if additionalFilesData.Valid {
		createPackage.AdditionalFilesData = &additionalFilesData.String
	}

	createPackage.UseRoot = useRoot.Bool

	if customDiskSize.Valid {
		diskSize := int(customDiskSize.Int32)
		createPackage.CustomDiskSize = &diskSize
	}

	createPackage.CreatedByUserID = createdByUserID.String
	createPackage.CreatedByUserName = createdByUserName.String

	return &createPackage, nil
}

func DeleteCreatePackage(ctx context.Context, id string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `delete from package_create where id = $1`
	_, err := conn.Exec(ctx, query, id)
	return err
}

// DeletePendingPackage deletes a pending package from both package_create and package tables in a transaction.
// This is used when a package creation fails with a non-recoverable error.
// Only deletes if:
// 1. Records exist in both package_create and package tables for the same package
// 2. No package_version records exist (meaning the package is still pending)
func DeletePendingPackage(ctx context.Context, packageID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Check if any package_version exists for this package
	var versionCount int
	err = tx.QueryRow(ctx, `SELECT COUNT(*) FROM package_version WHERE package_id = $1`, packageID).Scan(&versionCount)
	if err != nil {
		return fmt.Errorf("check package versions: %w", err)
	}
	if versionCount > 0 {
		// Package has versions, it's not a pending package
		return nil
	}

	// Check if both package_create and package records exist
	var createCount int
	err = tx.QueryRow(ctx, `SELECT COUNT(*) FROM package_create WHERE package_id = $1`, packageID).Scan(&createCount)
	if err != nil {
		return fmt.Errorf("check package_create: %w", err)
	}

	var packageCount int
	err = tx.QueryRow(ctx, `SELECT COUNT(*) FROM package WHERE id = $1`, packageID).Scan(&packageCount)
	if err != nil {
		return fmt.Errorf("check package: %w", err)
	}

	// Only delete if both exist
	if createCount > 0 && packageCount > 0 {
		// Delete from package_create table
		_, err = tx.Exec(ctx, `DELETE FROM package_create WHERE package_id = $1`, packageID)
		if err != nil {
			return fmt.Errorf("delete package_create: %w", err)
		}

		// Delete from package table
		_, err = tx.Exec(ctx, `DELETE FROM package WHERE id = $1`, packageID)
		if err != nil {
			return fmt.Errorf("delete package: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}
