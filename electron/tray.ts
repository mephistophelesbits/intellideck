import { app, Tray, Menu, nativeImage } from 'electron';

type TrayActions = {
  showWindow: () => void;
  reloadWindow: () => void;
};

function createTrayIcon(iconPath: string) {
  if (process.platform !== 'darwin') {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }

  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAOUlEQVR42mNgGIqgAgcmCP7jwUQb9p8IvJOaBu0cEINwyQ2ci0aw1xjoYhADkYbsJCWz7sSDhwAAAEPRfX4v7X+lAAAAAElFTkSuQmCC'
  );
  icon.setTemplateImage(true);
  return icon;
}

export function createTrayWithActions(iconPath: string, actions: TrayActions): Tray {
  const icon = createTrayIcon(iconPath);
  const tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show IntelliDeck',
      click: actions.showWindow,
    },
    {
      label: 'Reload',
      click: actions.reloadWindow,
    },
    { type: 'separator' },
    {
      label: 'Quit IntelliDeck',
      click: () => app.quit(),
    },
  ]);

  tray.setToolTip('IntelliDeck');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    actions.showWindow();
  });

  return tray;
}
