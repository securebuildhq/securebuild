#!/usr/bin/env node
/**
 * E2E Test Runner
 *
 * Orchestrates the complete E2E test lifecycle for multiple test files in parallel:
 * 1. Sets up isolated PostgreSQL databases (one per test file)
 * 2. Starts multiple Next.js dev servers with DB_URI environment variables
 * 3. Runs Playwright tests (all projects in parallel)
 * 4. Tears down all servers and databases
 */

import { spawn, ChildProcess } from 'child_process';
import { setupDatabase, teardownDatabase } from './setup-db';
import * as path from 'path';

// Test configuration: one entry per test file
interface TestConfig {
  service: string;
  port: number;
  testName: string;
  projectName: string; // Playwright project name
}

const allTestConfigs: TestConfig[] = [
  { service: 'securebuild-app', port: 3303, testName: 'admin-login', projectName: 'app-admin-login' },
];

interface ServerInstance {
  config: TestConfig;
  process: ChildProcess;
}

let servers: ServerInstance[] = [];
let isCleaningUp = false;

/**
 * Parse --project flags from command line arguments
 * @returns Array of project names to run, or null for all projects
 */
function parseProjectFilter(): string[] | null {
  const projectArgs = process.argv.filter(arg => arg.startsWith('--project='));

  if (projectArgs.length === 0) {
    return null; // Run all projects
  }

  return projectArgs.map(arg => arg.split('=')[1]);
}

/**
 * Filter test configs based on --project flags
 * @param configs All available test configurations
 * @returns Filtered configs to run
 */
function filterTestConfigs(configs: TestConfig[]): TestConfig[] {
  const projectFilter = parseProjectFilter();

  if (!projectFilter) {
    return configs; // Run all
  }

  const filtered = configs.filter(config => projectFilter.includes(config.projectName));

  if (filtered.length === 0) {
    console.error(`\nError: No matching projects found for: ${projectFilter.join(', ')}`);
    console.error('Available projects:', configs.map(c => c.projectName).join(', '));
    process.exit(1);
  }

  return filtered;
}

async function cleanup() {
  // Prevent concurrent cleanup
  if (isCleaningUp) {
    console.log('Cleanup already in progress, skipping...');
    return;
  }
  isCleaningUp = true;

  console.log('\n=== Cleaning up ===');

  // Stop all Next.js servers first to close database connections
  if (servers.length > 0) {
    console.log(`Stopping ${servers.length} Next.js servers...`);
    for (const server of servers) {
      if (server.process && server.process.pid) {
        try {
          // Kill the entire process group (negative PID)
          process.kill(-server.process.pid, 'SIGKILL');
          console.log(`[${server.config.port}] Stopped ${server.config.service}/${server.config.testName}`);
        } catch (error) {
          // Ignore errors - process may already be dead
          console.log(`[${server.config.port}] Failed to kill process:`, error);
        }
      }
    }
    servers = [];

    // Give processes a moment to fully terminate
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Tear down all databases
  console.log('Tearing down all databases...');
  await teardownDatabase(); // Tears down all containers

  console.log('=== Cleanup complete ===');
}

async function startServer(config: TestConfig, dbUri: string): Promise<ChildProcess> {
  const { service, port, testName } = config;
  const appDir = path.join(__dirname, '..', service);

  console.log(`\n[${port}] === Starting ${service}/${testName} on port ${port} ===`);

  return new Promise((resolve, reject) => {
    let checkInterval: NodeJS.Timeout | null = null;
    let serverExited = false;

    // Start Next.js server with test-specific environment variables
    const serverProcess = spawn(
      'npm',
      ['run', 'dev', '--', '--port', port.toString()],
      {
        cwd: appDir,
        env: {
          ...process.env,
          E2E_TEST_MODE: 'true',
          E2E_TEST_NAME: testName,
          PORT: port.toString(),
          DB_URI: dbUri, // Pass database URI from setup
          HMAC_SECRET: 'e2e-test-secret-key-for-jwt-signing',
        },
        stdio: 'inherit',
        detached: true, // Create new process group for clean kill
      }
    );

    serverProcess.on('error', (error) => {
      if (checkInterval) clearInterval(checkInterval);
      reject(new Error(`[${port}] Failed to start server: ${error.message}`));
    });

    // Detect if server crashes during startup
    serverProcess.on('exit', (code, signal) => {
      if (!serverExited && checkInterval) {
        serverExited = true;
        clearInterval(checkInterval);
        reject(new Error(`[${port}] Server process exited unexpectedly during startup (code: ${code}, signal: ${signal})`));
      }
    });

    // Wait for server to be ready
    const serverUrl = `http://localhost:${port}`;
    console.log(`[${port}] Waiting for server to be ready at ${serverUrl}...`);
    const maxAttempts = 60; // 60 seconds
    let attempts = 0;

    checkInterval = setInterval(async () => {
      if (serverExited) return;

      attempts++;
      try {
        const response = await fetch(serverUrl);
        if (response.ok || response.status < 500) {
          if (checkInterval) clearInterval(checkInterval);
          console.log(`[${port}] Server is ready!`);
          // Remove exit listener since server is now running successfully
          serverProcess?.removeAllListeners('exit');
          resolve(serverProcess);
        }
      } catch (error) {
        if (attempts >= maxAttempts) {
          if (checkInterval) clearInterval(checkInterval);
          reject(new Error(`[${port}] Server failed to start within 60 seconds`));
        }
      }
    }, 1000);
  });
}

async function runTests(): Promise<number> {
  console.log('\n=== Running Playwright tests ===');

  return new Promise((resolve) => {
    // Pass through any additional args (--headed, --ui, --debug)
    const additionalArgs = process.argv.slice(2);
    const playwrightArgs = ['playwright', 'test', ...additionalArgs];

    const playwrightProcess = spawn('npx', playwrightArgs, {
      cwd: __dirname,
      env: process.env,
      stdio: 'inherit',
    });

    playwrightProcess.on('close', (code) => {
      resolve(code || 0);
    });

    playwrightProcess.on('error', (error) => {
      console.error('Failed to run Playwright:', error);
      resolve(1);
    });
  });
}

async function main() {
  let exitCode = 0;

  try {
    // Filter test configs based on --project flags
    const testConfigs = filterTestConfigs(allTestConfigs);

    console.log('=== Starting E2E Test Suite ===');
    if (testConfigs.length === allTestConfigs.length) {
      console.log(`Running all ${testConfigs.length} test files in parallel`);
    } else {
      console.log(`Running ${testConfigs.length} selected test(s): ${testConfigs.map(c => c.projectName).join(', ')}`);
    }

    // 1. Setup databases for selected tests in parallel
    console.log('\n=== Setting up databases ===');
    const dbSetupPromises = testConfigs.map(async (config) => {
      const dbUri = await setupDatabase(config.service, config.port, config.testName);
      return { config, dbUri };
    });

    const dbConfigs = await Promise.all(dbSetupPromises);
    console.log(`✓ All ${dbConfigs.length} database(s) ready\n`);

    // 2. Start servers for selected tests in parallel
    console.log('=== Starting servers ===');
    const serverPromises = dbConfigs.map(({ config, dbUri }) =>
      startServer(config, dbUri).then(proc => ({ config, process: proc }))
    );

    servers = await Promise.all(serverPromises);
    console.log(`\n✓ All ${servers.length} server(s) ready\n`);

    // 3. Run Playwright tests (pass through all args including --project)
    exitCode = await runTests();

  } catch (error) {
    console.error('\n=== Error occurred ===');
    console.error(error instanceof Error ? error.message : String(error));
    exitCode = 1;
  } finally {
    // 4. Cleanup
    await cleanup();
  }

  process.exit(exitCode);
}

// Handle interrupts - register before main() to avoid race conditions
process.on('SIGINT', async () => {
  console.log('\n\nReceived SIGINT, cleaning up...');
  await cleanup();
  process.exit(130);
});

process.on('SIGTERM', async () => {
  console.log('\n\nReceived SIGTERM, cleaning up...');
  await cleanup();
  process.exit(143);
});

// Start main execution
main();
