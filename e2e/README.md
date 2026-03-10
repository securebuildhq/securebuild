# E2E Tests

End-to-end tests for SecureBuild services (securebuild-app and securebuild-www).

## Architecture

Each test file runs in complete isolation with its own database and server:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         run-tests.ts                                 │
│                    (Orchestrates Everything)                         │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │ home.spec.ts │ │login.spec.ts │ │admin-login   │
         │              │ │              │ │  .spec.ts    │
         │ Port: 3300   │ │ Port: 3301   │ │ Port: 3302   │
         └──────────────┘ └──────────────┘ └──────────────┘
                │                 │                 │
                ▼                 ▼                 ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │ Next.js Dev  │ │ Next.js Dev  │ │ Next.js Dev  │
         │   Server     │ │   Server     │ │   Server     │
         │              │ │              │ │              │
         │ (www:3300)   │ │ (www:3301)   │ │ (app:3302)   │
         └──────────────┘ └──────────────┘ └──────────────┘
                │                 │                 │
         (instrumentation.ts detects E2E_TEST_MODE)
                │                 │                 │
                ▼                 ▼                 ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │ setup-db.ts  │ │ setup-db.ts  │ │ setup-db.ts  │
         │              │ │              │ │              │
         │ Creates DB   │ │ Creates DB   │ │ Creates DB   │
         └──────────────┘ └──────────────┘ └──────────────┘
                │                 │                 │
                ▼                 ▼                 ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │  Postgres    │ │  Postgres    │ │  Postgres    │
         │  Container   │ │  Container   │ │  Container   │
         │              │ │              │ │              │
         │ test_3300    │ │ test_3301    │ │ test_3302    │
         └──────────────┘ └──────────────┘ └──────────────┘
                │                 │                 │
         (Apply schemas + seed data)
                │                 │                 │
                ▼                 ▼                 ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │   home       │ │   login      │ │ admin-login  │
         │ .seed-data/  │ │ .seed-data/  │ │ .seed-data/  │
         │              │ │              │ │              │
         │ - catalog    │ │ - users      │ │ - admin user │
         │ - images     │ │ - nonces     │ │              │
         │              │ │ - catalog    │ │              │
         └──────────────┘ └──────────────┘ └──────────────┘
                │                 │                 │
                └─────────────────┼─────────────────┘
                                  │
                    All tests run in parallel
                                  │
                                  ▼
                          ┌───────────────┐
                          │  Playwright   │
                          │   (Chromium)  │
                          └───────────────┘
```

## Directory Structure

```
e2e/
├── setup-db.ts              # Shared DB setup logic
├── run-tests.ts             # Orchestrator that starts multiple servers
├── playwright.config.ts     # Per-project configuration
└── README.md                # This file

securebuild-www/
├── instrumentation.ts       # Calls e2e/setup-db.ts on startup
└── e2e/
    ├── home.spec.ts
    ├── login.spec.ts
    ├── home.seed-data/      # Catalog data only
    │   ├── 002-catalog.yaml
    │   ├── 003-image.yaml
    │   └── 004-catalog_image.yaml
    └── login.seed-data/     # Full data (user, nonce, catalog)
        ├── 001-securebuild_user.yaml
        ├── 002-catalog.yaml
        ├── 003-image.yaml
        ├── 004-catalog_image.yaml
        ├── 005-passwordless_login_nonce.yaml
        ├── 006-securebuild_team.yaml
        └── 007-user_team.yaml

securebuild-app/
├── instrumentation.ts       # Calls e2e/setup-db.ts on startup
└── e2e/
    ├── admin-login.spec.ts
    └── admin-login.seed-data/
        └── 001-buildadmin_user.yaml
```

## How It Works

### 1. Test Execution Flow

```bash
npm test
  ↓
run-tests.ts sets up 3 databases in parallel:
  - Calls setup-db.ts for each test file
  - Creates isolated Postgres containers
  - Applies schemas from db/schema/tables/
  - Applies seed data from {service}/e2e/{testName}.seed-data/
  - Returns DB_URI for each
  ↓
run-tests.ts starts 3 servers in parallel:
  - securebuild-www on port 3300 (for home.spec.ts) with DB_URI
  - securebuild-www on port 3301 (for login.spec.ts) with DB_URI
  - securebuild-app on port 3302 (for admin-login.spec.ts) with DB_URI
  - Each server gets DB_URI via environment variable
  ↓
All servers ready, run-tests.ts starts Playwright:
  - All 3 projects run in parallel
  - Each hits its own port/database
  - No test interference
  ↓
Tests complete, run-tests.ts cleanup:
  - Kills all servers (SIGKILL)
  - Stops all database containers
  - All containers cleaned up
```

### 2. Key Components

#### `e2e/setup-db.ts`
- Shared database setup logic
- Creates one Postgres container per port
- Applies SchemaHero schemas
- Applies test-specific seed data from `{testName}.seed-data/`
- Returns database URI

#### `{service}/instrumentation.ts`
- Next.js hook that runs before server starts
- Logs E2E test mode and DB_URI status
- DB_URI is already set by `run-tests.ts`

#### `e2e/run-tests.ts`
- Sets up all databases in parallel (via `setup-db.ts`)
- Starts all servers in parallel with DB_URI env vars
- Each gets unique port, test name, and DB_URI
- Waits for all servers to be ready
- Runs Playwright tests (all projects in parallel)
- Cleans up servers and databases on completion/error

#### `e2e/playwright.config.ts`
- Defines one "project" per test file
- Each project has its own port and testMatch
- All projects run in parallel (fullyParallel: true)

## Prerequisites

- Node.js 20+ (required for ts-node and modern JavaScript features)
- Docker running (required for PostgreSQL Testcontainers)

## Installing Dependencies

```bash
# Install service dependencies
cd securebuild-app && npm install && cd ..
cd securebuild-www && npm install && cd ..

# Install E2E test dependencies
cd e2e
npm install

# Install Playwright browsers
npx playwright install chromium
```

## Running Tests

From the `e2e/` directory:

```bash
# Run all tests (all 3 in parallel)
npm test

# Run a single test
npm test -- --project=www-home
npm test -- --project=www-login
npm test -- --project=app-admin-login

# Run multiple specific tests
npm test -- --project=www-home --project=www-login

# Run with visible browser
npm run test:headed
npm test -- --project=www-home --headed

# Run with Playwright UI
npm run test:ui
npm test -- --project=www-login --ui

# Run with debug mode
npm run test:debug
npm test -- --project=app-admin-login --debug

# View test report
npm run report
```

**Note:** The `--project` flag filters which tests to run. Only the selected test's database and server will be started, making individual test runs faster.

## Environment Variables

Each server instance gets:
- `E2E_TEST_MODE=true` - Triggers database setup in instrumentation.ts
- `E2E_TEST_NAME={testName}` - Name of test file (e.g., 'home', 'login')
- `PORT={port}` - Port number for this server
- `DB_URI` - Set by instrumentation.ts after database setup
- `HMAC_SECRET` - Test JWT signing key

## Benefits

- **True Isolation**: Each test has its own database, no shared state
- **Parallel Execution**: All tests run simultaneously for speed
- **Real Database**: Uses actual Postgres, not mocks
- **Automatic Cleanup**: Containers stopped even on errors/interrupts
- **Per-Test Seed Data**: Each test file has exactly the data it needs

## Adding New Tests

1. Create test file: `{service}/e2e/{testname}.spec.ts`
2. Create seed data directory: `{service}/e2e/{testname}.seed-data/`
3. Add YAML seed files to directory
4. Add project to `e2e/playwright.config.ts`:
   ```typescript
   {
     name: 'www-newtest',
     testDir: path.resolve(__dirname, '../securebuild-www/e2e'),
     testMatch: '**/newtest.spec.ts',
     use: { ...sharedUse, ...browserConfig, baseURL: 'http://localhost:3303' },
   }
   ```
5. Add config to `e2e/run-tests.ts` in the `allTestConfigs` array:
   ```typescript
   { service: 'securebuild-www', port: 3303, testName: 'newtest', projectName: 'www-newtest' }
   ```

That's it! The new test will run in parallel with the others, and you can run it individually with:
```bash
npm test -- --project=www-newtest
```

## CI/CD - GitHub Actions

The E2E tests run automatically on pull requests using a **matrix strategy** for parallel execution.

### Workflow Configuration

See `.github/workflows/e2e.yml`:

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - project: www-home
        service: securebuild-www
      - project: www-login
        service: securebuild-www
        needs_stripe: true
      - project: app-admin-login
        service: securebuild-app
```

### How It Works in CI

1. **Change detection** - Only runs tests for modified services
2. **Matrix execution** - All 3 tests run in parallel on separate runners
3. **Isolated environments** - Each runner gets its own DB container + server
4. **Conditional secrets** - Stripe keys only passed to login test
5. **Artifact upload** - Reports and results saved per test

### CI Benefits

- **Fast**: All tests run simultaneously (~2-3 minutes total)
- **Efficient**: Only tests affected services
- **Isolated**: No cross-test contamination
- **Debuggable**: Separate reports for each test

## Troubleshooting

### Server fails to start
- Check Docker is running: `docker ps`
- Check port isn't in use: `lsof -i :3300`
- Increase timeout in run-tests.ts (maxAttempts)

### Database connection errors
- Verify Testcontainers can start: `docker run -d postgres:15-alpine`
- Check logs in terminal for DB setup errors

### Tests fail intermittently
- Ensure seed data is correct for that test
- Check if test is making assumptions about other tests' data

### Clean up stuck containers
```bash
docker ps -a | grep postgres | awk '{print $1}' | xargs docker rm -f
```
