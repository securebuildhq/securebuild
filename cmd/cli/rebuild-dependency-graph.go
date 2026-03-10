package cli

import (
	"context"
	"fmt"
	"os/signal"
	"syscall"

	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"go.uber.org/zap"
)

func RebuildDependencyGraph() *cobra.Command {
	var rebuildAll bool
	cmd := &cobra.Command{
		Use:   "rebuild-dependency-graph",
		Short: "Rebuild the dependency graph",
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

			return rebuildDependencyGraph(ctx, rebuildAll)
		},
	}

	cmd.Flags().BoolVarP(&rebuildAll, "rebuild-all", "a", false, "rebuild the dependency graph for all packages, regardless of whether they already have dependencies listed")

	return cmd
}

func rebuildDependencyGraph(ctx context.Context, rebuildAll bool) error {
	logger.Debug("rebuilding dependency graph")

	if err := persistence.InitPostgres(ctx); err != nil {
		return fmt.Errorf("failed to initialize postgres connection: %w", err)
	}

	allPackageVersions := []*types.PackageVersion{}
	var err error
	if rebuildAll {
		allPackageVersions, err = sbpackage.ListAllPackageVersions(ctx)
		if err != nil {
			return fmt.Errorf("list all package versions: %w", err)
		}
	} else {
		allPackageVersions, err = sbpackage.ListPackageVersionsNeedingDependencyGraphRebuild(ctx)
		if err != nil {
			return fmt.Errorf("list package versions needing dependency graph rebuild: %w", err)
		}
	}

	for _, packageVersion := range allPackageVersions {
		pkg, err := sbpackage.GetPackage(ctx, packageVersion.PackageID)
		if err != nil {
			return fmt.Errorf("get package: %w", err)
		}

		logger.Debug("rebuilding dependency graph for package version",
			zap.String("package_version_id", packageVersion.ID),
			zap.String("package_name", pkg.Name),
			zap.String("package_version", packageVersion.Version),
			zap.Int("package_melange_yaml_size", len(packageVersion.MelangeYaml)),
			zap.Int("package_apk_release", packageVersion.APKRelease))

		if err := sbpackage.WritePackageVersionDependencies(ctx, nil, packageVersion); err != nil {
			return fmt.Errorf("write package version dependencies: %w", err)
		}
	}
	return nil
}
