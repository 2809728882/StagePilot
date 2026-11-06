const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer } = require('ws');

function safeEqual(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && require('node:crypto').timingSafeEqual(a, b);
}

function mediaContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg',
  }[extension] || 'application/octet-stream';
}

function createControlServer({ projectRoot, port, token, getToken, authService, getState, runCommand, getMedia }) {
  const app = express();
  const server = http.createServer(app);
  const sockets = new Set();
  const loginFailures = new Map();
  const currentToken = () => getToken ? getToken() : token;

  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws:; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(path.join(projectRoot, 'public'), {
    etag: true,
    maxAge: '5m',
  }));

  app.get('/api/auth/challenge', (_request, response) => {
    response.json(authService?.createChallenge() || { enabled: false });
  });

  app.post('/api/login', (request, response) => {
    const address = request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (loginFailures.get(address) || []).filter((time) => now - time < 300000);
    if (recent.length >= 5) {
      return response.status(429).json({ error: '尝试次数过多，请五分钟后重试' });
    }
    const accepted = authService?.verifyProof(request.body?.challengeId, request.body?.proof);
    if (!accepted) {
      recent.push(now);
      loginFailures.set(address, recent);
      return response.status(401).json({ error: '连接密码错误或已超时' });
    }
    loginFailures.delete(address);
    response.json({ token: currentToken() });
  });

  const authenticate = (request, response, next) => {
    const supplied = request.get('x-stagepilot-token') || request.query.token;
    if (!safeEqual(supplied, currentToken())) {
      return response.status(401).json({ error: '未配对或配对已失效' });
    }
    next();
  };

  app.get('/api/state', authenticate, async (_request, response) => {
    response.json(await getState());
  });

  app.post('/api/command', authenticate, async (request, response) => {
    try {
      const result = await runCommand(request.body || {});
      response.json({ ok: true, result });
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get('/media/:id', authenticate, (request, response) => {
    const item = getMedia(request.params.id);
    if (!item || !fs.existsSync(item.path)) return response.sendStatus(404);
    const size = fs.statSync(item.path).size;
    const contentType = mediaContentType(item.path);
    const range = request.headers.range;
    if (!range) {
      response.setHeader('Content-Length', size);
      response.setHeader('Content-Type', contentType);
      return fs.createReadStream(item.path).pipe(response);
    }

    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return response.sendStatus(416);
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;
    if (start >= size || end >= size || start > end) return response.sendStatus(416);
    response.writeHead(206, {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
    });
    fs.createReadStream(item.path, { start, end }).pipe(response);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://stagepilot.local');
    if (url.pathname !== '/events' || !safeEqual(url.searchParams.get('token'), currentToken())) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', async (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: 'state', payload: await getState() }));
    socket.on('close', () => sockets.delete(socket));
  });

  function broadcast(payload) {
    const message = JSON.stringify(payload);
    for (const socket of sockets) {
      if (socket.readyState === 1) socket.send(message);
    }
  }

  function disconnectClients() {
    for (const socket of sockets) socket.close(4001, 'credentials changed');
    sockets.clear();
  }

  return {
    start: () => new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve(server.address()))),
    stop: () => new Promise((resolve) => server.close(resolve)),
    broadcast,
    disconnectClients,
  };
}

module.exports = { createControlServer };
