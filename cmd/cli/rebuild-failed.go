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

func RebuildFailedCmd() *cobra.Command {
	var dryRun bool
	var limit int

	cmd := &cobra.Command{
		Use:   "rebuild-failed",
		Short: "Rebuild failed packages",
		Long:  "Rebuild packages that have failed to build",
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

			return buildFailedPackages(ctx, dryRun, limit)
		},
	}

	cmd.Flags().BoolVarP(&dryRun, "dry-run", "d", false, "only print the names and versions of the packages we would build, do not trigger the builds")
	cmd.Flags().IntVarP(&limit, "limit", "l", 0, "limit the number of packages to rebuild")

	return cmd
}

func buildFailedPackages(ctx context.Context, dryRun bool, limit int) error {
	logger.Debug("build failed packages", zap.Bool("dry_run", dryRun))

	if err := persistence.InitPostgres(ctx); err != nil {
		return fmt.Errorf("failed to initialize postgres connection: %w", err)
	}

	pkgVersionsNeedingBuild, err := sbpackage.ListPackageVersionsFailed(ctx)
	if err != nil {
		return fmt.Errorf("failed to list package versions needing build: %w", err)
	}

	// only allow up to the limit
	if limit > 0 {
		if len(pkgVersionsNeedingBuild) > limit {
			pkgVersionsNeedingBuild = pkgVersionsNeedingBuild[:limit]
		}
	}

	for _, pkgVersion := range pkgVersionsNeedingBuild {
		logger.Debug("building failed package", zap.String("package_id", pkgVersion.PackageID), zap.String("package_version_id", pkgVersion.ID))

		if !dryRun {
			buildPackagePayload := listener.BuildPackagePayload{
				PackageID:        pkgVersion.PackageID,
				PackageVersionID: pkgVersion.ID,
				Cause:            "rebuild failed package",
			}
			b, err := json.Marshal(buildPackagePayload)
			if err != nil {
				return err
			}

			if err := persistence.EnqueueWork(ctx, "build_package", b); err != nil {
				return fmt.Errorf("failed to enqueue build package: %w", err)
			}
		}
	}

	logger.Debug("rebuilt failed packages", zap.Int("count", len(pkgVersionsNeedingBuild)))
	return nil
}
