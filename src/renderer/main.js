const serverUrl = document.getElementById('server-url');
const qr = document.getElementById('qr');
const passwordStatus = document.getElementById('password-status');
const passwordForm = document.getElementById('password-form');
const password = document.getElementById('password');
const confirmPassword = document.getElementById('confirm-password');
const passwordMessage = document.getElementById('password-message');
const mediaPath = document.getElementById('media-path');
const browserSelect = document.getElementById('browser-select');
const programList = document.getElementById('program-list');
const toast = document.getElementById('toast');
const readinessList = document.getElementById('readiness-list');
const readinessScore = document.getElementById('readiness-score');
const runtimeSummary = document.getElementById('runtime-summary');
const runtimeWarning = document.getElementById('runtime-warning');
const transitionForm = document.getElementById('transition-form');
const transitionMs = document.getElementById('transition-ms');

function notify(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

function render(state) {
  serverUrl.textContent = state.server.url;
  qr.src = state.server.qrDataUrl;
  passwordStatus.textContent = state.server.passwordRequired ? '已启用连接密码' : '当前使用扫码令牌连接';
  mediaPath.textContent = state.mediaDirectories.join('；');
  const readyCount = state.readiness.filter((item) => item.ready).length;
  readinessScore.textContent = `${readyCount} / ${state.readiness.length}`;
  readinessScore.classList.toggle('complete', readyCount === state.readiness.length);
  readinessList.replaceChildren(...state.readiness.map((item) => {
    const row = document.createElement('div');
    row.className = `readiness-item ${item.ready ? 'ready' : ''}`;
    const dot = document.createElement('span');
    dot.className = 'readiness-dot';
    const copy = document.createElement('div');
    copy.append(
      Object.assign(document.createElement('strong'), { textContent: item.label }),
      Object.assign(document.createElement('small'), { textContent: item.detail }),
    );
    row.append(dot, copy);
    return row;
  }));
  const runtimeLabels = { starting: '正在启动', ready: '电脑端已就绪', preparing: '正在切换，主屏保持上一画面', live: '正在演示', blackout: '主屏已安全黑屏', error: '需要处理错误' };
  runtimeSummary.textContent = `${runtimeLabels[state.runtime.status] || state.runtime.status} · ${state.runtime.mediaCount} 个视频 · ${state.runtime.windowCount} 个窗口 · v${state.runtime.version}`;
  const warning = state.runtime.error || state.runtime.configWarning || '';
  runtimeWarning.textContent = warning;
  runtimeWarning.hidden = !warning;
  if (document.activeElement !== transitionMs) transitionMs.value = state.transitionMs;
  browserSelect.replaceChildren(...state.browsers.map((browser) => {
    const option = document.createElement('option');
    option.value = browser.id;
    option.textContent = browser.name;
    return option;
  }));
  if (!state.browsers.length) {
    const option = document.createElement('option');
    option.textContent = '未检测到常用浏览器';
    option.value = '';
    browserSelect.append(option);
  }
  programList.replaceChildren(...state.programs.map((program) => {
    const row = document.createElement('div');
    row.className = 'program-row';
    const avatar = document.createElement('span');
    avatar.className = 'program-avatar';
    avatar.textContent = program.name.slice(0, 1).toUpperCase();
    const copy = document.createElement('div');
    copy.className = 'program-copy';
    const name = document.createElement('strong');
    name.textContent = program.name;
    const command = document.createElement('small');
    command.textContent = program.command;
    copy.append(name, command);
    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '移除';
    remove.addEventListener('click', async () => {
      try { await window.stagePilotMain.removeProgram(program.id); notify('快捷程序已移除'); }
      catch (error) { notify(error.message); }
    });
    row.append(avatar, copy, remove);
    return row;
  }));
}

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  passwordMessage.classList.remove('error');
  if (password.value !== confirmPassword.value) {
    passwordMessage.textContent = '两次输入的密码不一致';
    passwordMessage.classList.add('error');
    return;
  }
  try {
    await window.stagePilotMain.setPassword(password.value);
    password.value = '';
    confirmPassword.value = '';
    passwordMessage.textContent = '连接密码已保存，旧手机连接已失效';
  } catch (error) {
    passwordMessage.textContent = error.message;
    passwordMessage.classList.add('error');
  }
});

document.getElementById('choose-folder').addEventListener('click', async () => {
  try { await window.stagePilotMain.chooseVideoFolder(); notify('视频文件夹已更新'); }
  catch (error) { notify(error.message); }
});
document.getElementById('add-program').addEventListener('click', async () => {
  try { const result = await window.stagePilotMain.addProgram(); if (result) notify('快捷程序已添加'); }
  catch (error) { notify(error.message); }
});
document.getElementById('add-browser').addEventListener('click', async () => {
  if (!browserSelect.value) return;
  try { await window.stagePilotMain.addBrowser(browserSelect.value); notify('浏览器快捷方式已添加'); }
  catch (error) { notify(error.message); }
});

transitionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await window.stagePilotMain.setTransitionDelay(Number(transitionMs.value));
    notify('切换等待时间已保存');
  } catch (error) { notify(error.message); }
});

window.stagePilotMain.onState(render);
window.stagePilotMain.getState().then(render).catch((error) => notify(error.message));
