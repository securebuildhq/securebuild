package telemetry

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
	oteltrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

// instrumentationScope is the name used for the tracer and meter obtained from
// the global providers.
const instrumentationScope = "github.com/securebuildhq/securebuild/pkg/telemetry"

var (
	otelTracer oteltrace.Tracer
	otelMeter  metric.Meter

	// instrument caches, keyed by instrument name, guarded by instMu so we do
	// not recreate instruments on every metric call.
	int64Counters = map[string]metric.Int64Counter{}
	float64Gauges = map[string]metric.Float64Gauge{}
	instMu        sync.Mutex
)

// startOTel initializes OpenTelemetry trace and metric providers, exporting via
// OTLP/HTTP. The exporters honor the standard OTEL_EXPORTER_OTLP_* environment
// variables (endpoint, protocol, headers, etc.) on their own; we only supply
// the resource and pipeline wiring.
//
// Returns a shutdown function that flushes and shuts down both providers within
// a bounded context.
func startOTel(serviceName string) func() {
	ctx := context.Background()

	res, err := buildOTelResource(ctx, serviceName)
	if err != nil {
		logger.Warn("failed to build otel resource, using default", zap.Error(err))
		res = resource.Default()
	}

	// --- Traces ---
	traceExporter, err := otlptracehttp.New(ctx)
	if err != nil {
		logger.Warn("failed to create otlp trace exporter; tracing disabled", zap.Error(err))
		return func() {}
	}

	tracerProvider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tracerProvider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	otelTracer = tracerProvider.Tracer(instrumentationScope)

	// --- Metrics ---
	var meterProvider *sdkmetric.MeterProvider
	metricExporter, err := otlpmetrichttp.New(ctx)
	if err != nil {
		logger.Warn("failed to create otlp metric exporter; metrics disabled", zap.Error(err))
	} else {
		meterProvider = sdkmetric.NewMeterProvider(
			sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter)),
			sdkmetric.WithResource(res),
		)
		otel.SetMeterProvider(meterProvider)
		otelMeter = meterProvider.Meter(instrumentationScope)

		// Enable Go runtime metrics (GC, memory, goroutines, etc.).
		if err := runtime.Start(runtime.WithMeterProvider(meterProvider)); err != nil {
			logger.Warn("failed to start otel runtime metrics", zap.Error(err))
		}
	}

	logger.Info("opentelemetry telemetry initialized", zap.String("service", serviceName))

	return func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := tracerProvider.Shutdown(shutdownCtx); err != nil {
			logger.Warn("failed to shut down otel tracer provider", zap.Error(err))
		}
		if meterProvider != nil {
			if err := meterProvider.Shutdown(shutdownCtx); err != nil {
				logger.Warn("failed to shut down otel meter provider", zap.Error(err))
			}
		}
	}
}

// buildOTelResource constructs the OTel resource describing this service.
// Service name comes from OTEL_SERVICE_NAME if set, otherwise the provided
// serviceName. Environment and version reuse the existing DD_ENV / DD_VERSION
// env vars and are mapped to deployment.environment and service.version.
func buildOTelResource(ctx context.Context, serviceName string) (*resource.Resource, error) {
	service := os.Getenv("OTEL_SERVICE_NAME")
	if service == "" {
		service = serviceName
	}

	env := os.Getenv("DD_ENV")
	if env == "" {
		env = "development"
	}

	attrs := []attribute.KeyValue{
		semconv.ServiceName(service),
		attribute.String("deployment.environment", env),
	}

	if version := os.Getenv("DD_VERSION"); version != "" {
		attrs = append(attrs, semconv.ServiceVersion(version))
	}

	return resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(semconv.SchemaURL, attrs...),
	)
}

// otelSpan adapts an OpenTelemetry span to the neutral Span interface.
type otelSpan struct {
	span oteltrace.Span
}

func (s otelSpan) Finish() {
	s.span.End()
}

// SetTag maps a neutral tag onto an OTel span attribute. The "error" and
// "error.message" keys are routed to span.RecordError / span.SetStatus so the
// span is flagged as errored, matching the historical Datadog semantics used by
// WithSpan and the StartSpan call sites.
func (s otelSpan) SetTag(key string, value interface{}) {
	switch key {
	case "error":
		switch v := value.(type) {
		case error:
			if v != nil {
				s.span.RecordError(v)
				s.span.SetStatus(codes.Error, v.Error())
			}
		case bool:
			if v {
				s.span.SetStatus(codes.Error, "")
			}
		default:
			s.span.SetStatus(codes.Error, "")
		}
		return
	case "error.message":
		if msg, ok := value.(string); ok {
			s.span.SetStatus(codes.Error, msg)
		}
		return
	}

	s.span.SetAttributes(toAttribute(key, value))
}

// toAttribute converts an arbitrary tag value to a typed OTel attribute.
func toAttribute(key string, value interface{}) attribute.KeyValue {
	switch v := value.(type) {
	case string:
		return attribute.String(key, v)
	case bool:
		return attribute.Bool(key, v)
	case int:
		return attribute.Int(key, v)
	case int64:
		return attribute.Int64(key, v)
	case float64:
		return attribute.Float64(key, v)
	case float32:
		return attribute.Float64(key, float64(v))
	case error:
		return attribute.String(key, v.Error())
	default:
		return attribute.String(key, fmt.Sprintf("%v", v))
	}
}

// startSpanOTel starts an OTel span from the context. If the tracer was never
// initialized (e.g. exporter creation failed), it falls back to the global
// provider, which yields a no-op span.
func startSpanOTel(ctx context.Context, operationName string) (Span, context.Context) {
	tracer := otelTracer
	if tracer == nil {
		tracer = otel.Tracer(instrumentationScope)
	}
	ctx, span := tracer.Start(ctx, operationName)
	return otelSpan{span: span}, ctx
}

// --- Metrics ---

func meterOrGlobal() metric.Meter {
	if otelMeter != nil {
		return otelMeter
	}
	return otel.Meter(instrumentationScope)
}

func incrementOTel(name string, tags []string) {
	counter, err := getInt64Counter(name)
	if err != nil {
		logger.Warn("failed to create otel counter", zap.String("name", name), zap.Error(err))
		return
	}
	counter.Add(context.Background(), 1, metric.WithAttributes(tagsToAttributes(tags)...))
}

func gaugeOTel(name string, value float64, tags []string) {
	gauge, err := getFloat64Gauge(name)
	if err != nil {
		logger.Warn("failed to create otel gauge", zap.String("name", name), zap.Error(err))
		return
	}
	gauge.Record(context.Background(), value, metric.WithAttributes(tagsToAttributes(tags)...))
}

func getInt64Counter(name string) (metric.Int64Counter, error) {
	instMu.Lock()
	defer instMu.Unlock()

	if c, ok := int64Counters[name]; ok {
		return c, nil
	}
	c, err := meterOrGlobal().Int64Counter(name)
	if err != nil {
		return nil, err
	}
	int64Counters[name] = c
	return c, nil
}

func getFloat64Gauge(name string) (metric.Float64Gauge, error) {
	instMu.Lock()
	defer instMu.Unlock()

	if g, ok := float64Gauges[name]; ok {
		return g, nil
	}
	g, err := meterOrGlobal().Float64Gauge(name)
	if err != nil {
		return nil, err
	}
	float64Gauges[name] = g
	return g, nil
}

// tagsToAttributes converts DogStatsD-style "key:value" tags into typed OTel
// attributes, splitting on the first ':'. A tag with no ':' becomes a bool
// attribute set to true.
func tagsToAttributes(tags []string) []attribute.KeyValue {
	attrs := make([]attribute.KeyValue, 0, len(tags))
	for _, tag := range tags {
		if tag == "" {
			continue
		}
		if idx := strings.IndexByte(tag, ':'); idx >= 0 {
			attrs = append(attrs, attribute.String(tag[:idx], tag[idx+1:]))
		} else {
			attrs = append(attrs, attribute.Bool(tag, true))
		}
	}
	return attrs
}
