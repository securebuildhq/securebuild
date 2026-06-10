package telemetry

import (
	"context"

	"github.com/exaring/otelpgx"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	otelgin "go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	gintrace "gopkg.in/DataDog/dd-trace-go.v1/contrib/gin-gonic/gin"
	pgxtrace "gopkg.in/DataDog/dd-trace-go.v1/contrib/jackc/pgx.v5"
)

// NewPgxPool creates a pgx connection pool with database tracing appropriate for
// the active telemetry backend:
//
//   - datadog: dd-trace-go's traced pool constructor.
//   - otlp:    a plain pool with an otelpgx tracer attached to the config.
//   - none:    a plain, untraced pool.
//
// The provided config is used as-is for connection settings; for the OTLP
// backend its ConnConfig.Tracer is set before the pool is created.
func NewPgxPool(ctx context.Context, config *pgxpool.Config) (*pgxpool.Pool, error) {
	switch resolveBackend() {
	case BackendDatadog:
		return pgxtrace.NewPoolWithConfig(ctx, config)
	case BackendOTLP:
		config.ConnConfig.Tracer = otelpgx.NewTracer()
		return pgxpool.NewWithConfig(ctx, config)
	default:
		return pgxpool.NewWithConfig(ctx, config)
	}
}

// GinMiddleware returns a gin middleware that traces requests using the active
// telemetry backend:
//
//   - datadog: dd-trace-go's gin middleware.
//   - otlp:    the otelgin middleware.
//   - none:    a passthrough middleware.
//
// It is always safe to install unconditionally.
func GinMiddleware(service string) gin.HandlerFunc {
	switch resolveBackend() {
	case BackendDatadog:
		return gintrace.Middleware(service)
	case BackendOTLP:
		return otelgin.Middleware(service)
	default:
		return func(c *gin.Context) { c.Next() }
	}
}
