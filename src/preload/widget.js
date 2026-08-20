'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const arg = process.argv.find((a) => a.startsWith('--widget-id='));
const widgetId = arg ? arg.slice('--widget-id='.length) : '';

contextBridge.exposeInMainWorld('widgetApi', {
  id: widgetId,
  getState: () => ipcRenderer.invoke('app:get-state'),
  onState: (cb) => {
    const handler = (_e, config) => cb(config);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.off('state:changed', handler);
  },
  reportSize: (size) => ipcRenderer.send('widget:content-size', widgetId, size),
  update: (patch) => ipcRenderer.invoke('widget:update', widgetId, patch),
  dragStart: () => ipcRenderer.send('widget:drag-start', widgetId),
  dragMove: (dx, dy) => ipcRenderer.send('widget:drag-move', widgetId, dx, dy),
  dragEnd: () => ipcRenderer.send('widget:drag-end', widgetId),
  openContextMenu: () => ipcRenderer.send('widget:context-menu', widgetId),
  openSettings: () => ipcRenderer.invoke('settings:open', widgetId),
});
