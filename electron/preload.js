/**
 * Preload — secure context bridge between Electron main and the renderer.
 * Exposes a minimal, typed-feeling `window.higgs` object.
 *
 * Rules:
 *   - Never expose `ipcRenderer` or `require` directly to the renderer.
 *   - Whitelist every method. No generic passthrough.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('higgs', {
  // Status / config
  getStatus: () => ipcRenderer.invoke('higgs:get-status'),
  getConfig: () => ipcRenderer.invoke('higgs:get-config'),

  // OS integration
  openOutput: () => ipcRenderer.invoke('higgs:open-output'),
  openFile: (path) => ipcRenderer.invoke('higgs:open-file', path),
  showError: (title, body) => ipcRenderer.invoke('higgs:show-error', title, body),
  restartServers: () => ipcRenderer.invoke('higgs:restart-servers'),

  // Event subscriptions (health + startup-failed)
  onHealth: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('higgs:health', listener);
    return () => ipcRenderer.removeListener('higgs:health', listener);
  },
  onStartupFailed: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('higgs:startup-failed', listener);
    return () => ipcRenderer.removeListener('higgs:startup-failed', listener);
  },
});
