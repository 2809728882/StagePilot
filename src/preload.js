const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stagePilot', {
  ready: () => ipcRenderer.send('display-ready'),
  mediaReady: (id) => ipcRenderer.send('media-ready', id),
  mediaPresented: (id) => ipcRenderer.send('media-presented', id),
  mediaError: (id, message) => ipcRenderer.send('media-error', { id, message }),
  holdFrameReady: (id) => ipcRenderer.send('hold-frame-ready', id),
  onCommand: (handler) => ipcRenderer.on('display-command', (_event, command) => handler(command)),
});
