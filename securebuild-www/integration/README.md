# Integration Tests

This directory contains integration tests for the securebuild-www Next.js application, specifically testing API endpoints with a real PostgreSQL database.

## Structure

```
integration/
  api/
    v1/
      external-image.test.ts    # Tests for External Image API endpoints
      seed-data/                # Seed data for external-image tests
  lib/
    team/
      actions.test.ts           # Tests for team server actions
      seed-data/                # Seed data for team tests
        securebuild-user.yaml   # Test user seed data
        securebuild-team.yaml   # Test team seed data
        user-team.yaml          # User-team relationship seed data
  fixtures/
    database.ts                 # Database container setup with SchemaHero
    auth.ts                     # Test team and service account creation
  jest.config.js                # Jest configuration for integration tests
  setup.ts                      # Global test setup
  README.md                     # This file
```

## Prerequisites

Before running integration tests, ensure you have:

1. **Docker**: Testcontainers requires Docker to be running
2. **SchemaHero CLI v0.22.1+**: Install with `brew install schemahero/tap/schemahero` (macOS) or download from [SchemaHero releases](https://github.com/schemahero/schemahero/releases/tag/v0.22.1)
3. **Node.js 20+**: Required for Next.js and Jest
4. **Node modules**: Run `npm install` in the securebuild-www directory

## Running Tests

```bash
# Run all integration tests
npm run test:integration

# Run integration tests in watch mode (not recommended due to container overhead)
npm run test:integration -- --watch

# Run a specific test file
npm run test:integration -- integration/api/v1/external-image.test.ts

# Run with verbose output
npm run test:integration -- --verbose
```

## How It Works

### 1. Database Setup (`fixtures/database.ts`)

The `setupTestDatabase()` function:
- Starts a PostgreSQL 17 container using Testcontainers
- Applies all 74+ database schemas from `db/schema/tables/` using SchemaHero CLI v0.22.1
- Optionally applies seed data from test-specific `seed-data/` directories
- Returns a `TestDatabase` object with connection string and pool

Each test suite gets its own isolated PostgreSQL container to ensure test independence. The database uses a multi-pool architecture for proper test isolation.

### 2. Authentication Setup (`fixtures/auth.ts`)

The `createTestTeamWithServiceAccount()` function:
- Creates a test team in the `securebuild_team` table
- Generates a service account token using SHA-256 hashing (same as production)
- Returns the raw token for API authentication

This matches the production authentication flow in `lib/team/service-account.ts`.

### 3. Seed Data

Tests can use SchemaHero seed data for deterministic test fixtures:
- Create a `seed-data/` directory next to your test file
- Add `.yaml` files with seed data (follows SchemaHero seed data format)
- Call `applySchemaHero(testDB, seedDataDir, true)` in `beforeAll()`
- Seed data dependencies managed via `requires` field (e.g., `user-team.yaml` requires `securebuild-user` and `securebuild-team`)

Example seed data file (`securebuild-user.yaml`):
```yaml
database: securebuild
name: securebuild_user
seedData:
  rows:
    - columns:
        - column: id
          value:
            str: "test-user-123"
        - column: email
          value:
            str: "test@example.com"
```

### 4. Test Execution

Each test suite:
1. Sets up a fresh database container in `beforeAll()`
2. Applies schemas and optionally seed data via SchemaHero
3. Makes API requests or calls server actions directly
4. Asserts on responses
5. Cleans up pools and containers in `afterAll()`

## Test Configuration

The `jest.config.js` file is configured with:
- **Test environment**: `node` (not browser)
- **Timeout**: 120 seconds (allows for container startup and schema application)
- **Max workers**: `50%` (parallel execution using 50% of CPU cores)
- **Test pattern**: `**/integration/**/*.test.ts`
- **Setup file**: `integration/setup.ts` (global test setup)

The multi-pool architecture in `lib/data/db.ts` ensures test isolation even with parallel execution - each test suite gets its own database connection pool.

## Writing New Tests

### Option 1: API Endpoint Tests (with dynamic fixtures)

```typescript
import { setupTestDatabase, teardownTestDatabase, TestDatabase } from '../../fixtures/database';
import { createTestTeamWithServiceAccount } from '../../fixtures/auth';

describe('My API Endpoint', () => {
  let testDB: TestDatabase;
  let authToken: string;

  beforeAll(async () => {
    testDB = await setupTestDatabase();
    const { token } = await createTestTeamWithServiceAccount(testDB.pool);
    authToken = token;
  });

  afterAll(async () => {
    await teardownTestDatabase(testDB);
  });

  it('should do something', async () => {
    // Make API request with authToken
    // Assert on response
  });
});
```

### Option 2: Server Action Tests (with seed data)

```typescript
import path from 'path';
import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from '../../fixtures/database';
import { getTeamAction } from '@/lib/team/actions';

describe('Team Actions', () => {
  let testDB: TestDatabase;
  const seedDataDir = path.join(__dirname, 'seed-data');

  beforeAll(async () => {
    testDB = await setupTestDatabase();
    await applySchemaHero(testDB, seedDataDir, true);
  });

  afterAll(async () => {
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);
    await teardownTestDatabase(testDB);
  });

  it('should get team by id', async () => {
    const result = await getTeamAction('test-team-beta');
    expect(result.team).toBeDefined();
    expect(result.team?.id).toBe('test-team-beta');
  });
});
```

**Key differences:**
- API tests use `createTestTeamWithServiceAccount()` for dynamic fixtures
- Server action tests use seed data YAML files for deterministic fixtures
- Server action tests must call `closePoolByUri()` in `afterAll()` for proper cleanup

## Troubleshooting

### Container fails to start

- Ensure Docker is running: `docker ps`
- Check Docker has enough resources (2GB+ RAM recommended)
- Try pulling the image manually: `docker pull postgres:17`

### Schema application fails

- Verify SchemaHero is installed: `schemahero version`
- Check schema files exist: `ls -la ../../db/schema/tables/`
- Look for syntax errors in YAML schema files

### Tests timeout

- Increase timeout in `jest.config.js` (default: 120000ms)
- Check container logs: `docker logs <container_id>`
- Ensure your machine has sufficient resources

### Token authentication fails

- Verify the token starts with `sbld_sa_` prefix
- Check the service account was created: `SELECT * FROM service_account`
- Ensure hash_algorithm is 'sha256'

## Design Principles

The integration tests follow these principles:

- **Isolation**: Each test suite gets its own PostgreSQL container via Testcontainers
- **Multi-Pool Architecture**: `lib/data/db.ts` uses separate pools per test database in test mode, enabling parallel execution
- **Real Database**: Tests use SchemaHero v0.22.1 to apply production schemas and seed data
- **Production-like**: Service account authentication uses the same SHA-256 hashing as production
- **No HTTP Server**: Tests invoke Next.js route handlers and server actions directly for speed
- **Flexible Fixtures**: Choose dynamic fixtures (via code) or deterministic seed data (via YAML)
- **Parallel Execution**: Tests run in parallel (50% CPU cores) with proper isolation guarantees

## CI/CD Integration

The integration tests run in GitHub Actions (`.github/workflows/integration.yml`):
- Node.js 20
- SchemaHero CLI v0.22.1 installed
- Docker available for Testcontainers
- No external PostgreSQL service needed (Testcontainers handles it)
- Runs with `npm run test:integration`
- Parallel execution enabled for faster CI runs
