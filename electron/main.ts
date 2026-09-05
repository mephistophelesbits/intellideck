import { app, BrowserWindow, shell, nativeTheme } from 'electron';
import type { Tray } from 'electron';
import fs from 'fs';
import path from 'path';
import { spawnNextServer, waitForServer, buildServerUrl, findAvailablePort } from './server';
import type { ServerProcess } from './server';
import { buildAppMenu } from './menu';
import { createTrayWithActions } from './tray';
import { Menu } from 'electron';

const IS_DEV = process.env.ELECTRON_IS_DEV === '1';
let serverUrl = buildServerUrl();

// Only hand http/https/mailto links to the OS — anything else (file:, smb:,
// custom protocol handlers) could be abused by a malicious link in a feed.
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function openExternalSafely(url: string) {
  try {
    if (SAFE_EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) {
      void shell.openExternal(url);
    } else {
      console.warn('[electron] Blocked openExternal for unsafe URL:', url);
    }
  } catch {
    console.warn('[electron] Blocked openExternal for unparseable URL:', url);
  }
}

function isLocalServerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const server = new URL(serverUrl);
    return (
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      parsed.port === server.port
    );
  } catch {
    return false;
  }
}

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

// ── Production file logger ────────────────────────────────────────────────────
// Replaces console.* so every launch writes to ~/Library/Logs/IntelliDeck/
// intellideck-main.log — readable after a crash to diagnose the root cause.
let _logStream: fs.WriteStream | null = null;

function setupFileLogging() {
  try {
    const logDir = app.getPath('logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'intellideck-main.log');
    _logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const stamp = () => new Date().toISOString();
    const write = (level: string, args: unknown[]) => {
      _logStream?.write(`${stamp()} [${level}] ${args.map(String).join(' ')}\n`);
    };
    console.log   = (...args: unknown[]) => write('INFO',  args);
    console.info  = (...args: unknown[]) => write('INFO',  args);
    console.warn  = (...args: unknown[]) => write('WARN',  args);
    console.error = (...args: unknown[]) => write('ERROR', args);
    console.debug = (...args: unknown[]) => write('DEBUG', args);
    console.log(`IntelliDeck starting — appPath=${app.getAppPath()} execPath=${process.execPath}`);
  } catch {
    // Can't write logs — fall back to silent noop so we at least don't crash
    const noop = () => {};
    console.log = noop; console.info = noop;
    console.warn = noop; console.error = noop; console.debug = noop;
  }
}

if (!IS_DEV) {
  setupFileLogging();
}

let mainWindow: BrowserWindow | null = null;
let appTray: Tray | null = null;
let nextServer: ServerProcess | null = null;
let serverReady = false; // guards activate handler during initial server startup

function showMainWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  if (serverReady) {
    void createWindow();
  }
}

function reloadMainWindow() {
  if (mainWindow) {
    mainWindow.webContents.reload();
    return;
  }

  showMainWindow();
}

function getAppRoot(): string {
  if (IS_DEV) return process.cwd();
  // In production all app files are real filesystem files (asar: false),
  // so utilityProcess.fork() can find server.js at a real path.
  return path.join((process as NodeJS.Process & { resourcesPath: string }).resourcesPath, 'app');
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
    openExternalSafely(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isLocalServerUrl(url)) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });

  const menu = buildAppMenu(mainWindow);
  Menu.setApplicationMenu(menu);

  if (!appTray) {
    appTray = createTrayWithActions(getIconPath(), {
      showWindow: showMainWindow,
      reloadWindow: reloadMainWindow,
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (IS_DEV) mainWindow?.webContents.openDevTools({ mode: 'detach' });
  });

  try {
    await mainWindow.loadURL(serverUrl);
  } catch (err) {
    console.error('[electron] loadURL failed:', err);
  }
}

async function startApp() {
  const appRoot = getAppRoot();
  const userDataDir = app.getPath('userData');
  const port = await findAvailablePort();
  serverUrl = buildServerUrl(port);

  console.log('[electron] Starting Next.js server...');
  nextServer = spawnNextServer(appRoot, userDataDir, port);

  try {
    await waitForServer(serverUrl, 500, 60);
    serverReady = true;
    console.log('[electron] Next.js server ready at', serverUrl);
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
  // Do nothing while the server is still starting up — createWindow() will be
  // called by startApp() once waitForServer() resolves.
  if (!serverReady) return;

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
  console.log('[electron] will-quit — shutting down server');
  appTray?.destroy();
  appTray = null;
  if (nextServer) {
    nextServer.kill();
  }
  _logStream?.end();
});

// Security: block new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
});
