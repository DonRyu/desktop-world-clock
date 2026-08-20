'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  dialog,
  protocol,
  net,
  powerMonitor,
} = require('electron');
const { Store, systemZone } = require('./store');
const { appIcon, trayIcon } = require('./icon');

// Only one instance may run, so autostart plus a manual launch cannot double the widgets.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const BG_SCHEME = 'widget-bg';

// Background images are served over a custom scheme instead of file://, which keeps the
// renderer's CSP tight and avoids path-escaping problems.
protocol.registerSchemesAsPrivileged([
  { scheme: BG_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let store = null;
let tray = null;
let settingsWin = null;
const widgetWins = new Map(); // widgetId -> BrowserWindow

const ROOT = path.join(__dirname, '..', '..');
const PRELOAD_WIDGET = path.join(__dirname, '..', 'preload', 'widget.js');
const PRELOAD_SETTINGS = path.join(__dirname, '..', 'preload', 'settings.js');
const HTML_WIDGET = path.join(__dirname, '..', 'renderer', 'widget.html');
const HTML_SETTINGS = path.join(__dirname, '..', 'renderer', 'settings.html');
const BG_DIR = path.join(app.getPath('userData'), 'backgrounds');

/* ------------------------------------------------------------------ */
/* Background images                                                   */
/* ------------------------------------------------------------------ */

function removeBackgroundFiles(widgetId) {
  try {
    for (const name of fs.readdirSync(BG_DIR)) {
      if (name.startsWith(`${widgetId}-`)) fs.unlinkSync(path.join(BG_DIR, name));
    }
  } catch {
    /* nothing stored yet */
  }
}

function registerBackgroundProtocol() {
  protocol.handle(BG_SCHEME, (request) => {
    const name = path.basename(decodeURIComponent(new URL(request.url).pathname));
    const file = path.join(BG_DIR, name);
    if (!name || !file.startsWith(BG_DIR) || !fs.existsSync(file)) {
      return new Response('not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

/* ------------------------------------------------------------------ */
/* Autostart (background residency)                                    */
/* ------------------------------------------------------------------ */

// True when running from an MSIX/AppX package, i.e. the Microsoft Store build.
const IS_STORE_BUILD = !!process.windowsStore;

function applyAutoStart(enabled) {
  // An MSIX app is sandboxed: writes to the registry Run key are virtualised and never take
  // effect. Startup is declared in the manifest instead (windows.startupTask), and the user
  // turns it on or off in Windows Settings > Apps > Startup.
  if (IS_STORE_BUILD) return;

  const opts = { openAtLogin: !!enabled, name: 'Desktop World Clock Widget' };
  if (!app.isPackaged) {
    // Pass the app directory so a dev run (electron.exe .) also starts correctly.
    // Do NOT quote it: setLoginItemSettings escapes args itself, so our own quotes
    // would end up inside the path and Windows would resolve it against System32.
    opts.path = process.execPath;
    opts.args = [path.resolve(ROOT)];
  }
  try {
    app.setLoginItemSettings(opts);
  } catch (err) {
    console.error('[autostart] failed:', err);
  }
}

/* ------------------------------------------------------------------ */
/* Widget windows                                                      */
/* ------------------------------------------------------------------ */

function clampToDisplay(x, y, w, h) {
  const area = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - w)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - h)),
  };
}

function defaultPlacement(index) {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - 320, y: area.y + 40 + index * 150 };
}

// A pinned (locked) widget cannot be moved and stays above every other window.
// The 'screen-saver' level is what reliably keeps it above browsers.
function applyBehavior(win, widget) {
  const b = widget.behavior || {};
  const pinned = !!b.locked;
  if (pinned) win.setAlwaysOnTop(true, 'screen-saver');
  else win.setAlwaysOnTop(false);
  win.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: pinned });
  win.setMovable(!pinned);
  win.setOpacity(typeof b.opacity === 'number' ? Math.min(1, Math.max(0.1, b.opacity)) : 1);

  const visible = b.visible !== false;
  if (visible && !win.isVisible()) win.showInactive();
  else if (!visible && win.isVisible()) win.hide();
}

function createWidgetWindow(widget, index) {
  const place = widget.bounds || defaultPlacement(index);
  const win = new BrowserWindow({
    width: 300,
    height: 140,
    x: place.x,
    y: place.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    icon: appIcon(),
    webPreferences: {
      preload: PRELOAD_WIDGET,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // keep ticking even when covered by other windows
      additionalArguments: [`--widget-id=${widget.id}`],
    },
  });

  win.setMenu(null);
  widgetWins.set(widget.id, win);

  let saveTimer = null;
  win.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      store.update(widget.id, { bounds: { x, y } });
    }, 300);
  });

  win.on('closed', () => {
    if (widgetWins.get(widget.id) === win) widgetWins.delete(widget.id);
  });

  win.once('ready-to-show', () => {
    applyBehavior(win, store.find(widget.id) || widget); // shows it unless hidden
  });

  win.loadFile(HTML_WIDGET, { query: { id: widget.id } });
  return win;
}

function syncWidgetWindows() {
  const ids = new Set(store.widgets.map((w) => w.id));
  for (const [id, win] of widgetWins) {
    if (!ids.has(id)) {
      widgetWins.delete(id);
      if (!win.isDestroyed()) win.destroy();
    }
  }
  store.widgets.forEach((w, i) => {
    const win = widgetWins.get(w.id);
    if (!win || win.isDestroyed()) createWidgetWindow(w, i);
    else applyBehavior(win, w);
  });
  rebuildTrayMenu();
}

function pushState() {
  const payload = store.config;
  for (const win of widgetWins.values()) {
    if (!win.isDestroyed()) win.webContents.send('state:changed', payload);
  }
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('state:changed', payload);
  }
}

/* ------------------------------------------------------------------ */
/* Settings window                                                     */
/* ------------------------------------------------------------------ */

function openSettings(focusId) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    if (focusId) settingsWin.webContents.send('settings:focus-widget', focusId);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 900,
    height: 660,
    minWidth: 780,
    minHeight: 520,
    show: false,
    title: 'Desktop World Clock Widget Settings',
    backgroundColor: '#12161f',
    icon: appIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_SETTINGS,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  settingsWin.setMenu(null);
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    if (focusId) settingsWin.webContents.send('settings:focus-widget', focusId);
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  settingsWin.loadFile(HTML_SETTINGS);
}

/* ------------------------------------------------------------------ */
/* Tray                                                                */
/* ------------------------------------------------------------------ */

function behaviorToggle(id, key, label, checked) {
  return {
    label,
    type: 'checkbox',
    checked: !!checked,
    click: (item) => {
      store.update(id, { behavior: { [key]: item.checked } });
      syncWidgetWindows();
      pushState();
    },
  };
}

function rebuildTrayMenu() {
  if (!tray) return;
  const widgetItems = store.widgets.map((w) => ({
    label: w.label || w.timeZone,
    submenu: [
      { label: 'Widget settings...', click: () => openSettings(w.id) },
      behaviorToggle(w.id, 'visible', 'Show on desktop', w.behavior.visible !== false),
      behaviorToggle(w.id, 'locked', 'Pin on top (lock position)', w.behavior.locked),
      { type: 'separator' },
      {
        label: 'Delete widget',
        click: () => {
          removeBackgroundFiles(w.id);
          store.remove(w.id);
          syncWidgetWindows();
          pushState();
        },
      },
    ],
  }));

  const menu = Menu.buildFromTemplate([
    { label: 'Desktop World Clock Widget', enabled: false },
    { type: 'separator' },
    ...(widgetItems.length ? widgetItems : [{ label: '(no widgets)', enabled: false }]),
    { type: 'separator' },
    {
      label: 'Add widget',
      click: () => {
        store.add(systemZone());
        syncWidgetWindows();
        pushState();
        openSettings();
      },
    },
    { label: 'Settings...', click: () => openSettings() },
    IS_STORE_BUILD
      ? { label: 'Start with Windows: use Windows Settings > Startup', enabled: false }
      : {
          label: 'Start with Windows',
          type: 'checkbox',
          checked: !!store.config.general.startWithWindows,
          click: (item) => {
            store.updateGeneral({ startWithWindows: item.checked });
            applyAutoStart(item.checked);
            rebuildTrayMenu();
            pushState();
          },
        },
    { type: 'separator' },
    { label: 'Quit', click: () => quitApp() },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip('Desktop World Clock Widget');
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on('double-click', () => openSettings());
  rebuildTrayMenu();
}

let quitting = false;
function quitApp() {
  quitting = true;
  for (const win of widgetWins.values()) if (!win.isDestroyed()) win.destroy();
  widgetWins.clear();
  if (tray) tray.destroy();
  app.quit();
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function zoneList() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
  } catch {
    /* fall through to the short list below */
  }
  return ['UTC', 'Asia/Seoul', 'America/New_York', 'Europe/London'];
}

function registerIpc() {
  ipcMain.handle('app:get-state', () => ({
    config: store.config,
    timeZones: zoneList(),
    systemZone: systemZone(),
    isPackaged: app.isPackaged,
    isStoreBuild: IS_STORE_BUILD,
  }));

  ipcMain.handle('widget:update', (_e, id, patch) => {
    const w = store.update(id, patch);
    if (!w) return null;
    const win = widgetWins.get(id);
    if (win && !win.isDestroyed()) applyBehavior(win, w);
    rebuildTrayMenu();
    pushState();
    return w;
  });

  ipcMain.handle('widget:add', (_e, tz) => {
    const w = store.add(tz || systemZone());
    syncWidgetWindows();
    pushState();
    return w;
  });

  ipcMain.handle('widget:duplicate', (_e, id) => {
    const w = store.duplicate(id);
    if (w) w.style.bgImage = ''; // the copy starts without the original's image
    syncWidgetWindows();
    pushState();
    return w;
  });

  ipcMain.handle('widget:remove', (_e, id) => {
    removeBackgroundFiles(id);
    const ok = store.remove(id);
    syncWidgetWindows();
    pushState();
    return ok;
  });

  ipcMain.handle('widget:pick-background', async (_e, id) => {
    if (!store.find(id)) return null;
    const res = await dialog.showOpenDialog(settingsWin || undefined, {
      title: 'Choose a background image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;

    const src = res.filePaths[0];
    const ext = (path.extname(src) || '.png').toLowerCase();
    // A fresh file name each time, so the renderer never serves a cached older image.
    const name = `${id}-${Date.now().toString(36)}${ext}`;
    try {
      fs.mkdirSync(BG_DIR, { recursive: true });
      removeBackgroundFiles(id);
      fs.copyFileSync(src, path.join(BG_DIR, name));
    } catch (err) {
      dialog.showErrorBox('Desktop World Clock Widget', `Could not use that image:\n${err.message}`);
      return null;
    }
    const w = store.update(id, { style: { bgImage: name } });
    pushState();
    return w;
  });

  ipcMain.handle('widget:clear-background', (_e, id) => {
    removeBackgroundFiles(id);
    const w = store.update(id, { style: { bgImage: '' } });
    pushState();
    return w;
  });

  ipcMain.handle('general:update', (_e, patch) => {
    const g = store.updateGeneral(patch);
    if ('startWithWindows' in patch) applyAutoStart(g.startWithWindows);
    rebuildTrayMenu();
    pushState();
    return g;
  });

  ipcMain.handle('settings:open', (_e, id) => openSettings(id));

  ipcMain.handle('app:quit', () => quitApp());

  // The renderer measures its own content and the window shrinks to match it exactly.
  ipcMain.on('widget:content-size', (_e, id, size) => {
    const win = widgetWins.get(id);
    if (!win || win.isDestroyed()) return;
    const w = Math.max(60, Math.ceil(size.width));
    const h = Math.max(40, Math.ceil(size.height));
    const [cw, ch] = win.getSize();
    if (cw === w && ch === h) return;
    const [x, y] = win.getPosition();
    const pos = clampToDisplay(x, y, w, h);
    win.setBounds({ x: pos.x, y: pos.y, width: w, height: h });
  });

  // Custom dragging. Using -webkit-app-region: drag would kill the right-click menu,
  // so the renderer reports a delta from the grab point instead.
  const dragOrigin = new Map();
  ipcMain.on('widget:drag-start', (_e, id) => {
    const win = widgetWins.get(id);
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    dragOrigin.set(id, { x, y });
  });
  ipcMain.on('widget:drag-move', (_e, id, dx, dy) => {
    const win = widgetWins.get(id);
    const origin = dragOrigin.get(id);
    if (!win || win.isDestroyed() || !origin) return;
    win.setPosition(Math.round(origin.x + dx), Math.round(origin.y + dy));
  });
  ipcMain.on('widget:drag-end', (_e, id) => {
    dragOrigin.delete(id);
    const win = widgetWins.get(id);
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const [w, h] = win.getSize();
    const pos = clampToDisplay(x, y, w, h);
    if (pos.x !== x || pos.y !== y) win.setPosition(pos.x, pos.y);
    store.update(id, { bounds: pos });
  });

  ipcMain.on('widget:context-menu', (_e, id) => {
    const w = store.find(id);
    if (!w) return;
    const menu = Menu.buildFromTemplate([
      { label: `${w.label || w.timeZone} settings...`, click: () => openSettings(id) },
      behaviorToggle(id, 'locked', 'Pin on top (lock position)', w.behavior.locked),
      behaviorToggle(id, 'visible', 'Show on desktop', w.behavior.visible !== false),
      { type: 'separator' },
      {
        label: 'Duplicate widget',
        click: () => {
          store.duplicate(id);
          syncWidgetWindows();
          pushState();
        },
      },
      {
        label: 'Delete widget',
        click: () => {
          removeBackgroundFiles(id);
          store.remove(id);
          syncWidgetWindows();
          pushState();
        },
      },
      { type: 'separator' },
      { label: 'All settings...', click: () => openSettings() },
      { label: 'Quit', click: () => quitApp() },
    ]);
    menu.popup({ window: widgetWins.get(id) });
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

app.on('second-instance', () => openSettings());

// Keeping a listener here stops Electron from quitting when the last window closes,
// which is what makes the app stay resident in the tray.
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.donryu.clockwidget');
  store = new Store();

  registerBackgroundProtocol();
  registerIpc();
  createTray();
  syncWidgetWindows();
  applyAutoStart(store.config.general.startWithWindows);

  // Pull widgets back on screen when a monitor or the DPI scaling changes.
  const reclamp = () => {
    for (const [id, win] of widgetWins) {
      if (win.isDestroyed()) continue;
      const [x, y] = win.getPosition();
      const [w, h] = win.getSize();
      const pos = clampToDisplay(x, y, w, h);
      if (pos.x !== x || pos.y !== y) {
        win.setPosition(pos.x, pos.y);
        store.update(id, { bounds: pos });
      }
    }
  };
  screen.on('display-metrics-changed', reclamp);
  screen.on('display-removed', reclamp);

  // Refresh right after waking from sleep or hibernation.
  powerMonitor.on('resume', () => pushState());
});

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught:', err);
  if (app.isReady()) {
    dialog.showErrorBox('Desktop World Clock Widget error', String(err && err.stack ? err.stack : err));
  }
});
