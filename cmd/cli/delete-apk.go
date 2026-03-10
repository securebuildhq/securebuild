package cli

import (
	"context"
	"fmt"
	"os/signal"
	"syscall"

	"github.com/securebuildhq/securebuild/pkg/apk"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func DeleteAPKCmd() *cobra.Command {
	var name string
	var packageName string
	var packageVersion string
	var packageRel string

	cmd := &cobra.Command{
		Use:   "delete-apk",
		Short: "Delete an APK from the apk repository",
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

			return deleteAPK(ctx, name, packageName, packageVersion, packageRel)
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "full apk filename of the apk to delete (something-1.2.0-r1.apk)")

	// some specific flags to delete malformed packages from some early iterations
	cmd.Flags().StringVar(&packageName, "package-name", "", "name of the package to delete")
	cmd.Flags().StringVar(&packageVersion, "package-version", "", "version of the package to delete")
	cmd.Flags().StringVar(&packageRel, "package-rel", "", "rel of the package to delete")

	return cmd
}

func deleteAPK(ctx context.Context, name string, packageName string, packageVersion string, packageRel string) error {
	if err := persistence.InitPostgres(ctx); err != nil {
		return fmt.Errorf("failed to initialize postgres connection: %w", err)
	}

	if err := apk.WithdrawAPK(ctx, name, "x86_64", packageName, packageVersion, packageRel); err != nil {
		return fmt.Errorf("failed to withdraw apk: %w", err)
	}

	if err := apk.WithdrawAPK(ctx, name, "aarch64", packageName, packageVersion, packageRel); err != nil {
		return fmt.Errorf("failed to withdraw apk: %w", err)
	}

	return nil
}
