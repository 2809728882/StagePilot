const cover = document.getElementById('cover');
const title = document.getElementById('cover-title');
const subtitle = document.getElementById('cover-subtitle');
const qr = document.getElementById('qr');
const url = document.getElementById('url');
const holdFrame = document.getElementById('hold-frame');
const players = [document.getElementById('video-a'), document.getElementById('video-b')];
let activePlayerIndex = -1;
let standbyPlayerIndex = 0;
let preparedId = null;

function showCover(nextTitle, nextSubtitle = '') {
  for (const player of players) {
    player.pause();
    player.classList.remove('visible');
  }
  holdFrame.classList.remove('visible');
  cover.classList.add('visible');
  title.textContent = nextTitle;
  subtitle.textContent = nextSubtitle;
  qr.classList.remove('visible');
  url.textContent = '';
}

window.stagePilot.onCommand(async (command) => {
  if (command.action === 'welcome') {
    showCover('演示控制台', '手机扫码后即可控制');
    qr.src = command.qrDataUrl;
    qr.classList.add('visible');
    url.textContent = command.controllerUrl;
  } else if (command.action === 'cover') {
    // Kept for compatibility; presentation switches no longer show preparation UI.
  } else if (command.action === 'blackout') {
    showCover('', '');
  } else if (command.action === 'error') {
    showCover('切换失败', command.message || '请在手机端重试');
  } else if (command.action === 'prepare-video') {
    preparedId = command.id;
    standbyPlayerIndex = activePlayerIndex === 0 ? 1 : 0;
    const standby = players[standbyPlayerIndex];
    standby.pause();
    standby.classList.remove('visible');
    standby.dataset.mediaId = command.id;
    standby.src = command.url;
    standby.load();
  } else if (command.action === 'reveal-video' && command.id === preparedId) {
    const next = players[standbyPlayerIndex];
    await next.play();
    const previous = activePlayerIndex >= 0 ? players[activePlayerIndex] : null;
    next.classList.add('visible');
    if (previous && previous !== next) {
      previous.classList.remove('visible');
      previous.pause();
    }
    activePlayerIndex = standbyPlayerIndex;
    holdFrame.classList.remove('visible');
    cover.classList.remove('visible');
    requestAnimationFrame(() => requestAnimationFrame(() => window.stagePilot.mediaPresented(command.id)));
  } else if (command.action === 'hold-frame') {
    holdFrame.src = command.image;
    try { await holdFrame.decode(); } catch { /* The load event may already have completed. */ }
    holdFrame.classList.add('visible');
    cover.classList.remove('visible');
    requestAnimationFrame(() => requestAnimationFrame(() => window.stagePilot.holdFrameReady(command.id)));
  } else if (command.action === 'release-hold') {
    holdFrame.classList.remove('visible');
    holdFrame.removeAttribute('src');
  } else if (command.action === 'pause') {
    if (activePlayerIndex >= 0) players[activePlayerIndex].pause();
  } else if (command.action === 'resume') {
    if (activePlayerIndex >= 0) await players[activePlayerIndex].play();
  } else if (command.action === 'seek') {
    if (activePlayerIndex >= 0) {
      const player = players[activePlayerIndex];
      player.currentTime = Math.max(0, player.currentTime + command.seconds);
    }
  } else if (command.action === 'volume') {
    for (const player of players) player.volume = command.value;
  }
});

for (const player of players) {
  player.addEventListener('canplay', () => {
    if (player.dataset.mediaId === preparedId) window.stagePilot.mediaReady(preparedId);
  }, { passive: true });
  player.addEventListener('error', () => {
    const id = player.dataset.mediaId;
    if (id) window.stagePilot.mediaError(id, player.error?.message || '浏览器不支持该视频编码');
  });
}

window.stagePilot.ready();
