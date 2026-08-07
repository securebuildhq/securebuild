package listener

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/securebuildhq/securebuild/pkg/listener/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

func StartListeners(ctx context.Context) error {
	l := NewListener(ctx)

	StartCreatePackageListener(ctx, l)
	StartRemovePackageListener(ctx, l)
	StartBuildPackageListener(ctx, l)
	StartProvisionVMsListener(ctx, l)
	StartBuildPackageChainListener(ctx, l)
	StartBuildPackageWithVmsAssignedListener(ctx, l)
	StartBuildImageWithVMAssignedListener(ctx, l)
	StartBuildImageListener(ctx, l)
	StartBuildAPKOListener(ctx, l)
	StartCustomBuildRequestListener(ctx, l)
	StartPushImageToExternalRegistryListener(ctx, l)
	StartScanImageListener(ctx, l)
	StartScanCatalogImageListener(ctx, l)
	StartExternalImageSbomListener(ctx, l)
	StartExternalImageScanListener(ctx, l)
	StartPackageFamilyUpdateCheckListener(ctx, l)
	StartImageUpdateCheckListener(ctx, l)
	StartGitHubSyncListener(ctx, l)
	StartPipelineSyncListener(ctx, l)

	// Start cleanup goroutine for completed work_queue rows
	go startCompletedWorkCleanup(ctx)

	l.Start(ctx)
	defer l.Stop(ctx)

	// wait for ctx to be done
	<-ctx.Done()

	return nil
}

// startCompletedWorkCleanup periodically deletes work_queue rows that have been
// completed for more than 24 hours. This keeps the table from growing unbounded
// while still preserving completed job records long enough for status queries.
func startCompletedWorkCleanup(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
			if err != nil {
				logger.Warn("failed to get connection for completed work cleanup", zap.Error(err))
				continue
			}
			result, err := conn.Exec(ctx, `
				DELETE FROM work_queue
				WHERE completed_at IS NOT NULL
				AND completed_at < NOW() - INTERVAL '24 hours'
			`)
			conn.Release()
			if err != nil {
				logger.Warn("failed to clean up completed work queue rows", zap.Error(err))
				continue
			}
			if result.RowsAffected() > 0 {
				logger.Info("cleaned up completed work queue rows",
					zap.Int64("rows_deleted", result.RowsAffected()))
			}
		}
	}
}

func StartCreatePackageListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "create_package", 1, time.Second*10, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.create_package", func(ctx context.Context) error {
			if err := handleCreatePackage(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle create package notification: %w", err))
				return fmt.Errorf("failed to handle create package notification: %w", err)
			}
			return nil
		})
	})
}

func StartRemovePackageListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "remove_package", 5, time.Hour*5, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.remove_package", func(ctx context.Context) error {
			if err := handleRemovePackage(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle remove package notification: %w", err))
				return fmt.Errorf("failed to handle remove package notification: %w", err)
			}
			return nil
		})
	})
}

func StartBuildPackageListener(ctx context.Context, l *Listener) {
	// this must be 1
	l.AddHandler(ctx, "build_package", 1, time.Hour*24, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.build_package", func(ctx context.Context) error {
			if err := HandleBuildPackage(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle build package notification: %w", err))
				return fmt.Errorf("failed to handle build package notification: %w", err)
			}
			return nil
		})
	})
}

func StartProvisionVMsListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "provision_vms", 1, time.Hour*1, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.provision_vms", func(ctx context.Context) error {
			if err := handleProvisionVMs(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle provision vms notification: %w", err))
				return fmt.Errorf("failed to handle provision vms notification: %w", err)
			}
			return nil
		})
	})
}

func StartBuildPackageChainListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "build_package_chain", 1, time.Hour*24, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.build_package_chain", func(ctx context.Context) error {
			if err := handleBuildPackageChain(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle build package chain notification: %w", err))
				return fmt.Errorf("failed to handle build package chain notification: %w", err)
			}
			return nil
		})
	})
}

func StartBuildPackageWithVmsAssignedListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "build_package_with_vms_assigned", param.GetParam(ctx).PoolSize, time.Minute*2, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.build_package_with_vms_assigned", func(ctx context.Context) error {
			if err := handleBuildPackageWithVmsAssigned(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle build package with vms assigned notification: %w", err))
				return fmt.Errorf("failed to handle build package with vms assigned notification: %w", err)
			}
			return nil
		})
	})
}

func StartBuildImageWithVMAssignedListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "build_image_with_vm_assigned", param.GetParam(ctx).PoolSize, time.Minute*2, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.build_image_with_vm_assigned", func(ctx context.Context) error {
			if err := HandleBuildImageWithVMAssigned(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle build image with VM assigned notification: %w", err))
				return fmt.Errorf("failed to handle build image with VM assigned notification: %w", err)
			}
			return nil
		})
	})
}

func StartBuildImageListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "build_image", 1, time.Minute*1, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.build_image", func(ctx context.Context) error {
			if err := handleBuildImage(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle build image notification: %w", err))
				return fmt.Errorf("failed to handle build image notification: %w", err)
			}
			return nil
		})
	})
}

func StartBuildAPKOListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "build_apko", 1, time.Minute*1, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.build_apko", func(ctx context.Context) error {
			if err := handleBuildAPKO(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle build apko notification: %w", err))
				return fmt.Errorf("failed to handle build apko notification: %w", err)
			}
			return nil
		})
	})
}

func StartCustomBuildRequestListener(ctx context.Context, l *Listener) {
	// Custom build request handler - processes build requests and enqueues package/image builds
	l.AddHandler(ctx, "custom_build_request", 1, time.Minute*5, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.custom_build_request", func(ctx context.Context) error {
			if err := HandleCustomBuildRequest(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle custom build request notification: %w", err))
				return fmt.Errorf("failed to handle custom build request notification: %w", err)
			}
			return nil
		})
	})
}

func StartPushImageToExternalRegistryListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "push_image_to_external_registry", 1, time.Minute*1, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.push_image_to_external_registry", func(ctx context.Context) error {
			if err := handlePushImageToExternalRegistry(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle push image to external registry notification: %w", err))
				return fmt.Errorf("failed to handle push image to external registry notification: %w", err)
			}
			return nil
		})
	})
}

func StartScanImageListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "scan_image", 1, time.Minute*1, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.scan_image", func(ctx context.Context) error {
			if err := handleScanImage(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle scan image notification: %w", err))
				return fmt.Errorf("failed to handle scan image notification: %w", err)
			}
			return nil
		})
	})
}

func StartScanCatalogImageListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "scan_catalog_image", 1, time.Minute*1, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.scan_catalog_image", func(ctx context.Context) error {
			if err := handleScanCatalogImage(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle scan catalog image notification: %w", err))
				return fmt.Errorf("failed to handle scan catalog image notification: %w", err)
			}
			return nil
		})
	})
}

func StartExternalImageSbomListener(ctx context.Context, l *Listener) {
	// Worker count mirrors the scan listener: PoolSize * 2 (both architectures)
	// * MaxSbomDownloadsPerBuilder. Since the handler dispatches to builders and
	// returns immediately (syft runs async via nohup), the worker count can be
	// high — it just needs to be high enough to drain the queue faster than the
	// scheduler enqueues.
	maxWorkers := param.GetParam(ctx).PoolSize * 2 * param.GetParam(ctx).MaxSbomDownloadsPerBuilder
	if maxWorkers < 1 {
		maxWorkers = 1
	}
	l.AddHandler(ctx, "external_image_sbom", maxWorkers, time.Minute*5, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.external_image_sbom", func(ctx context.Context) error {
			p := types.ExternalImageSbomPayload{}
			if err := json.Unmarshal([]byte(notification.Payload), &p); err != nil {
				return fmt.Errorf("failed to unmarshal external image sbom payload: %w", err)
			}
			if err := HandleExternalImageSbom(ctx, p); err != nil {
				fields := []zap.Field{
					zap.String("digest", p.Digest),
					zap.Bool("retryable", !IsNonRetryableError(err)),
				}
				if !IsNonRetryableError(err) {
					attempt, maxAttempts := GetAttemptInfo(ctx)
					fields = append(fields, zap.Int("attempt", attempt), zap.Int("max_attempts", maxAttempts))
				}
				logger.Error(fmt.Errorf("failed to handle external image sbom notification: %w", err), fields...)
				return fmt.Errorf("failed to handle external image sbom notification: %w", err)
			}
			return nil
		})
	})
}

func StartExternalImageScanListener(ctx context.Context, l *Listener) {
	// PoolSize is the per-architecture pool size (e.g. 12 arm + 12 amd = 24
	// total builders). Double it to account for both architectures so the
	// listener worker count matches the actual builder capacity.
	maxWorkers := param.GetParam(ctx).PoolSize * 2 * param.GetParam(ctx).MaxScansPerBuilder
	if maxWorkers < 1 {
		maxWorkers = 1
	}
	l.AddHandler(ctx, "external_image_scan", maxWorkers, time.Minute*5, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.external_image_scan", func(ctx context.Context) error {
			if err := HandleExternalImageScanOnBuilder(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle external image scan notification: %w", err))
				return fmt.Errorf("failed to handle external image scan notification: %w", err)
			}
			return nil
		})
	})
}

func StartPackageFamilyUpdateCheckListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "package_family_update_check", 1, time.Minute*1, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.package_family_update_check", func(ctx context.Context) error {
			if err := handlePackageFamilyUpdateCheck(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle package family update check notification: %w", err))
				return fmt.Errorf("failed to handle package family update check notification: %w", err)
			}
			return nil
		})
	})
}

func StartImageUpdateCheckListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "image_update_check", 1, time.Minute*5, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.image_update_check", func(ctx context.Context) error {
			if err := handleImageUpdateCheck(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle image update check notification: %w", err))
				return fmt.Errorf("failed to handle image update check notification: %w", err)
			}
			return nil
		})
	})
}

func StartGitHubSyncListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "github_sync", 1, time.Minute*5, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.github_sync", func(ctx context.Context) error {
			if err := handleGitHubSync(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle GitHub sync notification: %w", err))
				return fmt.Errorf("failed to handle GitHub sync notification: %w", err)
			}
			return nil
		})
	})
}

func StartPipelineSyncListener(ctx context.Context, l *Listener) {
	// Listen to both package pipeline and image pipeline sync notifications
	// Package pipelines use "pipeline_sync" channel
	l.AddHandler(ctx, "pipeline_sync", 1, time.Second*10, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.pipeline_sync", func(ctx context.Context) error {
			if err := handlePipelineSync(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle pipeline sync notification: %w", err))
				return fmt.Errorf("failed to handle pipeline sync notification: %w", err)
			}
			return nil
		})
	})

	// Image pipelines use "image_pipeline_sync" channel
	l.AddHandler(ctx, "image_pipeline_sync", 1, time.Second*10, func(ctx context.Context, notification *pgconn.Notification) error {
		return telemetry.WithSpan(ctx, "listener.image_pipeline_sync", func(ctx context.Context) error {
			if err := handlePipelineSync(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle image pipeline sync notification: %w", err))
				return fmt.Errorf("failed to handle image pipeline sync notification: %w", err)
			}
			return nil
		})
	})
}
