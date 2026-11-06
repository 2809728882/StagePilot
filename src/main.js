const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} = require('electron');
const QRCode = require('qrcode');
const { PasswordAuth } = require('./auth');
const { loadConfig, rotateToken, saveConfig } = require('./config');
const { scanMedia } = require('./media');
const { ProgramController } = require('./programs');
const { createControlServer } = require('./server');

let displayWindow;
let mainWindow;
let controlServer;
let tray;
let settingsWindow;
let authService;
let controllerBaseUrl;
let activeProgramController;
let state;
let configBundle;
let media = [];
let pendingMedia = new Map();
let pendingHoldFrame = null;
let commandQueue = Promise.resolve();
let quitStarted = false;
let quitAllowed = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function publicState() {
  return {
    status: state.status,
    active: state.active,
    error: state.error,
    programs: configBundle.config.programs.map(({ command, arguments: _arguments, ...program }) => program),
    media: media.map(({ path: _path, ...item }) => item),
    mediaFolders: configBundle.config.mediaDirectories.map((directory) => path.basename(directory)),
    windows: state.windows || [],
    server: state.server,
  };
}

function detectedBrowsers() {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    { id: 'edge', name: 'Microsoft Edge', command: path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), processName: 'msedge', color: '#42b7c5' },
    { id: 'chrome-system', name: 'Google Chrome', command: path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), processName: 'chrome', color: '#f2b941' },
    { id: 'chrome-x86', name: 'Google Chrome', command: path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), processName: 'chrome', color: '#f2b941' },
    { id: 'chrome-user', name: 'Google Chrome', command: path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'), processName: 'chrome', color: '#f2b941' },
    { id: 'firefox', name: 'Mozilla Firefox', command: path.join(programFiles, 'Mozilla Firefox', 'firefox.exe'), processName: 'firefox', color: '#a36df0' },
  ];
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!fs.existsSync(candidate.command) || seen.has(candidate.name)) return false;
    seen.add(candidate.name);
    return true;
  });
}

function dashboardState() {
  const mediaDirectoryReady = configBundle.config.mediaDirectories.some((directory) => fs.existsSync(directory));
  return {
    server: state.server,
    runtime: {
      status: state.status,
      active: state.active,
      error: state.error,
      configWarning: configBundle.configWarning,
      version: app.getVersion(),
      windowCount: state.windows?.length || 0,
      mediaCount: media.length,
    },
    readiness: [
      { id: 'password', label: '连接密码', ready: authService.hasPassword(), detail: authService.hasPassword() ? '已启用密码验证' : '请先设置连接密码' },
      { id: 'media', label: '视频文件夹', ready: mediaDirectoryReady, detail: mediaDirectoryReady ? `已发现 ${media.length} 个视频` : '请选择可访问的视频文件夹' },
      { id: 'programs', label: '快捷程序', ready: configBundle.config.programs.length > 0, detail: `已配置 ${configBundle.config.programs.length} 个快捷入口` },
    ],
    mediaDirectories: configBundle.config.mediaDirectories,
    programs: configBundle.config.programs,
    browsers: detectedBrowsers(),
    transitionMs: configBundle.config.transitionMs,
  };
}

function publishState() {
  controlServer?.broadcast({ type: 'state', payload: publicState() });
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('dashboard-state', dashboardState());
  }
}

function setState(patch) {
  state = { ...state, ...patch };
  publishState();
}

function sendDisplay(command) {
  displayWindow.webContents.send('display-command', command);
}

async function holdCurrentOutput() {
  if (displayWindow.isVisible()) return { addedFreezeFrame: false };
  const primary = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: primary.size.width, height: primary.size.height },
  });
  const source = sources.find((item) => item.display_id === String(primary.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('无法捕获当前主屏画面，已取消切换以避免暴露窗口准备过程');
  }

  const holdId = crypto.randomUUID();
  displayWindow.setBounds(primary.bounds);
  displayWindow.setOpacity(0);
  displayWindow.showInactive();
  displayWindow.setAlwaysOnTop(true, 'screen-saver');
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingHoldFrame = null;
        reject(new Error('Unable to prepare the existing-screen hold frame'));
      }, 1500);
      pendingHoldFrame = {
        id: holdId,
        resolve: () => {
          clearTimeout(timer);
          pendingHoldFrame = null;
          resolve();
        },
      };
      sendDisplay({ action: 'hold-frame', id: holdId, image: source.thumbnail.toDataURL() });
    });
    displayWindow.setOpacity(1);
    return { addedFreezeFrame: true };
  } catch (error) {
    displayWindow.hide();
    displayWindow.setOpacity(1);
    throw error;
  }
}

function releaseHeldOutput(hold, hideWindow) {
  if (!hold?.addedFreezeFrame) return;
  if (hideWindow) displayWindow.hide();
  sendDisplay({ action: 'release-hold' });
  displayWindow.setOpacity(1);
}

async function revealProgram(program, programController) {
  setState({ status: 'preparing', error: null });
  let hold;

  try {
    hold = await holdCurrentOutput();
    const prepared = await programController.switchWindow(
      () => programController.launchAndPrepare(program), configBundle.config.transitionMs,
    );
    displayWindow.hide();
    sendDisplay({ action: 'pause' });
    releaseHeldOutput(hold, false);
    sendDisplay({ action: 'release-hold' });
    setState({ status: 'live', active: { type: 'program', id: program.id, name: program.name }, error: null });
    return prepared;
  } catch (error) {
    // Keep the last presentation frame on failure; never expose partial preparation.
    setState({ status: 'error', error: error.message });
    throw error;
  }
}

async function revealWindow(windowItem, programController) {
  setState({ status: 'preparing', error: null });
  let hold;
  try {
    hold = await holdCurrentOutput();
    const prepared = await programController.switchWindow(
      () => programController.focusWindow(windowItem.processId, windowItem.windowHandle),
      configBundle.config.transitionMs,
    );
    displayWindow.hide();
    sendDisplay({ action: 'pause' });
    releaseHeldOutput(hold, false);
    sendDisplay({ action: 'release-hold' });
    setState({
      status: 'live',
      active: { type: 'window', id: windowItem.windowHandle, name: windowItem.title },
      error: null,
    });
    return prepared;
  } catch (error) {
    // Rollback runs while the existing-output layer still covers the desktop.
    setState({ status: 'error', error: error.message });
    throw error;
  }
}

async function refreshWindows(programController) {
  const windows = await programController.listWindows();
  state.windows = windows
    .filter((item) => item.processId !== process.pid && item.title !== 'StagePilot 输出')
    .map((item) => ({ ...item, name: item.title }))
    .slice(0, 40);
  publishState();
  return state.windows;
}

async function revealVideo(item) {
  setState({ status: 'preparing', error: null });
  const mediaUrl = `http://127.0.0.1:${configBundle.config.port}/media/${item.id}?token=${encodeURIComponent(configBundle.token)}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMedia.delete(item.id);
      setState({ status: 'error', error: '视频加载超时' });
      reject(new Error('视频加载超时'));
    }, 15000);
    pendingMedia.set(item.id, {
      item,
      timer,
      resolve,
      revealing: false,
      reject: (error) => {
        clearTimeout(timer);
        setState({ status: 'error', error: error.message });
        reject(error);
      },
    });
    sendDisplay({ action: 'prepare-video', id: item.id, url: mediaUrl, title: item.name });
  });
}

function showPairing() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (displayWindow?.isVisible()) {
    sendDisplay({ action: 'pause' });
    displayWindow.hide();
  }
  mainWindow.show();
  mainWindow.focus();
  setState({ status: 'ready', active: null, error: null });
}

function blackout() {
  displayWindow.setOpacity(1);
  displayWindow.show();
  displayWindow.setAlwaysOnTop(true, 'screen-saver');
  sendDisplay({ action: 'blackout' });
  setState({ status: 'blackout', active: null, error: null });
}

async function refreshPairingInfo() {
  const pairingUrl = authService.hasPassword()
    ? `${controllerBaseUrl}/?login=1`
    : `${controllerBaseUrl}/?token=${encodeURIComponent(configBundle.token)}`;
  const qrDataUrl = await QRCode.toDataURL(pairingUrl, { margin: 1, width: 360 });
  state.server = {
    url: `${controllerBaseUrl}/`,
    qrDataUrl,
    passwordRequired: authService.hasPassword(),
  };
  publishState();
  return pairingUrl;
}

function openPasswordSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 500,
    height: 560,
    minWidth: 420,
    minHeight: 500,
    title: 'StagePilot 连接设置',
    autoHideMenuBar: true,
    backgroundColor: '#0a0e16',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.setAlwaysOnTop(true, 'screen-saver');
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function rebuildTrayMenu(programController) {
  const folderLabel = configBundle.config.mediaDirectories.map((directory) => path.basename(directory)).join('、');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 StagePilot 主界面', click: showPairing },
    { type: 'separator' },
    { label: `视频文件夹：${folderLabel || '未选择'}`, enabled: false },
    { label: '选择视频文件夹…', click: () => chooseMediaDirectory(programController) },
    {
      label: '重新扫描视频',
      click: () => {
        media = scanMedia(configBundle.config.mediaDirectories);
        publishState();
      },
    },
    { type: 'separator' },
    { label: '安全黑屏', click: blackout },
    { label: '退出 StagePilot', click: () => app.quit() },
  ]));
}

async function chooseMediaDirectory(programController) {
  const dialogOptions = {
    title: '选择 StagePilot 视频文件夹',
    defaultPath: configBundle.config.mediaDirectories[0] || app.getPath('videos'),
    properties: ['openDirectory', 'createDirectory'],
  };
  const parent = mainWindow && mainWindow.isVisible() ? mainWindow : null;
  const result = parent
    ? await dialog.showOpenDialog(parent, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || !result.filePaths[0]) return;
  configBundle.config.mediaDirectories = [result.filePaths[0]];
  saveConfig(configBundle.userConfigPath, configBundle.config);
  media = scanMedia(configBundle.config.mediaDirectories);
  rebuildTrayMenu(programController);
  publishState();
}

function persistPrograms() {
  saveConfig(configBundle.userConfigPath, configBundle.config);
  rebuildTrayMenu(activeProgramController);
  publishState();
}

async function chooseProgramExecutable() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择要添加的快捷程序',
    properties: ['openFile'],
    filters: [{ name: 'Windows 程序', extensions: ['exe'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const command = result.filePaths[0];
  const baseName = path.basename(command, path.extname(command));
  const item = {
    id: `app-${crypto.randomUUID()}`,
    name: baseName,
    command,
    processName: baseName,
    color: '#6388f5',
  };
  configBundle.config.programs.push(item);
  persistPrograms();
  return item;
}

function addBrowserShortcut(browserId) {
  const browser = detectedBrowsers().find((item) => item.id === browserId);
  if (!browser) throw new Error('没有找到该浏览器');
  if (configBundle.config.programs.some((item) => item.command.toLowerCase() === browser.command.toLowerCase())) {
    throw new Error('该浏览器已经在快捷程序中');
  }
  const item = { ...browser, id: `browser-${crypto.randomUUID()}` };
  configBundle.config.programs.push(item);
  persistPrograms();
  return item;
}

function removeProgramShortcut(id) {
  const before = configBundle.config.programs.length;
  configBundle.config.programs = configBundle.config.programs.filter((item) => item.id !== id);
  if (configBundle.config.programs.length === before) throw new Error('快捷程序不存在');
  persistPrograms();
}

function createTray(programController) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#4f7cff"/><path d="M8 10h16v4H8zm0 8h11v4H8z" fill="white"/></svg>';
  let icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  if (icon.isEmpty()) icon = nativeImage.createFromPath(process.execPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('StagePilot 演示遥控器');
  tray.on('double-click', showPairing);
  rebuildTrayMenu(programController);
}

async function runCommand(command, programController) {
  if (!command || typeof command.action !== 'string') throw new Error('无效指令');

  if (command.action === 'show-program') {
    const program = configBundle.config.programs.find((item) => item.id === command.id);
    if (!program) throw new Error('没有找到该程序');
    return revealProgram(program, programController);
  }
  if (command.action === 'show-window') {
    const processId = Number(command.processId);
    const windowHandle = String(command.windowHandle || '');
    const windowItem = state.windows.find((item) =>
      item.processId === processId && (!windowHandle || item.windowHandle === windowHandle)
    );
    if (!windowItem) throw new Error('窗口已关闭，请刷新列表');
    return revealWindow(windowItem, programController);
  }
  if (command.action === 'close-window') {
    const processId = Number(command.processId);
    const windowHandle = String(command.windowHandle || '');
    const windowItem = state.windows.find((item) =>
      item.processId === processId && item.windowHandle === windowHandle
    );
    if (!windowItem) throw new Error('窗口已关闭，请刷新列表');
    const result = await programController.closeWindow(processId, windowHandle);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await refreshWindows(programController);
    return result;
  }
  if (command.action === 'play-video') {
    const item = media.find((candidate) => candidate.id === command.id);
    if (!item) throw new Error('没有找到该视频');
    return revealVideo(item);
  }
  if (command.action === 'pause' || command.action === 'resume') {
    sendDisplay({ action: command.action });
    return null;
  }
  if (command.action === 'seek') {
    const seconds = Number(command.seconds);
    if (!Number.isFinite(seconds)) throw new Error('无效进度');
    sendDisplay({ action: 'seek', seconds });
    return null;
  }
  if (command.action === 'volume') {
    const value = Math.max(0, Math.min(1, Number(command.value)));
    if (!Number.isFinite(value)) throw new Error('无效音量');
    sendDisplay({ action: 'volume', value });
    return null;
  }
  if (command.action === 'blackout') {
    blackout();
    return null;
  }
  if (command.action === 'refresh-media') {
    media = scanMedia(configBundle.config.mediaDirectories);
    publishState();
    return media.length;
  }
  if (command.action === 'refresh-windows') {
    return refreshWindows(programController);
  }
  if (command.action === 'exit-control') {
    setTimeout(() => app.quit(), 250);
    return null;
  }
  throw new Error('不支持的指令');
}

function enqueueCommand(command, programController) {
  if (quitStarted) return Promise.reject(new Error('StagePilot 正在退出'));
  const task = commandQueue.then(() => runCommand(command, programController));
  commandQueue = task.catch(() => {});
  return task;
}

async function createDisplayWindow() {
  const bounds = screen.getPrimaryDisplay().bounds;
  displayWindow = new BrowserWindow({
    ...bounds,
    fullscreen: true,
    frame: false,
    show: false,
    backgroundColor: '#05070b',
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  displayWindow.setAlwaysOnTop(true, 'screen-saver');
  displayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await displayWindow.loadFile(path.join(__dirname, 'renderer', 'display.html'));
  displayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  displayWindow.webContents.on('will-navigate', (event) => event.preventDefault());
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    show: false,
    title: 'StagePilot 控制中心',
    autoHideMenuBar: true,
    backgroundColor: '#080b12',
    webPreferences: {
      preload: path.join(__dirname, 'main-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'main.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  const projectRoot = app.getAppPath();
  configBundle = loadConfig(projectRoot, app.getPath('userData'), {
    defaultMediaDirectory: app.isPackaged ? app.getPath('videos') : undefined,
  });
  media = scanMedia(configBundle.config.mediaDirectories);
  const automationRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : projectRoot;
  const programController = new ProgramController(automationRoot, {
    statePath: path.join(configBundle.dataRoot, 'window-state.json'),
    displayBounds: screen.getPrimaryDisplay().bounds,
    getOverlayHandle: () => displayWindow && !displayWindow.isDestroyed()
      ? displayWindow.getNativeWindowHandle().readBigUInt64LE(0).toString() : '0',
  });
  activeProgramController = programController;
  // Recover only matching HWND/PID/process-start identities after an abnormal exit.
  await programController.restoreWindows();
  authService = new PasswordAuth(path.join(configBundle.dataRoot, 'auth.json'));
  const host = lanAddresses()[0] || '127.0.0.1';
  controllerBaseUrl = `http://${host}:${configBundle.config.port}`;

  state = {
    status: 'starting',
    active: null,
    error: null,
    server: { url: `${controllerBaseUrl}/`, qrDataUrl: '', passwordRequired: authService.hasPassword() },
    windows: [],
  };

  await createDisplayWindow();
  controlServer = createControlServer({
    projectRoot,
    port: configBundle.config.port,
    getToken: () => configBundle.token,
    authService,
    getState: async () => publicState(),
    runCommand: (command) => enqueueCommand(command, programController),
    getMedia: (id) => media.find((item) => item.id === id),
  });
  await controlServer.start();
  const pairingUrl = await refreshPairingInfo();
  await refreshWindows(programController);
  setState({ status: 'ready' });
  createTray(programController);
  await createMainWindow();
  mainWindow.show();

  globalShortcut.register('Control+Alt+Shift+Escape', () => {
    blackout();
  });
  globalShortcut.register('Control+Alt+Shift+M', () => chooseMediaDirectory(programController));
});

ipcMain.handle('settings:get-status', () => ({ hasPassword: authService?.hasPassword() || false }));
ipcMain.handle('settings:set-password', async (_event, password) => {
  if (!authService || !configBundle) throw new Error('程序尚未就绪');
  authService.setPassword(password);
  rotateToken(configBundle);
  controlServer?.disconnectClients();
  await refreshPairingInfo();
  rebuildTrayMenu(activeProgramController);
  publishState();
  return { ok: true };
});

ipcMain.handle('main:get-state', () => dashboardState());
ipcMain.handle('main:choose-video-folder', () => chooseMediaDirectory(activeProgramController));
ipcMain.handle('main:add-program', () => chooseProgramExecutable());
ipcMain.handle('main:add-browser', (_event, browserId) => addBrowserShortcut(browserId));
ipcMain.handle('main:remove-program', (_event, id) => removeProgramShortcut(id));
ipcMain.handle('main:set-transition-delay', (_event, milliseconds) => {
  const value = Number(milliseconds);
  if (!Number.isInteger(value) || value < 50 || value > 5000) {
    throw new Error('切换等待时间需要为 50–5000 毫秒');
  }
  configBundle.config.transitionMs = value;
  saveConfig(configBundle.userConfigPath, configBundle.config);
  publishState();
  return { ok: true };
});

ipcMain.on('media-ready', (_event, id) => {
  const pending = pendingMedia.get(id);
  if (!pending || pending.revealing) return;
  pending.revealing = true;
  sendDisplay({ action: 'reveal-video', id });
});

ipcMain.on('hold-frame-ready', (_event, id) => {
  if (pendingHoldFrame?.id === id) pendingHoldFrame.resolve();
});

ipcMain.on('media-presented', async (_event, id) => {
  const pending = pendingMedia.get(id);
  if (!pending) return;
  pendingMedia.delete(id);
  clearTimeout(pending.timer);
  const wasHidden = !displayWindow.isVisible();
  if (wasHidden) displayWindow.setOpacity(0);
  displayWindow.showInactive();
  displayWindow.setAlwaysOnTop(true, 'screen-saver');
  if (wasHidden) {
    await new Promise((resolve) => setTimeout(resolve, 32));
    displayWindow.setOpacity(1);
  }
  setState({
    status: 'live',
    active: { type: 'video', id, name: pending.item.name },
    error: null,
  });
  pending.resolve();
});

ipcMain.on('media-error', (_event, payload) => {
  const pending = pendingMedia.get(payload.id);
  if (!pending) return;
  pendingMedia.delete(payload.id);
  clearTimeout(pending.timer);
  pending.reject(new Error(payload.message || '视频无法播放'));
});

app.on('second-instance', showPairing);

app.on('before-quit', (event) => {
  if (quitAllowed || !activeProgramController) return;
  event.preventDefault();
  if (quitStarted) return;
  quitStarted = true;
  commandQueue.catch(() => {}).then(() => activeProgramController.restoreWindows())
    .catch((error) => console.error('Unity window state recovery failed:', error.message))
    .finally(() => { quitAllowed = true; app.quit(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
