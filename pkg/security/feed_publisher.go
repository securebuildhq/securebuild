package security

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

// StartFeedPublisher starts a background goroutine that periodically publishes
// the Alpine secdb vulnerability feed to R2 storage
func StartFeedPublisher(ctx context.Context) error {
	logger.Info("Starting Alpine secdb feed publisher")

	// Run initial publish immediately
	logger.Info("Running initial Alpine secdb feed publication")
	if err := PublishFeed(ctx); err != nil {
		logger.Warn("initial feed publication failed, will retry on next cycle", zap.Error(err))
		// Continue anyway - the publisher will retry on the next cycle
	}

	// Start periodic publish loop (every 15 minutes)
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logger.Info("Alpine secdb feed publisher stopped")
			return nil
		case <-ticker.C:
			logger.Info("Starting scheduled Alpine secdb feed publication")
			if err := PublishFeed(ctx); err != nil {
				logger.Warn("scheduled feed publication failed, will retry on next cycle", zap.Error(err))
				// Continue running - will retry on next cycle
			}
		}
	}
}

// PublishFeed orchestrates the complete feed publishing pipeline:
// 1. Generate Alpine secdb feed from database
// 2. Parse feed to count packages and CVEs
// 3. Create R2 client
// 4. Publish feed atomically to R2
// 5. Log success metrics
func PublishFeed(ctx context.Context) (err error) {
	startTime := time.Now()

	// Step 1: Generate Alpine secdb feed from database
	logger.Debug("generating Alpine secdb feed from database")
	secdbJSON, genErr := GenerateSecDBFeed(ctx)
	if genErr != nil {
		return fmt.Errorf("failed to generate Alpine secdb feed: %w", genErr)
	}

	// Step 2: Parse feed to count packages and CVEs
	var secdb AlpineSecDB
	if err := json.Unmarshal([]byte(secdbJSON), &secdb); err != nil {
		return fmt.Errorf("failed to parse Alpine secdb feed for counting: %w", err)
	}

	packageCount := len(secdb.Packages)
	uniqueCVEs := make(map[string]struct{})
	for _, pkg := range secdb.Packages {
		for _, cves := range pkg.Pkg.SecFixes {
			for _, cve := range cves {
				uniqueCVEs[cve] = struct{}{}
			}
		}
	}
	cveCount := len(uniqueCVEs)

	logger.Debug("parsed Alpine secdb feed",
		zap.Int("package_count", packageCount),
		zap.Int("cve_count", cveCount))

	// Step 3: Publish feed atomically to R2
	logger.Debug("publishing feed to R2")
	manifest, err := PublishSecDBFeed(ctx, secdbJSON, packageCount, cveCount)
	if err != nil {
		return fmt.Errorf("failed to publish feed to R2: %w", err)
	}

	// Step 5: Log success metrics
	duration := time.Since(startTime)

	// Construct manifest URL from LatestURL by replacing the filename
	manifestURL := manifest.LatestURL[:len(manifest.LatestURL)-len("secdb.json.gz")] + "latest.json"

	logger.Info("Alpine secdb feed published successfully",
		zap.String("duration", duration.String()),
		zap.Int("package_count", manifest.PackageCount),
		zap.Int("cve_count", manifest.CVECount),
		zap.String("manifest_url", manifestURL),
		zap.String("latest_url", manifest.LatestURL),
		zap.String("snapshot_url", manifest.SnapshotURL),
		zap.String("sha256", manifest.SHA256))

	return nil
}
