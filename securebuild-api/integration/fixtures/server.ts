/**
 * Starts a real Next.js server on a random port for integration tests.
 *
 * The server is a separate child process that reads DB_URI (and other env) from
 * its environment — no module mocking. Tests then exercise the API over real
 * HTTP via the shared HttpClient.
 */

import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';

export interface TestServer {
  baseUrl: string;
  port: number;
  stop: () => Promise<void>;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error('failed to find a free port'));
      }
    });
  });
}

function waitForServer(baseUrl: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`server at ${baseUrl} did not become ready within ${timeoutMs}ms`));
        return;
      }
      try {
        // Any HTTP response (including 401) means the server is up and routing.
        const res = await fetch(`${baseUrl}/api/v1/external-image`, { method: 'GET' });
        if (res.status !== 0) {
          resolve();
          return;
        }
      } catch {
        // not ready yet
      }
      setTimeout(poll, 500);
    };
    poll();
  });
}

export async function startTestServer(env: Record<string, string>, timeoutMs = 180000): Promise<TestServer> {
  const port = await findFreePort();
  const apiDir = path.resolve(__dirname, '..', '..');
  const baseUrl = `http://localhost:${port}`;

  const nextBin = require.resolve('next/dist/bin/next');

  console.log(`Starting Next.js dev server on port ${port} (cwd: ${apiDir})`);

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    NODE_ENV: 'development',
    PORT: String(port),
    DD_ENABLED: '',
    NEXT_TELEMETRY_DISABLED: '1',
  };

  const child: ChildProcess = spawn('node', [nextBin, 'dev', '-p', String(port)], {
    cwd: apiDir,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[next-dev] ${chunk}`);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[next-dev] ${chunk}`);
  });

  const stop = (): Promise<void> => {
    return new Promise((resolve) => {
      if (child.killed || child.exitCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
      try {
        // Kill the whole process group (dev server may spawn children).
        process.kill(-child.pid!, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      // Fallback force-kill after grace period (unref so it doesn't hold the event loop)
      const forceKill = setTimeout(() => {
        try {
          if (!child.killed && child.exitCode === null) child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 5000);
      forceKill.unref();
    });
  };

  try {
    await waitForServer(baseUrl, timeoutMs);
    console.log(`Next.js server ready at ${baseUrl}`);
  } catch (err) {
    await stop();
    throw err;
  }

  return { baseUrl, port, stop };
}
