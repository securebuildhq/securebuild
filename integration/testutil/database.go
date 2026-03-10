package testutil

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

type TestDatabase struct {
	Container *postgres.PostgresContainer
	Pool      *pgxpool.Pool
	ConnStr   string
	Host      string
	Port      int
}

// ApplySchemaHero applies SchemaHero schemas or seed data to the test database
func ApplySchemaHero(ctx context.Context, connStr, yamlDir string, isSeedData bool) error {
	projectRoot, err := FindProjectRoot()
	if err != nil {
		return err
	}

	fileType := "schema"
	if isSeedData {
		fileType = "seed data"
	}

	logger.Infof("Applying %s from: %s\n", fileType, filepath.Base(yamlDir))

	// Create temporary DDL file
	tmpFile, err := os.CreateTemp("", fmt.Sprintf("schemahero-%s-*.sql", fileType))
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	ddlFile := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(ddlFile)

	// Run schemahero plan
	planCmd := exec.CommandContext(ctx, "schemahero", "plan",
		"--spec-file", yamlDir,
		"--uri", connStr,
		"--driver", "postgres",
		"--out", ddlFile)
	if isSeedData {
		planCmd.Args = append(planCmd.Args, "--seed-data")
	}
	planCmd.Dir = projectRoot

	if output, err := planCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("schemahero plan failed: %w\nOutput: %s", err, output)
	}

	if isSeedData {
		ddl, err := os.ReadFile(ddlFile)
		if err == nil {
			logger.Debugf("Seed data file: %s\n", ddl)
		}
	}

	// Run schemahero apply
	applyCmd := exec.CommandContext(ctx, "schemahero", "apply",
		"--ddl", ddlFile,
		"--uri", connStr,
		"--driver", "postgres")
	applyCmd.Dir = projectRoot

	if output, err := applyCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("schemahero apply failed: %w\nOutput: %s", err, output)
	}

	logger.Infof("All %s applied successfully\n", fileType)
	return nil
}

// SetupTestDatabase creates a PostgreSQL container and applies schemas
func SetupTestDatabase(ctx context.Context, t *testing.T) *TestDatabase {
	t.Helper()

	logger.Info("Starting PostgreSQL container...")

	container, err := postgres.Run(ctx,
		"postgres:17",
		postgres.WithDatabase("securebuild_test"),
		postgres.WithUsername("test_user"),
		postgres.WithPassword("test_password"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	require.NoError(t, err)

	host, err := container.Host(ctx)
	require.NoError(t, err)

	mappedPort, err := container.MappedPort(ctx, "5432/tcp")
	require.NoError(t, err)
	port := mappedPort.Int()

	connStr := fmt.Sprintf("postgresql://test_user:test_password@%s:%d/securebuild_test?sslmode=disable", host, port)

	logger.Infof("PostgreSQL container started at %s:%d\n", host, port)

	// Create connection pool
	pool, err := pgxpool.New(ctx, connStr)
	require.NoError(t, err)

	// Wait for database to be ready
	ready := false
	for i := 0; i < 30; i++ {
		if err := pool.Ping(ctx); err == nil {
			logger.Info("Database is ready")
			ready = true
			break
		} else {
			logger.Warnf("Database not ready yet: %v\n", err)
		}
		time.Sleep(1 * time.Second)
	}
	require.True(t, ready, "Database failed to become ready after 30 seconds")

	testDB := &TestDatabase{
		Container: container,
		Pool:      pool,
		ConnStr:   connStr,
		Host:      host,
		Port:      port,
	}

	// Apply database schema
	logger.Info("Applying database schemas...")
	projectRoot, err := FindProjectRoot()
	require.NoError(t, err)

	schemaDir := filepath.Join(projectRoot, "db", "schema", "tables")
	err = ApplySchemaHero(ctx, connStr, schemaDir, false)
	require.NoError(t, err)

	return testDB
}

// TeardownTestDatabase cleans up the test database
func TeardownTestDatabase(ctx context.Context, t *testing.T, testDB *TestDatabase) {
	t.Helper()

	logger.Info("Tearing down test database...")

	if testDB.Pool != nil {
		testDB.Pool.Close()
		logger.Info("Database pool closed")
	}

	if testDB.Container != nil {
		if err := testDB.Container.Terminate(ctx); err != nil {
			t.Logf("Failed to terminate container: %v", err)
		}
		logger.Info("Container stopped")
	}

	logger.Info("Test database cleanup completed")
}
