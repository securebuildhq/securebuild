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
		Long: `Inventory legacy raw/detail scan objects with validated generation replacements.
Dry-run reports object counts and compressed bytes without changing storage or PostgreSQL.
Execution schedules cleanup after a new 24-hour grace period; it never deletes objects.
Run only after all scan readers and writers support generation-specific storage.`,
		Args: cobra.NoArgs,
		PreRunE: func(cmd *cobra.Command, args []string) error {
			if timeout <= 0 {
				return fmt.Errorf("timeout must be positive")
			}
			if batchSize < 1 || batchSize > 500 {
				return fmt.Errorf("batch size must be between 1 and 500")
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
			fmt.Fprintf(cmd.OutOrStdout(), "candidates=%d would_schedule=%d scheduled=%d skipped_concurrent=%d failed=%d objects=%d bytes=%d dry_run=%t\n",
				result.Candidates,
				result.WouldSchedule,
				result.Scheduled,
				result.SkippedConcurrent,
				result.Failed,
				result.Objects,
				result.Bytes,
				dryRun,
			)
			return scheduleErr
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "inventory candidate objects without scheduling cleanup")
	cmd.Flags().IntVar(&batchSize, "batch-size", 100, "number of rows to read per database page (1-500)")
	cmd.Flags().DurationVar(&timeout, "timeout", 60*time.Minute, "maximum time to inventory and schedule cleanup")
	return cmd
}
