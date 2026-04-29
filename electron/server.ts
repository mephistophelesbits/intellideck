import { spawn, ChildProcess } from 'child_process';
import path from 'path';

export function buildServerUrl(port = 3001): string {
  return `http://localhost:${port}`;
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

export function spawnNextServer(appRoot: string, userDataDir?: string): ChildProcess {
  const isDev = process.env.ELECTRON_IS_DEV === '1';

  let command: string;
  let args: string[];
  let cwd: string;

  if (isDev) {
    command = process.execPath;
    args = [path.join(appRoot, 'node_modules/.bin/next'), 'dev', '-p', '3001'];
    cwd = appRoot;
  } else {
    // In production, run the standalone server from its own directory so it
    // resolves .next/server, .next/static, and public/ relative to itself.
    const standaloneDir = path.join(appRoot, '.next', 'standalone');
    command = process.execPath;
    args = [path.join(standaloneDir, 'server.js')];
    cwd = standaloneDir;
  }

  const serverProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: isDev ? 'development' : 'production',
      PORT: '3001',
      HOSTNAME: 'localhost',
      // Pass the Electron userData dir so the Next.js server writes the DB
      // to ~/Library/Application Support/RSS Deck/ instead of inside the bundle
      ...(userDataDir ? { RSSDECK_DATA_DIR: userDataDir } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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
