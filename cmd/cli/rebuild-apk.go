package cli

import (
	"errors"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/dynamicparam"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func RebuildAPKCmd() *cobra.Command {
	var arch string

	cmd := cobra.Command{
		Use:   "rebuild-apk",
		Short: "Rebuild the APK index",
		PreRunE: func(cmd *cobra.Command, args []string) error {
			v := viper.GetViper()
			if err := v.BindPFlags(cmd.Flags()); err != nil {
				return fmt.Errorf("failed to bind flags: %w", err)
			}

			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			if arch == "" {
				return errors.New("arch is required")
			}

			ctx, err := param.Init(param.InitSourceDoppler, nil)
			if err != nil {
				return fmt.Errorf("failed to initialize params: %w", err)
			}

			logger.SetLevel(param.GetParam(ctx).LogLevel)

			if err := persistence.InitPostgres(ctx); err != nil {
				return fmt.Errorf("failed to initialize postgres connection: %w", err)
			}

			if err := dynamicparam.EnsureDynamicParams(ctx); err != nil {
				return fmt.Errorf("failed to ensure dynamic params: %w", err)
			}

			if err := listener.RebuildAPKIndex(ctx, arch); err != nil {
				return err
			}

			return nil
		},
	}

	cmd.Flags().StringVarP(&arch, "arch", "a", "", "The architecture to rebuild the APK index for")

	return &cmd
}
