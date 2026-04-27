package persistence

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/securebuildhq/securebuild/pkg/datadog"
	"github.com/securebuildhq/securebuild/pkg/param"
	pgxtrace "gopkg.in/DataDog/dd-trace-go.v1/contrib/jackc/pgx.v5"
)

var (
	pools   map[string]*pgxpool.Pool // Key: DBURI, Value: pool
	poolsMu sync.RWMutex
)

func init() {
	pools = make(map[string]*pgxpool.Pool)
}

// getDBURI retrieves the DBURI from param in context
func getDBURI(ctx context.Context) (string, error) {
	p := param.TryGetParam(ctx)
	if p == nil {
		return "", fmt.Errorf("param not found in context - call param.Init first")
	}

	if p.DBURI == "" {
		return "", fmt.Errorf("DBURI is empty in param")
	}

	return p.DBURI, nil
}

// InitPostgres initializes postgres pool using DBURI from context
// Creates a pool keyed by DBURI
// In production: pools map will have one entry
// In tests: pools map will have one entry per test database
func InitPostgres(ctx context.Context) error {
	dbURI, err := getDBURI(ctx)
	if err != nil {
		return fmt.Errorf("failed to get DBURI from context: %w", err)
	}

	poolsMu.Lock()
	defer poolsMu.Unlock()

	// Check if pool already exists for this DBURI
	if _, exists := pools[dbURI]; exists {
		// Pool already initialized for this DBURI, reuse it
		return nil
	}

	// Create new pool config
	config, err := pgxpool.ParseConfig(dbURI)
	if err != nil {
		return fmt.Errorf("failed to parse db uri: %w", err)
	}

	// Set pool size
	config.MaxConns = 40
	config.MaxConnIdleTime = 30 * time.Second

	// Create pool - use traced version if Datadog is enabled
	var pool *pgxpool.Pool
	if datadog.IsEnabled() {
		pool, err = pgxtrace.NewPoolWithConfig(context.Background(), config)
	} else {
		pool, err = pgxpool.NewWithConfig(context.Background(), config)
	}
	if err != nil {
		return fmt.Errorf("failed to create pool: %w", err)
	}

	// Test connection
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// Store pool keyed by DBURI
	pools[dbURI] = pool

	return nil
}

// MustGetPooledPostgresSession retrieves the pool from context
// Uses DBURI from param in context to look up the pool
func MustGetPooledPostgresSession(ctx context.Context) *pgxpool.Conn {
	dbURI, err := getDBURI(ctx)
	if err != nil {
		panic("DBURI not found in context: " + err.Error())
	}

	poolsMu.RLock()
	pool, exists := pools[dbURI]
	poolsMu.RUnlock()

	if !exists {
		panic(fmt.Sprintf("postgres pool not initialized for DBURI %s - call InitPostgres first", maskDBURI(dbURI)))
	}

	conn, err := pool.Acquire(ctx)
	if err != nil {
		panic("failed to acquire from Postgres pool: " + err.Error())
	}

	return conn
}

// GetPooledPostgresSessionWithTimeout retrieves pool with timeout check
func GetPooledPostgresSessionWithTimeout(ctx context.Context, timeout time.Duration) (*pgxpool.Conn, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	dbURI, err := getDBURI(ctx)
	if err != nil {
		return nil, fmt.Errorf("DBURI not found in context: %w", err)
	}

	poolsMu.RLock()
	pool, exists := pools[dbURI]
	poolsMu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("postgres pool not initialized for DBURI %s - call InitPostgres first", maskDBURI(dbURI))
	}

	conn, err := pool.Acquire(timeoutCtx)
	if err != nil {
		return nil, err
	}

	return conn, nil
}

// ClosePool closes the postgres pool for the DBURI in context
func ClosePool(ctx context.Context) {
	dbURI, err := getDBURI(ctx)
	if err != nil {
		return
	}

	poolsMu.Lock()
	defer poolsMu.Unlock()

	if pool, exists := pools[dbURI]; exists {
		pool.Close()
		delete(pools, dbURI)
	}
}

// Shutdown closes all pools (for graceful shutdown)
func Shutdown() {
	poolsMu.Lock()
	defer poolsMu.Unlock()

	for dbURI, pool := range pools {
		pool.Close()
		delete(pools, dbURI)
	}
}

// maskDBURI masks sensitive parts of DBURI for logging
func maskDBURI(uri string) string {
	if idx := strings.Index(uri, "@"); idx > 0 {
		return "***" + uri[idx:]
	}
	return "***"
}
