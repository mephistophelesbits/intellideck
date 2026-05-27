import { spawn, ChildProcess } from 'child_process';
import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import net from 'net';
import path from 'path';

export type ServerProcess = ChildProcess | UtilityProcess;

export const DEFAULT_SERVER_PORT = 3001;
export const DEFAULT_SERVER_HOSTNAME = '127.0.0.1';

export function buildServerUrl(
  port = DEFAULT_SERVER_PORT,
  hostname = DEFAULT_SERVER_HOSTNAME
): string {
  return `http://${hostname}:${port}`;
}

function canListen(port: number, hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, hostname, () => {
      server.close(() => resolve(true));
    });
  });
}

function getRandomAvailablePort(hostname: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, hostname, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export async function findAvailablePort(
  preferredPort = DEFAULT_SERVER_PORT,
  hostname = DEFAULT_SERVER_HOSTNAME
): Promise<number> {
  if (await canListen(preferredPort, hostname)) {
    return preferredPort;
  }

  return getRandomAvailablePort(hostname);
}

export async function waitForServer(
  url: string,
  intervalMs = 500,
  maxAttempts = 60
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Server did not start within ${(intervalMs * maxAttempts) / 1000}s`);
}

export function spawnNextServer(
  appRoot: string,
  userDataDir?: string,
  port = DEFAULT_SERVER_PORT,
  hostname = DEFAULT_SERVER_HOSTNAME
): ServerProcess {
  const isDev = process.env.ELECTRON_IS_DEV === '1';

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    NODE_ENV: isDev ? 'development' : 'production',
    PORT: String(port),
    HOSTNAME: hostname,
    // Pass the Electron userData dir so the Next.js server writes the DB
    // to ~/Library/Application Support/IntelliDeck/ instead of inside the bundle
    ...(userDataDir ? { RSSDECK_DATA_DIR: userDataDir } : {}),
  };

  if (isDev) {
    // In dev, process.execPath is the actual Node.js binary — spawn works fine.
    const serverProcess = spawn(
      process.execPath,
      [path.join(appRoot, 'node_modules/.bin/next'), 'dev', '-p', String(port), '-H', hostname],
      { cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    serverProcess.stdout?.on('data', (data) => {
      console.log('[next-server]', data.toString().trim());
    });
    serverProcess.stderr?.on('data', (data) => {
      console.error('[next-server]', data.toString().trim());
    });
    serverProcess.on('error', (err) => {
      console.error('[next-server] Failed to spawn process:', err);
    });
    return serverProcess;
  }

  // ── Production ────────────────────────────────────────────────────────────
  // IMPORTANT: In a packaged Electron app, process.execPath is the *Electron*
  // binary, not Node.js. Using spawn(process.execPath, ['server.js']) would
  // re-launch a second copy of the Electron app, which immediately hits the
  // single-instance lock and quits — the server never starts.
  //
  // utilityProcess.fork() is Electron's purpose-built API for running Node.js
  // scripts as background child processes without opening a new app window.
  const standaloneDir = path.join(appRoot, '.next', 'standalone');
  const serverScript = path.join(standaloneDir, 'server.js');

  console.log('[next-server] fork path:', serverScript);
  console.log('[next-server] cwd:', standaloneDir);

  const serverProcess = utilityProcess.fork(serverScript, [], {
    cwd: standaloneDir,
    env,
    stdio: 'pipe',
  });

  serverProcess.on('spawn', () => {
    console.log('[next-server] process spawned successfully');
  });
  serverProcess.stdout?.on('data', (data: Buffer) => {
    console.log('[next-server]', data.toString().trim());
  });
  serverProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[next-server]', data.toString().trim());
  });
  serverProcess.on('exit', (code: number | null) => {
    console.error('[next-server] process exited with code', code);
  });

  return serverProcess;
}
