#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import { setupTestDatabase, teardownTestDatabase, TestDatabase } from '../e2e/fixtures/database';

async function runGoE2ETests() {
  let testDb: TestDatabase | null = null;

  try {
    console.log('Setting up test database container...');
    testDb = await setupTestDatabase();

        console.log(`Test database ready at: ${testDb.connectionString}`);

    // Add SSL mode for Go tests (testcontainers doesn't enable SSL)
    const goConnectionString = testDb.connectionString.includes('?')
      ? `${testDb.connectionString}&sslmode=disable`
      : `${testDb.connectionString}?sslmode=disable`;

    console.log('Running Go E2E tests...');
    execSync('go test -v ./test/e2e/...', {
      stdio: 'inherit',
      env: { ...process.env, TEST_DB_URI: goConnectionString }
    });

    console.log('Go E2E tests completed successfully');

  } catch (error) {
    console.error('Go E2E tests failed:', error);
    process.exit(1);
  } finally {
    if (testDb) {
      console.log('Cleaning up test database container...');
      await teardownTestDatabase(testDb);
    }
  }
}

runGoE2ETests().catch(console.error);
