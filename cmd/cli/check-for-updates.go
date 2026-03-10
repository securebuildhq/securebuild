package cli

import (
	"context"
	"fmt"
	"os/signal"
	"syscall"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/updater"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func CheckForUpdatesCmd() *cobra.Command {
	packageID := ""

	cmd := &cobra.Command{
		Use:   "check-for-updates",
		Short: "Check for updates",
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

			return checkForUpdates(ctx, packageID)
		},
	}

	cmd.Flags().StringVar(&packageID, "package-id", "", "Package ID")

	return cmd
}

func checkForUpdates(ctx context.Context, packageID string) error {
	if err := persistence.InitPostgres(ctx); err != nil {
		return fmt.Errorf("failed to initialize postgres connection: %w", err)
	}

	if packageID != "" {
		if err := updater.UpdatePackage(ctx, packageID); err != nil {
			return fmt.Errorf("failed to update package: %w", err)
		}
	} else {
		if err := updater.UpdatePackages(ctx); err != nil {
			return fmt.Errorf("failed to update packages: %w", err)
		}
	}

	return nil
}
