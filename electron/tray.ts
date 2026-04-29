import { app, Tray, Menu, BrowserWindow, nativeImage } from 'electron';
import path from 'path';

export function createTray(mainWindow: BrowserWindow, iconPath: string): Tray {
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  const tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show RSS Deck',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: 'Reload',
      click: () => mainWindow.webContents.reload(),
    },
    { type: 'separator' },
    {
      label: 'Quit RSS Deck',
      click: () => app.quit(),
    },
  ]);

  tray.setToolTip('RSS Deck');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}
