package cli

import (
	"context"
	"fmt"
	"os/signal"
	"syscall"

	"github.com/securebuildhq/securebuild/pkg/buildgraph"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func BuildOrderCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "build-order [package-name]",
		Short: "Get the build order for a package and its dependents",
		Long:  `Returns the build order for a package and all packages that depend on it`,
		Args:  cobra.ExactArgs(1),
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

			if err := persistence.InitPostgres(ctx); err != nil {
				return fmt.Errorf("failed to initialize postgres connection: %w", err)
			}

			packageName := args[0]
			return getBuildDAG(ctx, packageName)
		},
	}

	return cmd
}

func getBuildDAG(ctx context.Context, packageName string) error {
	// Create dependency map from database
	dependencyMap, err := sbpackage.GetPackageDependencyMap(ctx)
	if err != nil {
		return fmt.Errorf("failed to create dependency map: %w", err)
	}

	// Check if package exists in the map
	if _, exists := dependencyMap[packageName]; !exists {
		return fmt.Errorf("package '%s' not found", packageName)
	}

	// Get build DAG
	_, edges := buildgraph.BuildDAG(dependencyMap, packageName)

	// Print result
	fmt.Printf("Build order for package '%s':\n", packageName)
	for _, edge := range edges {
		fmt.Printf("%s -> %s\n", edge.From, edge.To)
	}

	return nil
}
