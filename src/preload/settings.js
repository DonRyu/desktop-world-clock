'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  onState: (cb) => {
    const handler = (_e, config) => cb(config);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.off('state:changed', handler);
  },
  onFocusWidget: (cb) => {
    const handler = (_e, id) => cb(id);
    ipcRenderer.on('settings:focus-widget', handler);
    return () => ipcRenderer.off('settings:focus-widget', handler);
  },
  updateWidget: (id, patch) => ipcRenderer.invoke('widget:update', id, patch),
  addWidget: (tz) => ipcRenderer.invoke('widget:add', tz),
  duplicateWidget: (id) => ipcRenderer.invoke('widget:duplicate', id),
  removeWidget: (id) => ipcRenderer.invoke('widget:remove', id),
  pickBackground: (id) => ipcRenderer.invoke('widget:pick-background', id),
  clearBackground: (id) => ipcRenderer.invoke('widget:clear-background', id),
  updateGeneral: (patch) => ipcRenderer.invoke('general:update', patch),
  quit: () => ipcRenderer.invoke('app:quit'),
});
