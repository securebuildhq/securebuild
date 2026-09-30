package cli

import (
	"context"
	"fmt"
	"os/signal"
	"syscall"
	"time"

	"github.com/securebuildhq/securebuild/pkg/externalimage"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/spf13/cobra"
)

func ScheduleLegacyScanCleanupCmd() *cobra.Command {
	var dryRun bool
	var batchSize int
	var timeout time.Duration

	cmd := &cobra.Command{
		Use:   "schedule-legacy-scan-cleanup",
		Short: "Schedule redundant legacy scan objects for cleanup",
		Long: `Find legacy raw/detail scan keys with published generation replacements using PostgreSQL only.
Dry-run reports eligible rows and intended delete keys without changing PostgreSQL.
Neither dry-run nor scheduling contacts object storage or measures stored bytes.
Execution schedules cleanup after a new 24-hour grace period; it never deletes objects.
Run only after all scan readers and writers support generation-specific storage.`,
		Args: cobra.NoArgs,
		PreRunE: func(cmd *cobra.Command, args []string) error {
			if timeout <= 0 {
				return fmt.Errorf("timeout must be positive")
			}
			if batchSize < 1 || batchSize > 5000 {
				return fmt.Errorf("batch size must be between 1 and 5000")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			// Parsing and validation have succeeded; runtime failures need only the error.
			cmd.SilenceUsage = true
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

			result, scheduleErr := externalimage.ScheduleLegacyExternalImageScanCleanup(ctx, externalimage.LegacyScanCleanupOptions{
				DryRun:    dryRun,
				BatchSize: batchSize,
			})
			fmt.Fprintf(cmd.OutOrStdout(), "candidates=%d would_schedule=%d scheduled=%d skipped_concurrent=%d failed=%d intended_keys=%d dry_run=%t\n",
				result.Candidates,
				result.WouldSchedule,
				result.Scheduled,
				result.SkippedConcurrent,
				result.Failed,
				result.IntendedKeys,
				dryRun,
			)
			return scheduleErr
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "report eligible rows and intended keys without scheduling cleanup")
	cmd.Flags().IntVar(&batchSize, "batch-size", 1000, "number of rows per database batch (1-5000)")
	cmd.Flags().DurationVar(&timeout, "timeout", 60*time.Minute, "maximum time to inspect database rows and schedule cleanup")
	return cmd
}
