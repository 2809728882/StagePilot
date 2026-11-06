const params = new URLSearchParams(location.search);
const suppliedToken = params.get('token');
if (suppliedToken) {
  localStorage.setItem('stagepilot-token', suppliedToken);
  history.replaceState(null, '', '/');
}
let token = localStorage.getItem('stagepilot-token') || '';
let latestState = null;
let terminated = false;

function authHeaders() {
  return { 'Content-Type': 'application/json', 'X-StagePilot-Token': token };
}

const connection = document.getElementById('connection');
const nowPlaying = document.getElementById('now-playing');
const systemStatus = document.getElementById('system-status');
const programs = document.getElementById('programs');
const windows = document.getElementById('windows');
const media = document.getElementById('media');
const mediaFolder = document.getElementById('media-folder');
const toast = document.getElementById('toast');
const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('login-message');
const connectionPassword = document.getElementById('connection-password');

function notify(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

async function command(action, extras = {}) {
  const response = await fetch('/api/command', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action, ...extras }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '指令执行失败');
  return payload;
}

function stableHue(value) {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

function emptyState(message) {
  return Object.assign(document.createElement('div'), { className: 'empty', textContent: message });
}

function programTile(item) {
  const button = document.createElement('button');
  button.className = 'app-tile';
  button.style.setProperty('--accent', item.color || `hsl(${stableHue(item.name)} 76% 66%)`);
  button.title = item.name;
  const icon = Object.assign(document.createElement('span'), {
    className: 'app-icon',
    textContent: item.name.trim().slice(0, 1).toUpperCase() || 'A',
  });
  const name = Object.assign(document.createElement('strong'), { textContent: item.name });
  button.append(icon, name);
  attachSwitch(button, 'show-program', { id: item.id }, '程序切换指令已发送');
  return button;
}

function windowTile(item) {
  const row = document.createElement('div');
  row.className = 'window-tile';
  const button = document.createElement('button');
  button.className = 'window-open';
  const icon = Object.assign(document.createElement('span'), {
    className: 'window-icon',
    textContent: (item.processName || item.name).trim().slice(0, 1).toUpperCase(),
  });
  const copy = document.createElement('span');
  copy.className = 'window-copy';
  copy.append(
    Object.assign(document.createElement('strong'), { textContent: item.name }),
    Object.assign(document.createElement('small'), { textContent: item.processName || '正在运行' }),
  );
  const arrow = Object.assign(document.createElement('span'), { className: 'window-arrow', textContent: '›' });
  button.append(icon, copy, arrow);
  attachSwitch(button, 'show-window', {
    processId: item.processId,
    windowHandle: item.windowHandle,
  }, '窗口切换指令已发送');
  const close = document.createElement('button');
  close.className = 'window-close';
  close.type = 'button';
  close.setAttribute('aria-label', `关闭 ${item.name}`);
  close.textContent = '×';
  close.addEventListener('click', async () => {
    if (!window.confirm(`确定关闭“${item.name}”窗口吗？未保存内容可能需要在电脑端处理。`)) return;
    close.disabled = true;
    try {
      await command('close-window', { processId: item.processId, windowHandle: item.windowHandle });
      notify('已发送关闭窗口请求');
    } catch (error) {
      notify(error.message);
      close.disabled = false;
    }
  });
  row.append(button, close);
  return row;
}

function videoTile(item) {
  const button = document.createElement('button');
  button.className = 'video-tile';
  button.title = `全屏播放 ${item.name}`;
  const art = document.createElement('span');
  art.className = 'video-art';
  art.style.setProperty('--hue', stableHue(item.fileName || item.name));
  art.append(Object.assign(document.createElement('span'), { className: 'video-play' }));
  const copy = document.createElement('span');
  copy.className = 'video-copy';
  copy.append(
    Object.assign(document.createElement('strong'), { textContent: item.name }),
    Object.assign(document.createElement('small'), { textContent: item.fileName }),
  );
  button.append(art, copy);
  attachSwitch(button, 'play-video', { id: item.id }, '视频全屏播放指令已发送');
  return button;
}

function attachSwitch(button, action, payload, successMessage) {
  button.addEventListener('click', async () => {
    button.classList.add('pending');
    try {
      await command(action, payload);
      notify(successMessage);
    } catch (error) {
      notify(error.message);
    } finally {
      button.classList.remove('pending');
    }
  });
}

function render(state) {
  latestState = state;
  document.body.dataset.status = state.status;
  connection.textContent = '已连接';
  connection.classList.add('online');
  nowPlaying.textContent = state.active?.name || (state.status === 'blackout' ? '安全黑屏' : '待命');
  const labels = {
    ready: '电脑端已就绪',
    preparing: '切换中 · 电脑保持上一画面',
    live: '正在主屏全屏演示',
    blackout: '主屏已保护',
    error: state.error || '发生错误',
  };
  systemStatus.textContent = labels[state.status] || state.status;

  const programNodes = state.programs.length
    ? state.programs.map(programTile)
    : [emptyState('请先在电脑端添加快捷程序或浏览器')];
  programs.replaceChildren(...programNodes);
  const windowNodes = state.windows.length
    ? state.windows.map(windowTile)
    : [emptyState('没有检测到可切换窗口')];
  windows.replaceChildren(...windowNodes);
  const mediaNodes = state.media.length
    ? state.media.map(videoTile)
    : [emptyState('所选文件夹中还没有可播放视频')];
  media.replaceChildren(...mediaNodes);
  mediaFolder.textContent = state.mediaFolders?.length ? state.mediaFolders.join('、') : '请在电脑端主界面选择文件夹';
}

async function loadState() {
  const response = await fetch('/api/state', { headers: authHeaders() });
  if (!response.ok) {
    const error = new Error(response.status === 401 ? '需要连接密码' : '无法连接电脑');
    error.status = response.status;
    throw error;
  }
  render(await response.json());
}

function hexBytes(value) {
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

function bytesHex(value) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createPasswordProof(password, challenge) {
  if (!globalThis.crypto?.subtle) {
    return globalThis.StagePilotCrypto.createPasswordProof(password, challenge);
  }
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const verifier = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: hexBytes(challenge.salt),
    iterations: challenge.iterations,
  }, passwordKey, 256);
  const hmacKey = await crypto.subtle.importKey(
    'raw', verifier, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const proof = await crypto.subtle.sign('HMAC', hmacKey, hexBytes(challenge.nonce));
  return bytesHex(proof);
}

async function beginPasswordLogin() {
  const response = await fetch('/api/auth/challenge');
  if (!response.ok) throw new Error('无法读取连接设置');
  const challenge = await response.json();
  if (!challenge.enabled) {
    systemStatus.textContent = '请重新扫描电脑端二维码';
    notify('请重新扫描电脑端二维码');
    return;
  }
  loginScreen.hidden = false;
  loginScreen.dataset.challenge = JSON.stringify(challenge);
  connectionPassword.focus();
}

function connectEvents() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/events?token=${encodeURIComponent(token)}`);
  socket.onopen = () => { connection.textContent = '已连接'; connection.classList.add('online'); };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') render(message.payload);
  };
  socket.onclose = () => {
    if (terminated) return;
    connection.textContent = '重连中';
    connection.classList.remove('online');
    setTimeout(async () => {
      try { await loadState(); connectEvents(); }
      catch (error) { if (error.status === 401) beginPasswordLogin().catch((failure) => notify(failure.message)); }
    }, 1200);
  };
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginMessage.textContent = '正在验证…';
  try {
    let challenge = JSON.parse(loginScreen.dataset.challenge || 'null');
    if (!challenge) {
      const response = await fetch('/api/auth/challenge');
      challenge = await response.json();
    }
    const proof = await createPasswordProof(connectionPassword.value, challenge);
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: challenge.id, proof }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '连接失败');
    token = payload.token;
    localStorage.setItem('stagepilot-token', token);
    connectionPassword.value = '';
    loginScreen.hidden = true;
    await loadState();
    connectEvents();
  } catch (error) {
    loginMessage.textContent = error.message;
    const challengeResponse = await fetch('/api/auth/challenge');
    loginScreen.dataset.challenge = JSON.stringify(await challengeResponse.json());
  }
});

document.getElementById('refresh').addEventListener('click', async () => {
  try { await command('refresh-media'); notify('视频列表已刷新'); } catch (error) { notify(error.message); }
});
document.getElementById('refresh-windows').addEventListener('click', async () => {
  try { await command('refresh-windows'); notify('窗口列表已刷新'); } catch (error) { notify(error.message); }
});
document.getElementById('blackout').addEventListener('click', async () => {
  try { await command('blackout'); } catch (error) { notify(error.message); }
});
document.getElementById('exit-control').addEventListener('click', async () => {
  try {
    await command('exit-control');
    terminated = true;
    localStorage.removeItem('stagepilot-token');
    connection.textContent = '已退出';
    connection.classList.remove('online');
    systemStatus.textContent = '电脑端管控已关闭';
    notify('电脑端管控已退出');
  } catch (error) { notify(error.message); }
});
document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', async () => {
    try { await command(button.dataset.command, { seconds: Number(button.dataset.seconds) || undefined }); }
    catch (error) { notify(error.message); }
  });
});

loadState().then(connectEvents).catch((error) => {
  connection.textContent = '未连接';
  systemStatus.textContent = error.message;
  if (error.status === 401) beginPasswordLogin().catch((failure) => notify(failure.message));
  else notify(error.message);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
