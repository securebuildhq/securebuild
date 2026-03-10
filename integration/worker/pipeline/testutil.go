package pipeline

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	pkgtestutil "github.com/securebuildhq/securebuild/pkg/testutil"
	"github.com/stretchr/testify/require"
)

type pipelineTestSetup struct {
	Ctx          context.Context
	testDB       *testutil.TestDatabase
	pipelinesDir string
}

// setupPipelineTest performs all common setup operations for pipeline integration tests:
// - Creates test database
// - Applies seed data
// - Creates temporary pipeline directory
// - Initializes param with test overrides
// - Initializes persistence
// - Returns the context, test database, and pipelines directory
func setupPipelineTest(t *testing.T) pipelineTestSetup {
	t.Helper()

	ctx := context.Background()

	// Setup database
	testDB := testutil.SetupTestDatabase(ctx, t)

	// Apply seed data using SchemaHero
	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	seedDataDir := filepath.Join(projectRoot, "integration", "worker", "pipeline", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	// Create a temporary pipeline directory for this test using shared helper
	pipelinesDir := pkgtestutil.SetupTestPipelineDir(t)

	// Initialize param with test overrides
	overrides := map[string]string{
		"DB_URI":       testDB.ConnStr,
		"PIPELINE_DIR": pipelinesDir,
	}
	ctx, err = param.Init(param.InitSourceEnvironment, overrides)
	require.NoError(t, err)

	// Initialize persistence
	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)

	return pipelineTestSetup{
		Ctx:          ctx,
		testDB:       testDB,
		pipelinesDir: pipelinesDir,
	}
}

// teardown cleans up all test resources
func (s *pipelineTestSetup) teardown(t *testing.T) {
	t.Helper()

	persistence.ClosePool(s.Ctx)
	// No need to remove pipelinesDir - SetupTestPipelineDir registers cleanup automatically
	testutil.TeardownTestDatabase(s.Ctx, t, s.testDB)
}
