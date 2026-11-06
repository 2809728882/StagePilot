const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const { PasswordAuth } = require('../src/auth');
const { createControlServer } = require('../src/server');

test('control API requires pairing token and accepts commands', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagepilot-server-'));
  const videoPath = path.join(temp, 'clip.mp4');
  fs.writeFileSync(videoPath, Buffer.from('0123456789'));
  let received;
  const server = createControlServer({
    projectRoot: path.resolve(__dirname, '..'),
    port: 0,
    token: 'test-secret-token',
    getState: async () => ({ status: 'ready' }),
    runCommand: async (command) => { received = command; },
    getMedia: (id) => id === 'clip' ? { path: videoPath } : null,
  });
  const address = await server.start();
  context.after(() => server.stop());
  const base = `http://127.0.0.1:${address.port}`;

  const denied = await fetch(`${base}/api/state`);
  assert.equal(denied.status, 401);

  const accepted = await fetch(`${base}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-StagePilot-Token': 'test-secret-token' },
    body: JSON.stringify({ action: 'blackout' }),
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(received, { action: 'blackout' });

  const partial = await fetch(`${base}/media/clip?token=test-secret-token`, {
    headers: { Range: 'bytes=2-5' },
  });
  assert.equal(partial.status, 206);
  assert.equal(await partial.text(), '2345');
});

test('password challenge exchanges a valid proof for the current token', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagepilot-login-'));
  const auth = new PasswordAuth(path.join(temp, 'auth.json'));
  auth.setPassword('secure-demo-password');
  const server = createControlServer({
    projectRoot: path.resolve(__dirname, '..'),
    port: 0,
    getToken: () => 'rotatable-session-token',
    authService: auth,
    getState: async () => ({ status: 'ready' }),
    runCommand: async () => null,
    getMedia: () => null,
  });
  const address = await server.start();
  context.after(() => server.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const challenge = await (await fetch(`${base}/api/auth/challenge`)).json();
  const verifier = crypto.pbkdf2Sync(
    'secure-demo-password',
    Buffer.from(challenge.salt, 'hex'),
    challenge.iterations,
    32,
    'sha256'
  );
  const proof = crypto.createHmac('sha256', verifier)
    .update(Buffer.from(challenge.nonce, 'hex'))
    .digest('hex');
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId: challenge.id, proof }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { token: 'rotatable-session-token' });
});
