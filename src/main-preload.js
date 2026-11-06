const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stagePilotMain', {
  getState: () => ipcRenderer.invoke('main:get-state'),
  chooseVideoFolder: () => ipcRenderer.invoke('main:choose-video-folder'),
  setPassword: (password) => ipcRenderer.invoke('settings:set-password', password),
  addProgram: () => ipcRenderer.invoke('main:add-program'),
  addBrowser: (browserId) => ipcRenderer.invoke('main:add-browser', browserId),
  removeProgram: (id) => ipcRenderer.invoke('main:remove-program', id),
  setTransitionDelay: (milliseconds) => ipcRenderer.invoke('main:set-transition-delay', milliseconds),
  onState: (handler) => ipcRenderer.on('dashboard-state', (_event, state) => handler(state)),
});
