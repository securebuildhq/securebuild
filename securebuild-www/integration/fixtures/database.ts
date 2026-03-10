import { Client, Pool } from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  connectionString: string;
  host: string;
  port: number;
}

/**
 * Finds the project root by looking for go.mod
 */
async function findProjectRoot(): Promise<string> {
  let dir = __dirname;

  while (dir !== '/') {
    try {
      await fs.access(path.join(dir, 'go.mod'));
      return dir;
    } catch {
      // go.mod not found, go up one level
    }
    dir = path.dirname(dir);
  }

  throw new Error('Could not find project root (looking for go.mod)');
}

/**
 * Applies SchemaHero YAML files from a directory
 *
 * This function can apply either schema definitions or seed data depending
 * on the isSeedData flag. It calls schemahero plan once for the entire directory.
 *
 * @param testDB - The test database to apply to
 * @param yamlDir - Absolute path to the directory containing YAML files
 * @param isSeedData - If true, adds --seed-data flag to schemahero plan
 */
export async function applySchemaHero(
  testDB: TestDatabase,
  yamlDir: string,
  isSeedData: boolean = false
): Promise<void> {
  const projectRoot = await findProjectRoot();
  const fileType = isSeedData ? 'seed data' : 'schema';

  console.log(`Applying ${fileType} from: ${path.basename(yamlDir)}`);

  // Create a temporary file for the DDL output
  const ddlFile = path.join('/tmp', `schemahero-${isSeedData ? 'seed' : 'ddl'}-${Date.now()}-${Math.random().toString(36).substring(7)}.sql`);

  try {
    // Run schemahero plan to generate DDL for entire directory
    const seedDataFlag = isSeedData ? ' --seed-data' : '';
    const planCmd = `schemahero plan --spec-file "${yamlDir}" --uri "${testDB.connectionString}" --driver postgres --out "${ddlFile}"${seedDataFlag}`;
    await execAsync(planCmd, { cwd: projectRoot });

    // Run schemahero apply to execute the DDL
    const applyCmd = `schemahero apply --ddl "${ddlFile}" --uri "${testDB.connectionString}" --driver postgres`;
    await execAsync(applyCmd, { cwd: projectRoot });

    console.log(`All ${fileType} applied successfully`);
  } catch (error) {
    console.error(`Failed to apply ${fileType}:`, error);
    throw error;
  } finally {
    // Clean up temporary DDL file
    try {
      await fs.unlink(ddlFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Creates a PostgreSQL test database container and applies all SchemaHero schemas
 *
 * Each test should call this function to get a fresh, isolated database.
 * Don't forget to call teardownTestDatabase() when done.
 *
 * @returns TestDatabase with container, pool, and connection details
 */
export async function setupTestDatabase(): Promise<TestDatabase> {
  console.log('Starting PostgreSQL container...');

  // Start PostgreSQL container (no port binding to avoid conflicts)
  const container = await new PostgreSqlContainer('postgres:17')
    .withDatabase('securebuild_test')
    .withUsername('test_user')
    .withPassword('test_password')
    .start();

  const host = container.getHost();
  const port = container.getPort();
  const connectionString = `postgresql://test_user:test_password@${host}:${port}/securebuild_test?sslmode=disable`;

  console.log(`PostgreSQL container started at ${host}:${port}`);

  // Create connection pool
  const pool = new Pool({
    host,
    port,
    database: 'securebuild_test',
    user: 'test_user',
    password: 'test_password',
  });

  // Wait for database to be ready
  let retries = 30;
  while (retries > 0) {
    try {
      await pool.query('SELECT 1');
      console.log('Database is ready');
      break;
    } catch (error) {
      retries--;
      if (retries === 0) {
        throw new Error('Database failed to become ready');
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const testDB: TestDatabase = {
    container,
    pool,
    connectionString,
    host,
    port,
  };

  // Apply database schema using SchemaHero
  console.log('Applying database schemas...');
  const projectRoot = await findProjectRoot();
  const schemaDir = path.join(projectRoot, 'db', 'schema', 'tables');
  await applySchemaHero(testDB, schemaDir, false);

  return testDB;
}

/**
 * Tears down the test database container and closes connections
 *
 * @param testDB - The TestDatabase to clean up
 */
export async function teardownTestDatabase(testDB: TestDatabase): Promise<void> {
  console.log('Tearing down test database...');

  if (testDB.pool) {
    await testDB.pool.end();
    console.log('Database pool closed');
  }

  if (testDB.container) {
    await testDB.container.stop();
    console.log('Container stopped');
  }

  console.log('Test database cleanup completed');
}
