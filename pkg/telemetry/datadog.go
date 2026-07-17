package telemetry

import (
	"context"
	"fmt"
	"os"
	"sync"

	"github.com/DataDog/datadog-go/v5/statsd"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
	"gopkg.in/DataDog/dd-trace-go.v1/ddtrace"
	"gopkg.in/DataDog/dd-trace-go.v1/ddtrace/tracer"
)

// Metric names and channel tags for external image SBOM and scan.
//
// These are backend-neutral identifiers used by call sites; the active backend
// translates them as appropriate (DogStatsD metric names for Datadog, OTLP
// instrument names + attributes for OpenTelemetry).
const (
	MetricExternalImageSBOMFailed    = "securebuild.external_image.sbom.failed"
	MetricExternalImageSBOMSucceeded = "securebuild.external_image.sbom.succeeded"
	MetricExternalImageScanFailed    = "securebuild.external_image.scan.failed"
	MetricExternalImageScanSucceeded = "securebuild.external_image.scan.succeeded"

	MetricExternalImageScanBacklog  = "securebuild.external_image.scan.backlog"
	MetricExternalImageScansRunning = "securebuild.external_image.scan.running"

	MetricExternalImageScanCapacityTotal = "securebuild.external_image.scan.capacity.total"
	MetricExternalImageScanCapacityUsed  = "securebuild.external_image.scan.capacity.used"

	TagChannelExternalImageSBOM = "channel:external_image_sbom"
	TagChannelExternalImageScan = "channel:external_image_scan"

	TagScanTier = "tier"
)

// --- Tracing (dd-trace-go) ---

// startDatadog initializes the Datadog tracer. It reads configuration from
// environment variables:
//   - DD_SERVICE: Service name (defaults to serviceName parameter)
//   - DD_ENV: Environment (defaults to "development")
//   - DD_VERSION: Service version
//   - DD_TRACE_AGENT_URL: Agent URL (e.g., unix:///var/run/datadog/apm.socket)
//   - DD_AGENT_HOST: Agent host (if not using socket)
//   - DD_TRACE_AGENT_PORT: Agent port (default 8126)
//
// Returns a function to stop the tracer that should be deferred.
func startDatadog(serviceName string) func() {
	// Get service name from env or use default
	service := os.Getenv("DD_SERVICE")
	if service == "" {
		service = serviceName
	}

	// Get environment from env or default to development
	env := os.Getenv("DD_ENV")
	if env == "" {
		env = "development"
	}

	// Get version from env
	version := os.Getenv("DD_VERSION")

	opts := []tracer.StartOption{
		tracer.WithService(service),
		tracer.WithEnv(env),
		tracer.WithRuntimeMetrics(),
	}

	if version != "" {
		opts = append(opts, tracer.WithServiceVersion(version))
	}

	tracer.Start(opts...)

	return func() {
		tracer.Stop()
	}
}

// ddSpan adapts a dd-trace-go span to the neutral Span interface.
type ddSpan struct {
	span ddtrace.Span
}

func (s ddSpan) Finish() {
	s.span.Finish()
}

func (s ddSpan) SetTag(key string, value interface{}) {
	s.span.SetTag(key, value)
}

// startSpanDatadog starts a dd-trace-go span from the context.
func startSpanDatadog(ctx context.Context, operationName string) (Span, context.Context) {
	span, ctx := tracer.StartSpanFromContext(ctx, operationName)
	return ddSpan{span: span}, ctx
}

// --- Metrics (DogStatsD) ---

var (
	statsClient *statsd.Client
	clientOnce  sync.Once
	clientErr   error
)

// getStatsClient returns the global statsd client, initializing it on first
// call. Returns nil if initialization fails.
//
// The client address is determined by:
//   - DD_AGENT_HOST - Host with default port 8125 (e.g., "localhost:8125")
//   - Default Unix socket at unix:///var/run/datadog/dsd.socket
func getStatsClient() *statsd.Client {
	clientOnce.Do(func() {
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

func gaugeDatadog(name string, value float64, tags []string) {
	client := getStatsClient()
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

func incrementDatadog(name string, tags []string) {
	client := getStatsClient()
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

func closeStatsClientDatadog() error {
	// Use getStatsClient to ensure initialization is complete before closing
	client := getStatsClient()
	if client != nil {
		return client.Close()
	}
	return nil
}
