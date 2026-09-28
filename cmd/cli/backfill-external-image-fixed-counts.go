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

func BackfillExternalImageFixedCountsCmd() *cobra.Command {
	var dryRun bool
	var batchSize int
	var timeout time.Duration

	cmd := &cobra.Command{
		Use:   "backfill-external-image-fixed-counts",
		Short: "Backfill compact fixed CVE counts from stored scan details",
		Long: `Backfill fixed_counts in external_image_scan.parsed_results from the
existing parsed_results_details objects. Run after all SecureBuild scan writers
and the scan-summary API have been updated. The command is safe to interrupt and
rerun; conditional updates do not overwrite concurrently completed scans.`,
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

			result, backfillErr := externalimage.BackfillExternalImageFixedCounts(ctx, externalimage.FixedCountsBackfillOptions{
				DryRun:    dryRun,
				BatchSize: batchSize,
			})
			fmt.Fprintf(cmd.OutOrStdout(), "candidates=%d would_update=%d updated=%d skipped_concurrent=%d failed=%d dry_run=%t\n",
				result.Candidates,
				result.WouldUpdate,
				result.Updated,
				result.SkippedConcurrent,
				result.Failed,
				dryRun,
			)
			return backfillErr
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "read and validate candidate objects without updating PostgreSQL")
	cmd.Flags().IntVar(&batchSize, "batch-size", 100, "number of rows to read per database page (1-1000)")
	cmd.Flags().DurationVar(&timeout, "timeout", 60*time.Minute, "maximum time to run the backfill")
	return cmd
}
