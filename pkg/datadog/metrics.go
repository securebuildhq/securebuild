package datadog

import (
	"fmt"
	"os"
	"sync"

	"github.com/DataDog/datadog-go/v5/statsd"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

var (
	statsClient *statsd.Client
	clientOnce  sync.Once
	clientErr   error
)

// Metric names and channel tags for external image SBOM and scan.
const (
	MetricExternalImageSBOMFailed    = "securebuild.external_image.sbom.failed"
	MetricExternalImageSBOMSucceeded = "securebuild.external_image.sbom.succeeded"
	MetricExternalImageScanFailed    = "securebuild.external_image.scan.failed"
	MetricExternalImageScanSucceeded = "securebuild.external_image.scan.succeeded"

	TagChannelExternalImageSBOM = "channel:external_image_sbom"
	TagChannelExternalImageScan = "channel:external_image_scan"
)

// GetStatsClient returns the global statsd client, initializing it on first call.
// Returns nil if Datadog is not enabled or initialization fails.
//
// The client address is determined by:
//   - DD_AGENT_HOST - Host with default port 8125 (e.g., "localhost:8125")
//   - Default Unix socket at unix:///var/run/datadog/dsd.socket
func GetStatsClient() *statsd.Client {
	clientOnce.Do(func() {
		if !IsEnabled() {
			return
		}

		addr := "unix:///var/run/datadog/dsd.socket"
		if host := os.Getenv("DD_AGENT_HOST"); host != "" {
			addr = fmt.Sprintf("%s:8125", host)
		}

		statsClient, clientErr = statsd.New(addr)
		if clientErr != nil {
			logger.Warn("failed to initialize datadog statsd client",
				zap.String("address", addr),
				zap.Error(clientErr))
			return
		}

		logger.Info("datadog statsd client initialized", zap.String("address", addr))
	})

	return statsClient
}

// Gauge sends a gauge metric to Datadog.
// If Datadog is not enabled or the client failed to initialize, this is a no-op.
func Gauge(name string, value float64, tags []string) {
	client := GetStatsClient()
	if client == nil {
		return
	}

	if err := client.Gauge(name, value, tags, 1); err != nil {
		logger.Warn("failed to send gauge metric",
			zap.String("name", name),
			zap.Float64("value", value),
			zap.Error(err))
	}
}

// Increment sends a counter increment (value 1) to Datadog, use for counting events
// If Datadog is not enabled or the client failed to initialize, this is a no-op.
func Increment(name string, tags []string) {
	client := GetStatsClient()
	if client == nil {
		return
	}

	if err := client.Incr(name, tags, 1); err != nil {
		logger.Warn("failed to send increment metric",
			zap.String("name", name),
			zap.Strings("tags", tags),
			zap.Error(err))
	}
}

// CloseStatsClient closes the statsd client if it was initialized.
// Should be called during application shutdown.
func CloseStatsClient() error {
	// Use GetStatsClient to ensure initialization is complete before closing
	client := GetStatsClient()
	if client != nil {
		return client.Close()
	}
	return nil
}
