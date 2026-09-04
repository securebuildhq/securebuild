package cloudflare

import (
	"context"
	"fmt"

	"github.com/cloudflare/cloudflare-go/v3"
	"github.com/cloudflare/cloudflare-go/v3/cache"
	"github.com/cloudflare/cloudflare-go/v3/option"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

// PurgeCache purges CloudFlare cache for the given URLs
func PurgeCache(ctx context.Context, zoneID, apiKey string, urls []string) error {
	// Skip if not configured (dev/test environments)
	if zoneID == "" || apiKey == "" {
		logger.Debug("Skipping Cloudflare cache purge because zoneID or apiKey is empty", zap.Strings("urls", urls))
		return nil
	}

	if len(urls) == 0 {
		return nil
	}

	client := cloudflare.NewClient(
		option.WithAPIToken(apiKey),
	)

	// Cloudflare accepts at most 100 URLs in a single-file purge request on
	// non-Enterprise plans. Every batch must succeed before publication can be
	// acknowledged.
	for batchIndex, batch := range splitPurgeURLs(urls, 100) {
		_, err := client.Cache.Purge(ctx, cache.CachePurgeParams{
			ZoneID: cloudflare.F(zoneID),
			Body: cache.CachePurgeParamsBodyCachePurgeSingleFile{
				Files: cloudflare.F(batch),
			},
		})
		if err != nil {
			return fmt.Errorf("failed to purge cloudflare cache batch %d: %w", batchIndex, err)
		}
	}

	return nil
}

func splitPurgeURLs(urls []string, limit int) [][]string {
	if limit <= 0 {
		return nil
	}
	batches := make([][]string, 0, (len(urls)+limit-1)/limit)
	for start := 0; start < len(urls); start += limit {
		end := start + limit
		if end > len(urls) {
			end = len(urls)
		}
		batches = append(batches, urls[start:end])
	}
	return batches
}
