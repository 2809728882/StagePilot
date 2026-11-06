const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stagePilotSettings', {
  getStatus: () => ipcRenderer.invoke('settings:get-status'),
  setPassword: (password) => ipcRenderer.invoke('settings:set-password', password),
});
