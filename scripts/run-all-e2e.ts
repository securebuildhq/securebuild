#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import { setupTestDatabase, teardownTestDatabase, TestDatabase } from '../e2e/fixtures/database';

async function runAllE2ETests() {
  let testDb: TestDatabase | null = null;

  try {
    console.log('Setting up shared test database container for all E2E tests...');
    testDb = await setupTestDatabase();

    console.log(`Shared test database ready at: ${testDb.connectionString}`);

    // Add SSL mode for Go tests (testcontainers doesn't enable SSL)
    const goConnectionString = testDb.connectionString.includes('?')
      ? `${testDb.connectionString}&sslmode=disable`
      : `${testDb.connectionString}?sslmode=disable`;

    const env = {
      ...process.env,
      TEST_DB_URI: goConnectionString,
      // Also set for Node.js tests (they might need it too)
      DATABASE_URL: testDb.connectionString
    };

    console.log('\n=== Running securebuild-app E2E tests ===');
    try {
      execSync('cd securebuild-app && npm run test:e2e', {
        stdio: 'inherit',
        env
      });
      console.log('✅ securebuild-app E2E tests passed');
    } catch (error) {
      console.error('❌ securebuild-app E2E tests failed');
      throw error;
    }

    console.log('\n=== Running Go worker E2E tests ===');
    try {
      execSync('go test -v ./test/e2e/...', {
        stdio: 'inherit',
        env
      });
      console.log('✅ Go worker E2E tests passed');
    } catch (error) {
      console.error('❌ Go worker E2E tests failed');
      throw error;
    }

    console.log('\n🎉 All E2E tests completed successfully!');

  } catch (error) {
    console.error('\n💥 E2E test suite failed:', error);
    process.exit(1);
  } finally {
    if (testDb) {
      console.log('\nCleaning up shared test database container...');
      await teardownTestDatabase(testDb);
    }
  }
}

runAllE2ETests().catch(console.error);
