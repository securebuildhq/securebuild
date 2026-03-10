package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os/signal"
	"syscall"

	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"go.uber.org/zap"
)

func DeleteUnusedPackagesCmd() *cobra.Command {
	var dryRun bool
	var limit int
	var name string

	cmd := &cobra.Command{
		Use:   "delete-unused-packages",
		Short: "Delete unused packages",
		Long:  "Delete unused packages",
		PreRunE: func(cmd *cobra.Command, args []string) error {
			v := viper.GetViper()
			if err := v.BindPFlags(cmd.Flags()); err != nil {
				return fmt.Errorf("failed to bind flags: %w", err)
			}

			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, err := param.Init(param.InitSourceDoppler, nil)
			if err != nil {
				return fmt.Errorf("failed to initialize params: %w", err)
			}

			logger.SetLevel(param.GetParam(ctx).LogLevel)

			ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
			defer stop()

			return deleteUnusedPackages(ctx, dryRun, limit, name)
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "dry run, do not actually remove packages")
	cmd.Flags().IntVar(&limit, "limit", 0, "limit the number of packages to delete")
	cmd.Flags().StringVar(&name, "name", "", "name of the package(s) to delete")

	return cmd
}

func deleteUnusedPackages(ctx context.Context, dryRun bool, limit int, name string) error {
	logger.Debug("delete unused packages", zap.Bool("dry_run", dryRun))

	if err := persistence.InitPostgres(ctx); err != nil {
		return fmt.Errorf("failed to initialize postgres connection: %w", err)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	packageIDs := []string{}

	query := ""
	args := []interface{}{}
	if name != "" {
		query = fmt.Sprintf(`
			SELECT id FROM package
			WHERE is_delete_protection_enabled = false
			AND parent_id IS NULL
			AND name LIKE $1
		`)
		args = append(args, fmt.Sprintf("%%%s%%", name))
	} else {
		query = `
		SELECT id FROM package
		WHERE is_delete_protection_enabled = false
		AND parent_id IS NULL
		`
	}

	if limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", limit)
	}

	rows, err := conn.Query(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to query packages: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("failed to scan package id: %w", err)
		}
		packageIDs = append(packageIDs, id)
	}

	rows.Close()

	logger.Debug("found candidates to delete", zap.Int("count", len(packageIDs)))

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, packageID := range packageIDs {
		pkg, err := sbpackage.GetPackage(ctx, packageID)
		if err != nil {
			return fmt.Errorf("failed to get package: %w", err)
		}

		if pkg.IsDeleteProtectionEnabled {
			continue
		}

		// check if the package or any of it's subpackages have been used in the apk_pull
		x86_64Filenames, aarch64Filenames, err := sbpackage.ListAPKFilenamesForPackage(ctx, tx, pkg.Name)
		if err != nil {
			return fmt.Errorf("failed to list apk filenames for package: %w", err)
		}

		packageHasRecentPull := false
		for _, filename := range x86_64Filenames {
			fmt.Printf("checking if package %s has recent pull for filename %s\n", pkg.Name, filename)
			query := `SELECT COUNT(*) FROM apk_pull WHERE package_name = $1 AND arch = 'x86_64'`
			var count int
			err := tx.QueryRow(ctx, query, filename).Scan(&count)
			if err != nil {
				return fmt.Errorf("failed to check if package has recent pull: %w", err)
			}

			if count > 0 {
				packageHasRecentPull = true
				break
			}
		}

		for _, filename := range aarch64Filenames {
			fmt.Printf("checking if package %s has recent pull for filename %s\n", pkg.Name, filename)

			query := `SELECT COUNT(*) FROM apk_pull WHERE package_name = $1 AND arch = 'aarch64'`
			var count int
			err := tx.QueryRow(ctx, query, filename).Scan(&count)
			if err != nil {
				return fmt.Errorf("failed to check if package has recent pull: %w", err)
			}

			if count > 0 {
				packageHasRecentPull = true
				break
			}
		}

		if packageHasRecentPull {
			logger.Debug("package has recent pull", zap.String("package_id", pkg.ID))
			continue
		}

		if dryRun {
			logger.Debug("dry run, would remove package", zap.String("package_id", pkg.ID))
			continue
		}

		// delete the package
		removePackageRequest := listener.RemovePackageRequest{
			PackageID: pkg.ID,
		}
		b, err := json.Marshal(removePackageRequest)
		if err != nil {
			return fmt.Errorf("failed to marshal remove package request: %w", err)
		}
		if err := persistence.EnqueueWork(ctx, "remove_package", string(b)); err != nil {
			return fmt.Errorf("failed to enqueue remove package work: %w", err)
		}
	}

	return nil

}
