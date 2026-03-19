package cli

import (
	"context"
	"fmt"
	"net/http"
	_ "net/http/pprof"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/securebuildhq/securebuild/pkg/adminuser"
	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/builder"
	"github.com/securebuildhq/securebuild/pkg/buildqueue"
	"github.com/securebuildhq/securebuild/pkg/datadog"
	"github.com/securebuildhq/securebuild/pkg/dynamicparam"
	"github.com/securebuildhq/securebuild/pkg/email"
	"github.com/securebuildhq/securebuild/pkg/externalimage"
	"github.com/securebuildhq/securebuild/pkg/githubsync"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/notification"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/package_family"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/pipeline"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/securebuildhq/securebuild/pkg/security"
	"github.com/securebuildhq/securebuild/pkg/updater"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func RunCmd() *cobra.Command {
	runCmd := cobra.Command{
		Use:   "run",
		Short: "Run the worker process",
		Long:  `Run the worker process and listen for tasks`,
		PreRunE: func(cmd *cobra.Command, args []string) error {
			v := viper.GetViper()
			if err := v.BindPFlags(cmd.Flags()); err != nil {
				return fmt.Errorf("failed to bind flags: %w", err)
			}

			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			// Initialize Datadog tracer if enabled
			stopTracer := datadog.Start("securebuild-worker")
			defer stopTracer()

			// Determine configuration source:
			// SECUREBUILD_CONFIG_SOURCE can be:
			//   - missing or "doppler" → load from Doppler (default)
			//   - "env" → load from environment variables
			//   - path to a .yaml/.yml file → load from YAML config file
			var initSource param.InitSource = param.InitSourceDoppler
			configSource := os.Getenv("SECUREBUILD_CONFIG_SOURCE")
			switch {
			case configSource == "" || configSource == "doppler":
				// default: Doppler
			case configSource == "env":
				initSource = param.InitSourceEnvironment
			default:
				ext := filepath.Ext(configSource)
				if ext == ".yaml" || ext == ".yml" {
					initSource = param.InitSourceYAMLFile
				} else {
					return fmt.Errorf("invalid SECUREBUILD_CONFIG_SOURCE: %s (expected 'doppler', 'env', or path to .yaml/.yml file)", configSource)
				}
			}

			ctx, err := param.Init(initSource, nil)
			if err != nil {
				return fmt.Errorf("failed to initialize params: %w", err)
			}

			logger.SetLevel(param.GetParam(ctx).LogLevel)

			ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
			defer stop()

			if err := runWorker(ctx); err != nil {
				return fmt.Errorf("worker error: %w", err)
			}
			return nil
		},
	}

	return &runCmd
}

func runWorker(ctx context.Context) error {
	if err := persistence.InitPostgres(ctx); err != nil {
		return fmt.Errorf("failed to initialize postgres connection: %w", err)
	}

	if err := adminuser.EnsureInitialAdminUser(ctx); err != nil {
		logger.Warnf("failed to ensure initial admin user: %v", err)
	}

	// Start pprof server if enabled
	if param.GetParam(ctx).PProfEnabled {
		go func() {
			if err := http.ListenAndServe("0.0.0.0:6060", nil); err != nil {
				logger.Warnf("pprof server enabled but failed to start: %v", err)
			}
		}()
	}

	if err := email.Init(ctx); err != nil {
		return fmt.Errorf("failed to initialize email service: %w", err)
	}

	if err := dynamicparam.EnsureDynamicParams(ctx); err != nil {
		return fmt.Errorf("failed to ensure dynamic params: %w", err)
	}

	// Migrate pipeline tables if needed (idempotent, safe to run multiple times)
	if err := pipeline.MigratePipelineTables(ctx, logger.GetLogger()); err != nil {
		return fmt.Errorf("failed to migrate pipeline tables: %w", err)
	}

	// Migrate external_image_scan status column (idempotent, safe to run multiple times)
	if err := externalimage.MigrateScanStatusColumn(ctx); err != nil {
		return fmt.Errorf("failed to migrate external image scan status column: %w", err)
	}

	// Create PIPELINE_DIR and populate it for both package and image pipelines
	// Also loads reserved package pipelines from GitHub or cache
	if err := pipeline.SetupPipelines(ctx, logger.GetLogger()); err != nil {
		return fmt.Errorf("failed to setup pipelines: %w", err)
	}

	// Migrate machine_pool schema and backfill machine_assignment (idempotent)
	if err := builder.MigrateMachinePool(ctx); err != nil {
		return fmt.Errorf("failed to migrate machine pool: %w", err)
	}

	// Initialize the build backend and seed machine pool (async; slow and should not block startup)
	backend, err := buildbackend.GetActiveBackend(ctx)
	if err != nil {
		return fmt.Errorf("failed to initialize build backend: %w", err)
	}
	go func() {
		if err := backend.SeedMachinePool(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to seed machine pool for backend %s: %w", backend.Type(), err))
		}
	}()

	// Store backend in context for use by listeners
	ctx = buildbackend.WithBackend(ctx, backend)

	if backend.Type() == buildbackend.BackendCMX {
		if err := builder.CreatePool(ctx); err != nil {
			return fmt.Errorf("failed to create pool: %w", err)
		}
	}

	go func() {
		if err := listener.StartListeners(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start listeners: %w", err))
		}
	}()

	go func() {
		if err := updater.Start(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start updater: %w", err))
		}
	}()

	// Perform GitHub sync on startup if enabled
	if param.GetParam(ctx).SpecSyncEnabled {
		go func() {
			if err := githubsync.PerformSync(ctx); err != nil {
				logger.Error(fmt.Errorf("startup GitHub sync failed: %w", err))
			}
		}()
	}

	go func() {
		if err := listener.StartBuildPackageStatusChecker(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start build package status checker: %w", err))
		}
	}()

	go func() {
		if err := listener.StartBuildImageStatusChecker(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start build image status checker: %w", err))
		}
	}()

	go func() {
		if err := listener.StartAddAPK(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start add apk: %w", err))
		}
	}()

	go func() {
		if err := buildqueue.StartBuildQueue(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start build queue: %w", err))
		}
	}()

	go func() {
		if err := builder.StartVMCleanup(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start vm cleanup: %w", err))
		}
	}()

	go func() {
		if err := externalimage.StartMonitor(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start external image monitor: %w", err))
		}
	}()

	go func() {
		if err := notification.StartNotificationWorkers(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start notification workers: %w", err))
		}
	}()

	// Start the catalog scanner scheduler (grype scans)
	go func() {
		if err := scan.StartScheduler(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start catalog scanner scheduler: %w", err))
		}
	}()

	// Start the vulnerability database updater (vunnel + grype-db)
	go func() {
		if err := scan.StartDatabaseUpdater(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start vulnerability database updater: %w", err))
		}
	}()

	// Start the OSV feed publisher (generates and publishes vulnerability feed)
	go func() {
		if err := security.StartFeedPublisher(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start OSV feed publisher: %w", err))
		}
	}()

	// Start dependency data migration (fixes bad dependency data)
	go func() {
		if err := sbpackage.MigrateDependencyData(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to run dependency data migration: %w", err))
		}
	}()

	// Start the package family update scheduler
	go func() {
		if err := package_family.StartScheduler(ctx); err != nil {
			logger.Error(fmt.Errorf("failed to start package family update scheduler: %w", err))
		}
	}()

	if err := builder.UpdateFilesystemArchives(ctx); err != nil {
		logger.Error(fmt.Errorf("failed to update filesystem archives: %w", err))
	}

	<-ctx.Done()

	return nil
}
