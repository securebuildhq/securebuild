package cli

import (
	"context"
	"fmt"
	"os/signal"
	"syscall"

	"github.com/securebuildhq/securebuild/pkg/datadog"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/ociproxy"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func OCIProxyCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "oci-proxy",
		Short: "Run the OCI proxy",
		PreRunE: func(cmd *cobra.Command, args []string) error {
			v := viper.GetViper()
			if err := v.BindPFlags(cmd.Flags()); err != nil {
				return fmt.Errorf("failed to bind flags: %w", err)
			}

			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			// Initialize Datadog tracer if enabled
			stopTracer := datadog.Start("securebuild-oci-proxy")
			defer stopTracer()

			ctx, err := param.Init(param.InitSourceDoppler, nil)
			if err != nil {
				return fmt.Errorf("failed to initialize params: %w", err)
			}

			logger.SetLevel(param.GetParam(ctx).LogLevel)

			ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
			defer stop()

			if err := runOCIProxy(ctx); err != nil {
				return fmt.Errorf("failed to run OCI proxy: %w", err)
			}

			return nil
		},
	}
}

func runOCIProxy(ctx context.Context) error {
	if err := persistence.InitPostgres(ctx); err != nil {
		return fmt.Errorf("failed to initialize postgres connection: %w", err)
	}

	if err := ociproxy.StartProxy(ctx, ":8888"); err != nil {
		return fmt.Errorf("failed to start OCI proxy: %w", err)
	}

	return nil
}
