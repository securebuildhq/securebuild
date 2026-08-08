package externalimage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	listenertypes "github.com/securebuildhq/securebuild/pkg/listener/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

func StartMonitor(ctx context.Context) error {
	interval := time.Minute * 5
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run initial check immediately
	go func() {
		if err := checkTagsForUpdatedDigests(ctx); err != nil {
			logger.Errorf("failed to check tags for updated digests: %s", err)
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := checkTagsForUpdatedDigests(ctx); err != nil {
				logger.Errorf("failed to check tags for updated digests: %s", err)
			}
		}
	}
}

func checkTagsForUpdatedDigests(ctx context.Context) error {
	externalImages, err := ListExternalImagesNeedDigestCheck(ctx)
	if err != nil {
		return fmt.Errorf("failed to list external images needing digest check: %w", err)
	}

	for _, externalImage := range externalImages {
		username, password, err := GetExternalImageCredentials(ctx, externalImage.TeamID, externalImage.Registry, externalImage.ImageName)
		if err != nil {
			logger.Info("failed to get credentials", zap.String("registry", externalImage.Registry), zap.String("image_name", externalImage.ImageName), zap.Error(err))
			// Update next_check_digest_at for all tags of this image to delay retry by 24 hours
			nextCheck := time.Now().Add(time.Hour * 24).UTC()
			if err := UpdateExternalImageTagNextCheckDigestAt(ctx, externalImage.Registry, externalImage.ImageName, externalImage.Tags, nextCheck); err != nil {
				logger.Warn("failed to update next check digest time", zap.String("registry", externalImage.Registry), zap.String("image_name", externalImage.ImageName), zap.Error(err))
			}
			continue
		}

		// Track tags that were successfully checked
		var successfulTags []string

		// Check each tag individually since each tag can have a different digest
		for _, tag := range externalImage.Tags {
			currentDigest, err := GetImageDigest(ctx, externalImage.Registry, externalImage.ImageName, tag, username, password)
			if err != nil {
				logger.Info("failed to get digest", zap.String("registry", externalImage.Registry), zap.String("image_name", externalImage.ImageName), zap.String("tag", tag), zap.Error(err))
				// Update next_check_digest_at for this specific tag to delay retry by 24 hours
				nextCheck := time.Now().Add(time.Hour * 24).UTC()
				if err := UpdateExternalImageTagNextCheckDigestAt(ctx, externalImage.Registry, externalImage.ImageName, []string{tag}, nextCheck); err != nil {
					logger.Warn("failed to update next check digest time", zap.String("registry", externalImage.Registry), zap.String("image_name", externalImage.ImageName), zap.String("tag", tag), zap.Error(err))
				}
				continue
			}

			// Mark this tag as successfully checked
			successfulTags = append(successfulTags, tag)

			if currentDigest != externalImage.Digest {
				if err := AddExternalImage(ctx, externalImage.Registry, externalImage.ImageName, tag, currentDigest, username, password); err != nil {
					return fmt.Errorf("failed to add external image %s/%s:%s with new digest: %w", externalImage.Registry, externalImage.ImageName, tag, err)
				}

				// queue the initial work for SBOM
				p := listenertypes.ExternalImageSbomPayload{
					Digest: currentDigest,
					TeamID: externalImage.TeamID,
				}

				payload, err := json.Marshal(p)
				if err != nil {
					return fmt.Errorf("failed to marshal SBOM payload for digest %s: %w", currentDigest, err)
				}

				// Do not enqueue duplicate SBOM work if SBOM already exists for this digest.
				hasExisting, err := HasExistingSBOM(ctx, currentDigest)
				if err != nil {
					logger.Warnf("failed to check for existing SBOM for digest %s: %s", currentDigest, err.Error())
					// If for some reason we fail to check, we will enqueue
					// the work as a safety net as hasExisting will be false.
				}

				if hasExisting {
					logger.Infof("skipping enqueueing SBOM work for digest %s because SBOM already exists", currentDigest)
				} else {
					// Initialize SBOM status to 'pending' before enqueuing
					if err := InitializeSBOMStatusPending(ctx, currentDigest); err != nil {
						logger.Warnf("failed to initialize SBOM status to pending for digest %s: %s", currentDigest, err.Error())
						// Continue anyway - the job will still be enqueued
					}

					if err := persistence.EnqueueWork(ctx, "external_image_sbom", string(payload)); err != nil {
						return fmt.Errorf("failed to enqueue external image SBOM work for digest %s: %w", currentDigest, err)
					}
				}
			}
		}

		// Update next_check_digest_at for successfully checked tags (4 hour delay)
		if len(successfulTags) > 0 {
			next := time.Now().Add(time.Hour * 4).UTC()
			if err := UpdateExternalImageTagNextCheckDigestAt(ctx, externalImage.Registry, externalImage.ImageName, successfulTags, next); err != nil {
				return fmt.Errorf("failed to update next check digest time for %s/%s: %w", externalImage.Registry, externalImage.ImageName, err)
			}
		}
	}

	return nil
}
