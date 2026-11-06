const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PasswordAuth } = require('../src/auth');

test('password challenge accepts the correct proof once', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagepilot-auth-'));
  const auth = new PasswordAuth(path.join(temp, 'auth.json'));
  auth.setPassword('演示密码123');
  const challenge = auth.createChallenge();
  const verifier = crypto.pbkdf2Sync(
    '演示密码123',
    Buffer.from(challenge.salt, 'hex'),
    challenge.iterations,
    32,
    'sha256'
  );
  const proof = crypto
    .createHmac('sha256', verifier)
    .update(Buffer.from(challenge.nonce, 'hex'))
    .digest('hex');
  assert.equal(auth.verifyProof(challenge.id, proof), true);
  assert.equal(auth.verifyProof(challenge.id, proof), false);
});
