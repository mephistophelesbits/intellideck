import { app, BrowserWindow, shell, nativeTheme } from 'electron';
import path from 'path';
import { spawnNextServer, waitForServer, buildServerUrl } from './server';
import type { ServerProcess } from './server';
import { buildAppMenu } from './menu';
import { createTray } from './tray';
import { Menu } from 'electron';

const IS_DEV = process.env.ELECTRON_IS_DEV === '1';
const PORT = 3001;
const SERVER_URL = buildServerUrl(PORT);

// ── Single-instance lock ────────────────────────────────────────────────────
// Prevents multiple copies from launching. If a second instance starts,
// focus the existing window and quit the new one immediately.
if (!IS_DEV) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    process.exit(0);
  }
}

// ── EPIPE guard ─────────────────────────────────────────────────────────────
// In packaged apps stdout/stderr are closed — writing to them throws EPIPE.
const _ignoreEpipe = (err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE') throw err; };
process.stdout.on('error', _ignoreEpipe);
process.stderr.on('error', _ignoreEpipe);

// Strip console output in production — nothing reads it and it causes EPIPE.
if (!IS_DEV) {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
  console.debug = noop;
}

let mainWindow: BrowserWindow | null = null;
let nextServer: ServerProcess | null = null;

function getAppRoot(): string {
  return IS_DEV
    ? process.cwd()
    : path.join((process as NodeJS.Process & { resourcesPath: string }).resourcesPath, 'app');
}

function getIconPath(): string {
  const base = IS_DEV
    ? path.join(__dirname, '..', 'electron', 'icons')
    : path.join(__dirname, 'icons');
  return path.join(base, 'icon.png');
}

async function createWindow() {
  nativeTheme.themeSource = 'system';

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 8 },
    backgroundColor: '#09090f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  // Clear the reference when the window is closed so activate can recreate it
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== 'localhost') {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const menu = buildAppMenu(mainWindow);
  Menu.setApplicationMenu(menu);

  createTray(mainWindow, getIconPath());

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (IS_DEV) mainWindow?.webContents.openDevTools({ mode: 'detach' });
  });

  await mainWindow.loadURL(SERVER_URL);
}

async function startApp() {
  const appRoot = getAppRoot();
  const userDataDir = app.getPath('userData');

  console.log('[electron] Starting Next.js server...');
  nextServer = spawnNextServer(appRoot, userDataDir);

  try {
    await waitForServer(SERVER_URL, 500, 60);
    console.log('[electron] Next.js server ready at', SERVER_URL);
  } catch (err) {
    console.error('[electron] Server failed to start:', err);
    app.quit();
    return;
  }

  await createWindow();
}

app.whenReady().then(startApp);

// ── macOS activate ───────────────────────────────────────────────────────────
// Registered once at top level (not inside createWindow) to avoid stacking
// duplicate listeners across multiple calls.
app.on('activate', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    // Window was closed (red ✕) — reopen it without restarting the server
    void createWindow();
  }
});

// ── Second-instance focus ────────────────────────────────────────────────────
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  // On macOS keep the app alive in the Dock when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (nextServer) {
    nextServer.kill('SIGTERM');
  }
});

// Security: block new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
