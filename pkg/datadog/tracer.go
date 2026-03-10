package datadog

import (
	"context"
	"os"
	"strings"

	"gopkg.in/DataDog/dd-trace-go.v1/ddtrace"
	"gopkg.in/DataDog/dd-trace-go.v1/ddtrace/tracer"
)

// IsEnabled returns true if Datadog is enabled via environment variables.
// Controls both APM tracing and metrics.
func IsEnabled() bool {
	enabled := strings.ToLower(os.Getenv("DD_ENABLED"))
	return enabled == "true" || enabled == "1"
}

// Start initializes the Datadog tracer if enabled.
// It reads configuration from environment variables:
//   - DD_ENABLED: Set to "true" or "1" to enable Datadog tracing and metrics collection
//   - DD_SERVICE: Service name (defaults to serviceName parameter)
//   - DD_ENV: Environment (defaults to "development")
//   - DD_VERSION: Service version
//   - DD_TRACE_AGENT_URL: Agent URL (e.g., unix:///var/run/datadog/apm.socket)
//   - DD_AGENT_HOST: Agent host (if not using socket)
//   - DD_TRACE_AGENT_PORT: Agent port (default 8126)
//
// Returns a function to stop the tracer that should be deferred.
func Start(serviceName string) func() {
	if !IsEnabled() {
		return func() {} // no-op
	}

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

// noopSpan implements ddtrace.Span as a no-op for when tracing is disabled
type noopSpan struct{}

func (n *noopSpan) SetTag(key string, value interface{})  {}
func (n *noopSpan) SetOperationName(operationName string) {}
func (n *noopSpan) BaggageItem(key string) string         { return "" }
func (n *noopSpan) SetBaggageItem(key, val string)        {}
func (n *noopSpan) Finish(opts ...ddtrace.FinishOption)   {}
func (n *noopSpan) Context() ddtrace.SpanContext          { return &noopSpanContext{} }

type noopSpanContext struct{}

func (n *noopSpanContext) SpanID() uint64                                    { return 0 }
func (n *noopSpanContext) TraceID() uint64                                   { return 0 }
func (n *noopSpanContext) ForeachBaggageItem(handler func(k, v string) bool) {}

var globalNoopSpan ddtrace.Span = &noopSpan{}

// StartSpan starts a new span with the given operation name.
// If Datadog is not enabled, returns a no-op span and the unchanged context.
// Usage:
//
//	span, ctx := datadog.StartSpan(ctx, "operation.name")
//	defer span.Finish()
func StartSpan(ctx context.Context, operationName string, opts ...tracer.StartSpanOption) (ddtrace.Span, context.Context) {
	if !IsEnabled() {
		return globalNoopSpan, ctx
	}

	return tracer.StartSpanFromContext(ctx, operationName, opts...)
}

// WithSpan wraps a function with a Datadog span, automatically handling
// span creation, context propagation, and error tagging.
// Usage:
//
//	return datadog.WithSpan(ctx, "operation.name", func(ctx context.Context) error {
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
