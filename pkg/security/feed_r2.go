package security

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/securebuildhq/securebuild/pkg/cloudflare"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/storage"
	"go.uber.org/zap"
)

// Manifest represents the metadata for the Alpine secdb feed
type Manifest struct {
	LatestURL    string `json:"latest_url"`
	SnapshotURL  string `json:"snapshot_url"`
	SHA256       string `json:"sha256"`
	PublishedAt  int64  `json:"published_at"`
	PackageCount int    `json:"package_count"`
	CVECount     int    `json:"cve_count"`
	Version      string `json:"version"`
}

// PublishSecDBFeed implements the atomic publish workflow for Alpine secdb feeds
// Returns the manifest metadata after successful publication
func PublishSecDBFeed(ctx context.Context, secdbJSON string, packageCount, cveCount int) (*Manifest, error) {
	// Create R2 storage client
	r2Client, err := storage.NewR2Client(ctx, param.GetParam(ctx).R2FeedBucketName)
	if err != nil {
		return nil, fmt.Errorf("failed to create R2 client: %w", err)
	}
	logger.Info("starting Alpine secdb feed publication",
		zap.Int("package_count", packageCount),
		zap.Int("cve_count", cveCount),
	)

	// Step 1: Compress the Alpine secdb JSON
	compressed, err := compressGzip([]byte(secdbJSON))
	if err != nil {
		return nil, fmt.Errorf("failed to compress Alpine secdb feed: %w", err)
	}

	// Calculate SHA256 of compressed data
	// Consumers will verify this hash on the compressed .gz file
	sha256Hash := calculateSHA256(compressed)

	// Step 2: Upload to staging key
	stagingKey := "v1/secdb-new.json.gz"
	logger.Info("uploading to staging", zap.String("key", stagingKey))
	if err := r2Client.PutObject(ctx, stagingKey, bytes.NewReader(compressed)); err != nil {
		return nil, fmt.Errorf("failed to upload to staging: %w", err)
	}

	// Step 3: Validate the uploaded file
	if err := validateUploadedFile(ctx, r2Client, stagingKey, compressed); err != nil {
		// Cleanup on validation failure
		_ = r2Client.DeleteObject(ctx, stagingKey)
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Step 4: Atomic copy to rolling feed
	rollingKey := "v1/secdb.json.gz"
	logger.Info("copying to rolling feed", zap.String("key", rollingKey))
	if err := r2Client.CopyObject(ctx, stagingKey, rollingKey); err != nil {
		return nil, fmt.Errorf("failed to copy to rolling feed: %w", err)
	}

	// Step 5: Create pinned snapshot
	timestamp := time.Now().UTC().Format("20060102-150405")
	snapshotKey := fmt.Sprintf("v1/secdb-%s.json.gz", timestamp)
	logger.Info("creating pinned snapshot", zap.String("key", snapshotKey))
	if err := r2Client.CopyObject(ctx, stagingKey, snapshotKey); err != nil {
		return nil, fmt.Errorf("failed to create pinned snapshot: %w", err)
	}

	// Step 6: Generate and upload manifest
	manifest := &Manifest{
		LatestURL:    "https://security.secureos.io/v1/secdb.json.gz",
		SnapshotURL:  fmt.Sprintf("https://security.secureos.io/v1/secdb-%s.json.gz", timestamp),
		SHA256:       sha256Hash,
		PublishedAt:  time.Now().Unix(),
		PackageCount: packageCount,
		CVECount:     cveCount,
		Version:      "v1",
	}

	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal manifest: %w", err)
	}

	manifestKey := "v1/latest.json"
	logger.Info("uploading manifest", zap.String("key", manifestKey))
	if err := r2Client.PutObject(ctx, manifestKey, bytes.NewReader(manifestJSON)); err != nil {
		return nil, fmt.Errorf("failed to upload manifest: %w", err)
	}

	// Step 7: Purge CloudFlare cache for latest.json and secdb.json.gz
	p := param.GetParam(ctx)
	manifestURL := "https://security.secureos.io/v1/latest.json"
	urlsToPurge := []string{
		manifestURL,
		manifest.LatestURL, // https://security.secureos.io/v1/secdb.json.gz
	}
	logger.Info("purging CloudFlare cache", zap.Strings("urls", urlsToPurge))
	if err := cloudflare.PurgeCache(ctx, p.CloudflareZoneID, p.CloudflareCachePurgeToken, urlsToPurge); err != nil {
		// Log but don't fail - the feed is already published
		logger.Warn("failed to purge CloudFlare cache", zap.Strings("urls", urlsToPurge), zap.Error(err))
	}

	// Step 8: Cleanup staging file
	if err := r2Client.DeleteObject(ctx, stagingKey); err != nil {
		// Log but don't fail - the feed is already published
		logger.Warn("failed to delete staging file", zap.String("key", stagingKey), zap.Error(err))
	}

	logger.Info("Alpine secdb feed published successfully",
		zap.String("rolling_url", manifest.LatestURL),
		zap.String("snapshot_url", manifest.SnapshotURL),
		zap.String("sha256", sha256Hash),
	)

	return manifest, nil
}

// =============================================================================
// Internal Helper Functions (Feed Publishing)
// =============================================================================

// compressGzip compresses data using gzip
func compressGzip(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	gzWriter := gzip.NewWriter(&buf)

	if _, err := gzWriter.Write(data); err != nil {
		return nil, fmt.Errorf("failed to write gzip data: %w", err)
	}

	if err := gzWriter.Close(); err != nil {
		return nil, fmt.Errorf("failed to close gzip writer: %w", err)
	}

	return buf.Bytes(), nil
}

// calculateSHA256 calculates the SHA256 hash of data
func calculateSHA256(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

// validateUploadedFile validates that the uploaded file matches the original data
func validateUploadedFile(ctx context.Context, r2Client *storage.R2Client, key string, originalData []byte) error {
	// Download the file using the R2Client's GetObject method
	result, err := r2Client.GetObject(ctx, key)
	if err != nil {
		return fmt.Errorf("failed to download file for validation: %w", err)
	}
	defer result.Body.Close()

	downloadedData, err := io.ReadAll(result.Body)
	if err != nil {
		return fmt.Errorf("failed to read downloaded file: %w", err)
	}

	// Validate gzip integrity
	if err := validateGzipIntegrity(downloadedData); err != nil {
		return fmt.Errorf("gzip integrity check failed: %w", err)
	}

	// Validate SHA256
	originalHash := calculateSHA256(originalData)
	downloadedHash := calculateSHA256(downloadedData)
	if originalHash != downloadedHash {
		return fmt.Errorf("SHA256 mismatch: expected %s, got %s", originalHash, downloadedHash)
	}

	// Validate size sanity check (compressed should be smaller than 100MB)
	if len(downloadedData) > 100*1024*1024 {
		return fmt.Errorf("file size exceeds sanity check limit: %d bytes", len(downloadedData))
	}

	return nil
}

// validateGzipIntegrity validates that data is valid gzip
func validateGzipIntegrity(data []byte) error {
	gzReader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gzReader.Close()

	// Try to read the entire content to ensure it's valid
	_, err = io.ReadAll(gzReader)
	if err != nil {
		return fmt.Errorf("failed to decompress gzip data: %w", err)
	}

	return nil
}
