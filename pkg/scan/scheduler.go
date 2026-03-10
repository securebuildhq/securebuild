package scan

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

const (
	// ScanInterval is the base time between periodic vulnerability scans for catalog images
	ScanInterval = 24 * time.Hour

	// CatalogCheckInterval is how often the scheduler checks for catalogimages needing scans
	CatalogCheckInterval = 10 * time.Minute

	// ExternalImageCheckInterval is how long the scheduler pauses if there are no external images to scan
	ExternalImageCheckInterval = 15 * time.Second

	// MaxImagesPerCycle limits how many images are processed in each scheduler cycle
	MaxImagesPerCycle = 25
)

// GetRandomizedScanInterval returns ScanInterval plus a random offset of ±60 minutes
// This helps distribute scan load and prevent thundering herd effects
func GetRandomizedScanInterval() time.Duration {
	randomMinutes := rand.Intn(121) - 60 // -60 to +60 minutes
	return ScanInterval + time.Duration(randomMinutes)*time.Minute
}

func StartScheduler(ctx context.Context) error {
	logger.Info("Starting scan scheduler")

	go func() {
		for {
			select {
			case <-ctx.Done():
				logger.Info("Scan scheduler shutting down")
				return
			case <-time.After(CatalogCheckInterval):
				if err := processPeriodicScans(ctx); err != nil {
					logger.Error(fmt.Errorf("failed to process periodic catalog scans: %w", err))
				}
			}
		}
	}()

	for {
		noImages, err := processExternalImageScans(ctx, MaxImagesPerCycle)
		if err != nil {
			logger.Error(fmt.Errorf("failed to process external image scans: %w", err))
		}
		if noImages {
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(ExternalImageCheckInterval):
			}
		}
	}
}

func processPeriodicScans(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now().UTC()
	query := `
		SELECT ic.id, ic.name, ic.tag
		FROM image_catalog ic
		INNER JOIN image i ON ic.image_id = i.id
		WHERE ic.next_scan_at < $1
		  AND ic.is_published = true
		ORDER BY ic.next_scan_at ASC
		LIMIT $2
	`

	rows, err := conn.Query(ctx, query, now, MaxImagesPerCycle)
	if err != nil {
		return fmt.Errorf("failed to query catalog images for scanning: %w", err)
	}
	defer rows.Close()

	var processedCount int
	for rows.Next() {
		var catalogImageID, name, tag string
		if err := rows.Scan(&catalogImageID, &name, &tag); err != nil {
			logger.Warn("Failed to scan catalog image row", zap.Error(err))
			continue
		}

		// Enqueue catalog image scan job using scan_catalog_image job type
		payload := map[string]interface{}{
			"catalogImageId": catalogImageID,
			"imageName":      name,
			"imageTag":       tag,
		}

		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			logger.Warn("Failed to marshal catalog scan payload",
				zap.String("catalogImageID", catalogImageID),
				zap.Error(err))
			continue
		}

		if err := persistence.EnqueueWork(ctx, "scan_catalog_image", string(payloadJSON)); err != nil {
			logger.Warn("Failed to enqueue catalog image scan",
				zap.String("catalogImageID", catalogImageID),
				zap.Error(err))
			continue
		}

		logger.Info("Enqueued catalog image scan",
			zap.String("catalogImageID", catalogImageID),
			zap.String("name", name),
			zap.String("tag", tag))

		processedCount++
	}

	if processedCount > 0 {
		logger.Info("Processed catalog images for scanning", zap.Int("count", processedCount))
	}

	return nil
}
