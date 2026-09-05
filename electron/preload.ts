import { contextBridge, ipcRenderer, shell } from 'electron';

// Only allow protocols that are safe to hand to the OS. Anything else
// (file:, smb:, custom app handlers) could be abused by a malicious feed link.
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isSafeExternalUrl(url: string): boolean {
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url: string) => {
    if (typeof url !== 'string' || !isSafeExternalUrl(url)) {
      return Promise.resolve();
    }
    return shell.openExternal(url);
  },
  onUpdateAvailable: (callback: () => void) =>
    ipcRenderer.on('update-available', callback),
  platform: process.platform,
});
