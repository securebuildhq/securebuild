// Package telemetry provides a backend-switchable observability layer.
//
// Two tracing/metrics backends are supported, selected at runtime by the
// TELEMETRY_BACKEND environment variable:
//
//   - "datadog": ship traces via dd-trace-go and metrics via DogStatsD
//     (the historical behaviour of this package).
//   - "otlp": ship traces and metrics via OpenTelemetry OTLP/HTTP exporters
//     (e.g. to a local Grafana Alloy collector).
//   - "" / "none": telemetry is disabled (no-op).
//
// Backwards compatibility: when TELEMETRY_BACKEND is unset/empty and the
// legacy DD_ENABLED env var is truthy ("true"/"1"), the backend resolves to
// "datadog".
//
// The public surface of this package (IsEnabled, Start, StartSpan, WithSpan,
// the metric helpers and the metric/tag name constants) is intentionally
// backend-neutral so call sites do not need to know which backend is active.
package telemetry

import (
	"context"
	"os"
	"strings"
	"sync"
)

// Backend identifies the active telemetry backend.
type Backend string

const (
	BackendNone    Backend = "none"
	BackendDatadog Backend = "datadog"
	BackendOTLP    Backend = "otlp"
)

var (
	resolvedBackend Backend
	backendOnce     sync.Once
)

// resolveBackend determines the active backend from configuration. It is
// resolved once and cached for the lifetime of the process so every call site
// observes a consistent value.
func resolveBackend() Backend {
	backendOnce.Do(func() {
		resolvedBackend = computeBackend()
	})
	return resolvedBackend
}

func computeBackend() Backend {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("TELEMETRY_BACKEND"))) {
	case "datadog", "dd":
		return BackendDatadog
	case "otlp", "otel", "opentelemetry":
		return BackendOTLP
	case "none", "off", "disabled":
		return BackendNone
	case "":
		// Backwards compatibility: fall back to DD_ENABLED.
		if ddEnabledFromEnv() {
			return BackendDatadog
		}
		return BackendNone
	default:
		return BackendNone
	}
}

// ddEnabledFromEnv reports whether the legacy DD_ENABLED env var is truthy.
func ddEnabledFromEnv() bool {
	enabled := strings.ToLower(strings.TrimSpace(os.Getenv("DD_ENABLED")))
	return enabled == "true" || enabled == "1"
}

// Span is the backend-neutral span abstraction used by call sites. It exposes
// only the operations the codebase needs: finishing the span and tagging it.
//
// Setting a tag with key "error" (or "error.message") and a non-nil value flags
// the span as errored on backends that support it.
type Span interface {
	Finish()
	SetTag(key string, value interface{})
}

// IsEnabled returns true when a telemetry backend other than "none" is active.
// It controls both tracing and metrics, mirroring the historical Datadog
// behaviour.
func IsEnabled() bool {
	return resolveBackend() != BackendNone
}

// Start initializes the active telemetry backend for the given service name and
// returns a shutdown function that should be deferred. When telemetry is
// disabled the returned function is a no-op.
func Start(serviceName string) func() {
	switch resolveBackend() {
	case BackendDatadog:
		return startDatadog(serviceName)
	case BackendOTLP:
		return startOTel(serviceName)
	default:
		return func() {}
	}
}

// StartSpan starts a new span with the given operation name and returns it along
// with a context carrying the span. When telemetry is disabled a no-op span and
// the unchanged context are returned.
//
// Usage:
//
//	span, ctx := telemetry.StartSpan(ctx, "operation.name")
//	defer span.Finish()
func StartSpan(ctx context.Context, operationName string) (Span, context.Context) {
	switch resolveBackend() {
	case BackendDatadog:
		return startSpanDatadog(ctx, operationName)
	case BackendOTLP:
		return startSpanOTel(ctx, operationName)
	default:
		return noopSpan{}, ctx
	}
}

// WithSpan wraps fn in a span, automatically handling span creation, context
// propagation, and error tagging.
//
// Usage:
//
//	return telemetry.WithSpan(ctx, "operation.name", func(ctx context.Context) error {
//	    // your code here, use ctx for nested spans
//	    return nil
//	})
func WithSpan(ctx context.Context, operationName string, fn func(ctx context.Context) error) error {
	span, ctx := StartSpan(ctx, operationName)
	defer span.Finish()

	err := fn(ctx)
	if err != nil {
		span.SetTag("error", true)
		span.SetTag("error.message", err.Error())
	}
	return err
}

// Gauge sends a gauge metric. When telemetry is disabled this is a no-op.
func Gauge(name string, value float64, tags []string) {
	switch resolveBackend() {
	case BackendDatadog:
		gaugeDatadog(name, value, tags)
	case BackendOTLP:
		gaugeOTel(name, value, tags)
	}
}

// Increment sends a counter increment (value 1), used for counting events. When
// telemetry is disabled this is a no-op.
func Increment(name string, tags []string) {
	switch resolveBackend() {
	case BackendDatadog:
		incrementDatadog(name, tags)
	case BackendOTLP:
		incrementOTel(name, tags)
	}
}

// CloseStatsClient closes any open metrics client. Should be called during
// application shutdown. For the OTLP backend, metric shutdown is handled by the
// function returned from Start; this remains a no-op there.
func CloseStatsClient() error {
	switch resolveBackend() {
	case BackendDatadog:
		return closeStatsClientDatadog()
	default:
		return nil
	}
}

// noopSpan is the backend-neutral no-op span used when telemetry is disabled.
type noopSpan struct{}

func (noopSpan) Finish()                              {}
func (noopSpan) SetTag(key string, value interface{}) {}
