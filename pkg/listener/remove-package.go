package listener

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

type RemovePackageRequest struct {
	PackageID string `json:"packageId"`
}

func handleRemovePackage(ctx context.Context, payload string) error {
	var req RemovePackageRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		return fmt.Errorf("failed to unmarshal remove package request: %w", err)
	}

	logger.Info(fmt.Sprintf("Removing package %s", req.PackageID))

	// get the package
	pkg, err := sbpackage.GetPackage(ctx, req.PackageID)
	if err != nil {
		return fmt.Errorf("failed to get package: %w", err)
	}

	// remove the package version
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Remove all subpackages first
	for _, subpkg := range pkg.Subpackages {
		// Get all versions of the subpackage
		subpkgVersions, err := sbpackage.ListPackageVersions(ctx, subpkg.ID)
		if err != nil {
			return fmt.Errorf("failed to list versions for subpackage %s: %w", subpkg.ID, err)
		}

		// Remove all versions of the subpackage
		for _, version := range subpkgVersions {
			if err := sbpackage.RemovePackageVersion(ctx, tx, version.ID); err != nil {
				return fmt.Errorf("failed to remove subpackage version %s: %w", version.ID, err)
			}
		}

		// Remove the subpackage itself
		if err := sbpackage.RemovePackage(ctx, tx, subpkg.ID, subpkg.Name); err != nil {
			return fmt.Errorf("failed to remove subpackage %s: %w", subpkg.ID, err)
		}
	}

	// Now remove the main package's versions
	allPackageVersions, err := sbpackage.ListPackageVersions(ctx, pkg.ID)
	if err != nil {
		return fmt.Errorf("failed to list package versions: %w", err)
	}

	// Remove all versions of the main package
	for _, pkgVersion := range allPackageVersions {
		if err := sbpackage.RemovePackageVersion(ctx, tx, pkgVersion.ID); err != nil {
			return fmt.Errorf("failed to remove package version: %w", err)
		}
	}

	// Finally remove the main package
	if err := sbpackage.RemovePackage(ctx, tx, pkg.ID, pkg.Name); err != nil {
		return fmt.Errorf("failed to remove package: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}
