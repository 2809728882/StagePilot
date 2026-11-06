const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { createControlServer } = require('../src/server');

const projectRoot = path.resolve(__dirname, '..');
const token = 'visual-test-token';

app.whenReady().then(async () => {
  const state = {
    status: 'live',
    active: { type: 'video', id: 'launch', name: '新品发布会主片' },
    error: null,
    programs: [
      { id: 'slides', name: '演示文稿', color: '#7887ff' },
      { id: 'edge', name: 'Edge 浏览器', color: '#45cfc0' },
      { id: 'demo', name: '产品演示', color: '#c783ff' },
    ],
    windows: [
      { processId: 1201, name: '2026 秋季新品演示', processName: 'POWERPNT' },
      { processId: 1202, name: '产品功能页面', processName: 'msedge' },
    ],
    media: [
      { id: 'launch', name: '新品发布会主片', fileName: 'launch-film.mp4' },
      { id: 'feature', name: '核心功能演示', fileName: 'feature-demo.mp4' },
      { id: 'customer', name: '客户案例', fileName: 'customer-story.mp4' },
      { id: 'ending', name: '结束致谢', fileName: 'closing.mp4' },
    ],
    mediaFolders: ['发布会视频'],
    server: { url: '', passwordRequired: false },
  };
  const server = createControlServer({
    projectRoot,
    port: 0,
    token,
    getState: async () => state,
    runCommand: async () => null,
    getMedia: () => null,
  });
  const address = await server.start();
  const window = new BrowserWindow({
    width: 390,
    height: 844,
    useContentSize: true,
    show: false,
    webPreferences: { sandbox: true },
  });
  try {
    await window.loadURL(`http://127.0.0.1:${address.port}/?token=${token}`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(projectRoot, 'design', 'mobile-ui-implemented.png'), image.toPNG());
  } finally {
    window.destroy();
    await server.stop();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
