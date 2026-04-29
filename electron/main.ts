import { app, BrowserWindow, shell, nativeTheme } from 'electron';
import path from 'path';
import { spawnNextServer, waitForServer, buildServerUrl } from './server';
import { buildAppMenu } from './menu';
import { createTray } from './tray';
import { Menu } from 'electron';
import type { ChildProcess } from 'child_process';

const IS_DEV = process.env.ELECTRON_IS_DEV === '1';
const PORT = 3001;
const SERVER_URL = buildServerUrl(PORT);

let mainWindow: BrowserWindow | null = null;
let nextServer: ChildProcess | null = null;

function getAppRoot(): string {
  // In packaged app, resources are in process.resourcesPath
  // In dev, use cwd
  return IS_DEV ? process.cwd() : path.join((process as NodeJS.Process & { resourcesPath: string }).resourcesPath, 'app');
}

function getIconPath(): string {
  const base = IS_DEV ? path.join(__dirname, '..', 'electron', 'icons') : path.join(__dirname, 'icons');
  return path.join(base, 'icon.png');
}

async function createWindow() {
  nativeTheme.themeSource = 'system';

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset', // macOS traffic lights inset into title bar
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#09090f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false, // Show after content loads to avoid white flash
  });

  // Open external links in system browser, not Electron window
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

  // Show window once the page has loaded
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (IS_DEV) mainWindow?.webContents.openDevTools({ mode: 'detach' });
  });

  // On macOS, clicking dock icon should show window
  app.on('activate', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
    }
  });

  await mainWindow.loadURL(SERVER_URL);
}

async function startApp() {
  const appRoot = getAppRoot();

  console.log('[electron] Starting Next.js server...');
  nextServer = spawnNextServer(appRoot);

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

app.on('window-all-closed', () => {
  // On macOS, keep app in dock even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (nextServer) {
    console.log('[electron] Stopping Next.js server...');
    nextServer.kill('SIGTERM');
  }
});

// Security: prevent new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
