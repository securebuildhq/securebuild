/**
 * E2E Test Database Setup
 *
 * Starts PostgreSQL Testcontainers (one per test file) and applies SchemaHero schemas.
 * Supports multiple isolated databases running in parallel on different ports.
 */

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Store containers by port so multiple can coexist
const containers = new Map<number, StartedPostgreSqlContainer>();

/**
 * Setup a test database for a specific service and port
 * @param serviceName - Name of the service (e.g., 'securebuild-app')
 * @param port - Port number for the server (used for DB isolation)
 * @param testName - Name of the test file without extension (e.g., 'login', 'home')
 * @returns Database connection URI
 */
export async function setupDatabase(serviceName: string, port: number, testName: string): Promise<string> {
  // Check if already setup for this port
  if (containers.has(port)) {
    const existingUri = process.env[`DB_URI_${port}`];
    if (existingUri) {
      console.log(`[E2E:${port}] Database already setup`);
      return existingUri;
    }
  }

  console.log(`[E2E:${port}] Setting up database for ${serviceName}/${testName}...`);

  // Start PostgreSQL container
  const container = await new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase(`securebuild_test_${port}`)
    .withUsername('test')
    .withPassword('test')
    .start();

  const dbUri = `postgresql://test:test@${container.getHost()}:${container.getPort()}/securebuild_test_${port}?sslmode=disable`;

  console.log(`[E2E:${port}] PostgreSQL container started`);
  console.log(`[E2E:${port}] Database URI: ${dbUri}`);

  // Apply SchemaHero schemas
  console.log(`[E2E:${port}] Applying database schemas...`);
  try {
    const schemaPath = path.join(__dirname, '../db/schema/tables');
    const schemaDdlFile = path.join(__dirname, `schema-${port}.sql`);

    // Step 1: Generate DDL
    execSync(
      `schemahero plan --spec-file "${schemaPath}" --uri "${dbUri}" --driver postgres --out "${schemaDdlFile}"`,
      { stdio: 'inherit' }
    );

    // Step 2: Apply DDL
    execSync(
      `schemahero apply --ddl "${schemaDdlFile}" --uri "${dbUri}" --driver postgres`,
      { stdio: 'inherit' }
    );

    // Cleanup
    if (fs.existsSync(schemaDdlFile)) {
      fs.unlinkSync(schemaDdlFile);
    }

    console.log(`[E2E:${port}] Database schemas applied successfully`);
  } catch (error) {
    console.error(`[E2E:${port}] Failed to apply schemas:`, error);
    throw error;
  }

  // Apply seed data (now per-test-file specific)
  console.log(`[E2E:${port}] Applying seed data...`);
  try {
    // Use test-specific seed data directory
    const seedDataPath = path.resolve(__dirname, `../${serviceName}/e2e/${testName}.seed-data`);
    const seedDdlFile = path.join(__dirname, `seed-${port}.sql`);

    // Check if seed data directory exists
    if (!fs.existsSync(seedDataPath)) {
      console.log(`[E2E:${port}] No seed data found at ${seedDataPath}, skipping...`);
    } else {
      // Step 1: Generate seed DDL
      execSync(
        `schemahero plan --spec-file "${seedDataPath}" --uri "${dbUri}" --driver postgres --out "${seedDdlFile}" --seed-data`,
        { stdio: 'inherit' }
      );

      // Step 2: Apply seed DDL
      execSync(
        `schemahero apply --ddl "${seedDdlFile}" --uri "${dbUri}" --driver postgres`,
        { stdio: 'inherit' }
      );

      // Cleanup
      if (fs.existsSync(seedDdlFile)) {
        fs.unlinkSync(seedDdlFile);
      }

      console.log(`[E2E:${port}] Seed data applied successfully`);
    }
  } catch (error) {
    console.error(`[E2E:${port}] Failed to apply seed data:`, error);
    throw error;
  }

  // Store container and URI
  containers.set(port, container);
  process.env[`DB_URI_${port}`] = dbUri;

  console.log(`[E2E:${port}] Database setup complete`);
  return dbUri;
}

/**
 * Teardown test database(s)
 * @param port - Optional specific port to teardown, or teardown all if not provided
 */
export async function teardownDatabase(port?: number): Promise<void> {
  if (port !== undefined) {
    // Teardown specific port
    const container = containers.get(port);
    if (container) {
      console.log(`[E2E:${port}] Stopping PostgreSQL container...`);
      await container.stop();
      containers.delete(port);
      delete process.env[`DB_URI_${port}`];
      console.log(`[E2E:${port}] PostgreSQL container stopped`);
    }
  } else {
    // Teardown all containers
    console.log('[E2E] Stopping all PostgreSQL containers...');
    for (const [p, container] of containers.entries()) {
      console.log(`[E2E:${p}] Stopping container...`);
      await container.stop();
      delete process.env[`DB_URI_${p}`];
    }
    containers.clear();
    console.log('[E2E] All PostgreSQL containers stopped');
  }
}
