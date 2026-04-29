import { contextBridge, ipcRenderer, shell } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url: string) => shell.openExternal(url),
  onUpdateAvailable: (callback: () => void) =>
    ipcRenderer.on('update-available', callback),
  platform: process.platform,
});
