# Integration Tests

This directory contains integration tests for the securebuild-app Next.js application, testing API endpoints and server actions with a real PostgreSQL database.

## Structure

```
integration/
  api/
    v1/
      create-package.test.ts        # Tests for POST /api/create-package
      create-package-release.test.ts # Tests for POST /api/create-package-release
      create-image.test.ts          # Tests for POST /api/create-image
      seed-data/                    # Seed data for API tests
        securebuild-team.yaml       # Test team seed data
  lib/
    catalog/
      actions.test.ts               # Tests for catalog server actions
      seed-data/                    # Seed data for catalog tests
        securebuild-user.yaml       # Test user seed data
        securebuild-team.yaml       # Test team seed data
        user-team.yaml              # User-team relationship seed data
  fixtures/
    database.ts                     # Database container setup with SchemaHero
    auth.ts                         # Test service account creation utilities
  jest.config.js                    # Jest configuration for integration tests
  setup.ts                          # Global test setup
  README.md                         # This file
```

## Prerequisites

Before running integration tests, ensure you have:

1. **Docker**: Testcontainers requires Docker to be running
2. **SchemaHero CLI v0.22.1+**: Install with `brew install schemahero/tap/schemahero` (macOS) or download from [SchemaHero releases](https://github.com/schemahero/schemahero/releases/tag/v0.22.1)
3. **Node.js 20+**: Required for Next.js and Jest
4. **Node modules**: Run `npm install` in the securebuild-app directory

## Running Tests

```bash
# Run all integration tests
npm run test:integration

# Run integration tests in watch mode (not recommended due to container overhead)
npm run test:integration -- --watch

# Run a specific test file
npm run test:integration -- integration/api/v1/create-package.test.ts

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

The `createTestServiceAccount()` function:
- Creates a test service account in the `service_account` table
- Generates a token using SHA-256 hashing (same as production)
- Returns the raw token for API authentication

This matches the production authentication flow in `lib/team/token.ts`.

### 3. Seed Data

Tests can use SchemaHero seed data for deterministic test fixtures:
- Create a `seed-data/` directory next to your test file
- Add `.yaml` files with seed data (follows SchemaHero seed data format)
- Call `applySchemaHero(testDB, seedDataDir, true)` in `beforeAll()`
- Seed data dependencies managed via `requires` field

Example seed data file (`securebuild-team.yaml`):
```yaml
database: securebuild
name: securebuild_team
seedData:
  rows:
    - columns:
        - column: id
          value:
            str: "test-team-gamma"
        - column: name
          value:
            str: "Test Team Gamma"
```

### 4. Test Execution

Each test suite:
1. Sets up a fresh database container in `beforeAll()`
2. Applies schemas and optionally seed data via SchemaHero
3. Makes API requests or calls server actions directly
4. Asserts on responses and database state
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

### Option 1: API Endpoint Tests (with bearer token auth)

```typescript
// Store the test connection string for this test suite
let testConnectionString: string;

// Mock getParam to return this test's connection string
jest.mock("@/lib/data/param", () => ({
  getParam: jest.fn(async (key: string) => {
    if (key === "DB_URI" || key === "DBUri") {
      return testConnectionString;
    }
    throw new Error(`unknown param ${key}`);
  }),
  loadParams: jest.fn(),
}));

import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from '../../fixtures/database';
import { createTestServiceAccount } from '../../fixtures/auth';
import path from 'path';

describe('My API Endpoint', () => {
  let testDB: TestDatabase;
  let authToken: string;

  beforeAll(async () => {
    testDB = await setupTestDatabase();
    testConnectionString = testDB.connectionString;

    // Apply seed data
    const seedDataDir = path.join(__dirname, 'seed-data');
    await applySchemaHero(testDB, seedDataDir, true);

    // Create service account
    const serviceAccount = await createTestServiceAccount(testDB.pool, 'test-team-id');
    authToken = serviceAccount.token;
  });

  afterAll(async () => {
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);
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
// Store the test connection string for this test suite
let testConnectionString: string;

// Mock getParam to return this test's connection string
jest.mock("@/lib/data/param", () => ({
  getParam: jest.fn(async (key: string) => {
    if (key === "DB_URI" || key === "DBUri") {
      return testConnectionString;
    }
    throw new Error(`unknown param ${key}`);
  }),
  loadParams: jest.fn(),
}));

// Mock session validation
jest.mock("@/lib/utils/session-validation", () => ({
  requireValidSession: jest.fn((sess) => Promise.resolve(sess)),
}));

import path from 'path';
import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from '../../fixtures/database';
import { myServerAction } from '@/lib/my-module/actions/my-action';
import { Session } from '@/lib/types/session';
import { getUser } from '@/lib/user/user';
import { createSession } from '@/lib/user/session';

describe('My Server Actions', () => {
  let testDB: TestDatabase;
  let session: Session;

  beforeAll(async () => {
    testDB = await setupTestDatabase();
    testConnectionString = testDB.connectionString;

    const seedDataDir = path.join(__dirname, 'seed-data');
    await applySchemaHero(testDB, seedDataDir, true);

    const user = await getUser('test-user-id');
    session = await createSession(user!);
  });

  afterAll(async () => {
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);
    await teardownTestDatabase(testDB);
  });

  it('should perform action', async () => {
    const result = await myServerAction(session);
    expect(result).toBeDefined();
  });
});
```

**Key differences:**
- API tests use `createTestServiceAccount()` for bearer token authentication
- Server action tests use seed data + `createSession()` for session-based authentication
- Both must call `closePoolByUri()` in `afterAll()` for proper cleanup

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
- **Production-like**: Token generation uses the same SHA-256 hashing as production
- **No HTTP Server**: Tests invoke Next.js route handlers and server actions directly for speed
- **Flexible Fixtures**: Choose dynamic fixtures (via code) or deterministic seed data (via YAML)
- **Parallel Execution**: Tests run in parallel (50% CPU cores) with proper isolation guarantees

## CI/CD Integration

The integration tests can be run in GitHub Actions with:
- Node.js 20
- SchemaHero CLI v0.22.1 installed
- Docker available for Testcontainers
- No external PostgreSQL service needed (Testcontainers handles it)
- Runs with `npm run test:integration`
- Parallel execution enabled for faster CI runs
