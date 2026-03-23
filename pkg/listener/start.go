package listener

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/securebuildhq/securebuild/pkg/datadog"
	"github.com/securebuildhq/securebuild/pkg/listener/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
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
	StartGitHubSyncListener(ctx, l)
	StartPipelineSyncListener(ctx, l)

	l.Start(ctx)
	defer l.Stop(ctx)

	// wait for ctx to be done
	<-ctx.Done()

	return nil
}

func StartCreatePackageListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "create_package", 1, time.Second*10, func(ctx context.Context, notification *pgconn.Notification) error {
		return datadog.WithSpan(ctx, "listener.create_package", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.remove_package", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.build_package", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.provision_vms", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.build_package_chain", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.build_package_with_vms_assigned", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.build_image_with_vm_assigned", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.build_image", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.build_apko", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.custom_build_request", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.push_image_to_external_registry", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.scan_image", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.scan_catalog_image", func(ctx context.Context) error {
			if err := handleScanCatalogImage(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle scan catalog image notification: %w", err))
				return fmt.Errorf("failed to handle scan catalog image notification: %w", err)
			}
			return nil
		})
	})
}

func StartExternalImageSbomListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "external_image_sbom", 1, time.Minute*1, func(ctx context.Context, notification *pgconn.Notification) error {
		return datadog.WithSpan(ctx, "listener.external_image_sbom", func(ctx context.Context) error {
			// Unmarshal the payload prior to calling HandleExternalImageSbom
			// so we can add logging context to any failures.
			p := types.ExternalImageSbomPayload{}
			if err := json.Unmarshal([]byte(notification.Payload), &p); err != nil {
				return fmt.Errorf("failed to unmarshal external image sbom payload: %w", err)
			}

			if err := HandleExternalImageSbom(ctx, p); err != nil {
				// Always log digest and retryable status
				fields := []zap.Field{
					zap.String("digest", p.Digest),
					zap.Bool("retryable", !IsNonRetryableError(err)),
				}
				// If the error is retryable, add attempt and max attempts
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
	l.AddHandler(ctx, "external_image_scan", 1, time.Minute*1, func(ctx context.Context, notification *pgconn.Notification) error {
		// this handler has been removed in favor of selecting digests from the DB directly
		return nil
	})
}

func StartPackageFamilyUpdateCheckListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "package_family_update_check", 1, time.Minute*1, func(ctx context.Context, notification *pgconn.Notification) error {
		return datadog.WithSpan(ctx, "listener.package_family_update_check", func(ctx context.Context) error {
			if err := handlePackageFamilyUpdateCheck(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle package family update check notification: %w", err))
				return fmt.Errorf("failed to handle package family update check notification: %w", err)
			}
			return nil
		})
	})
}

func StartGitHubSyncListener(ctx context.Context, l *Listener) {
	l.AddHandler(ctx, "github_sync", 1, time.Minute*5, func(ctx context.Context, notification *pgconn.Notification) error {
		return datadog.WithSpan(ctx, "listener.github_sync", func(ctx context.Context) error {
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
		return datadog.WithSpan(ctx, "listener.pipeline_sync", func(ctx context.Context) error {
			if err := handlePipelineSync(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle pipeline sync notification: %w", err))
				return fmt.Errorf("failed to handle pipeline sync notification: %w", err)
			}
			return nil
		})
	})

	// Image pipelines use "image_pipeline_sync" channel
	l.AddHandler(ctx, "image_pipeline_sync", 1, time.Second*10, func(ctx context.Context, notification *pgconn.Notification) error {
		return datadog.WithSpan(ctx, "listener.image_pipeline_sync", func(ctx context.Context) error {
			if err := handlePipelineSync(ctx, notification.Payload); err != nil {
				logger.Error(fmt.Errorf("failed to handle image pipeline sync notification: %w", err))
				return fmt.Errorf("failed to handle image pipeline sync notification: %w", err)
			}
			return nil
		})
	})
}
