package cli

import (
	"fmt"
	"os/signal"
	"syscall"

	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/spf13/cobra"
)

func MigratePackageSelectorsCmd() *cobra.Command {
	var dryRun bool
	cmd := &cobra.Command{
		Use:   "migrate-package-selectors",
		Short: "Backfill dependency and provides selectors from stored Melange YAML",
		RunE: func(cmd *cobra.Command, args []string) error {
			initSource, err := param.ResolveInitSource()
			if err != nil {
				return err
			}
			ctx, err := param.Init(initSource, nil)
			if err != nil {
				return err
			}
			ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
			defer stop()
			if err := persistence.InitPostgres(ctx); err != nil {
				return fmt.Errorf("initialize postgres: %w", err)
			}
			defer persistence.ClosePool(ctx)

			result, err := sbpackage.BackfillPackageSelectors(ctx, sbpackage.SelectorMigrationOptions{DryRun: dryRun})
			fmt.Fprintf(cmd.OutOrStdout(), "package_versions=%d dependency_rows=%d provides_rows=%d unmatched=%d failed=%d\n",
				result.PackageVersions, result.DependencyRows, result.ProvidesRows, result.Unmatched, result.Failed)
			return err
		},
	}
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "inspect selectors without updating PostgreSQL")
	return cmd
}
