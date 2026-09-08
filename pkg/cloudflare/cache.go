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

	_, err := client.Cache.Purge(ctx, cache.CachePurgeParams{
		ZoneID: cloudflare.F(zoneID),
		Body: cache.CachePurgeParamsBodyCachePurgeSingleFile{
			Files: cloudflare.F(urls),
		},
	})

	if err != nil {
		return fmt.Errorf("failed to purge cloudflare cache: %w", err)
	}

	return nil
}
