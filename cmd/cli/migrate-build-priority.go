package cli

import (
	"context"
	"fmt"
	"os/signal"
	"syscall"
	"time"

	"github.com/securebuildhq/securebuild/pkg/buildpriority"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/spf13/cobra"
)

func MigrateBuildPriorityCmd() *cobra.Command {
	var timeout time.Duration
	cmd := &cobra.Command{
		Use:   "migrate-build-priority",
		Short: "Backfill stored package and image version sort keys once",
		Long: `Backfill existing version sort keys in batches and verify completion.
Run after the schema migration and after all workers and web-app instances have
been updated. Safe to rerun after interruption or an incomplete migration.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if timeout <= 0 {
				return fmt.Errorf("timeout must be positive")
			}
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
			ctx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()
			if err := persistence.InitPostgres(ctx); err != nil {
				return fmt.Errorf("initialize postgres: %w", err)
			}
			defer persistence.ClosePool(ctx)
			conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
			if err != nil {
				return err
			}
			defer conn.Release()
			if err := buildpriority.Backfill(ctx, conn); err != nil {
				return fmt.Errorf("build-priority migration did not complete; safe to rerun: %w", err)
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Build-priority migration complete; all package and image version keys are current.")
			return nil
		},
	}
	cmd.Flags().DurationVar(&timeout, "timeout", 10*time.Minute, "maximum time to run the migration")
	return cmd
}
