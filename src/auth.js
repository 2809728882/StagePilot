const crypto = require('node:crypto');
const fs = require('node:fs');

const DEFAULT_ITERATIONS = 210000;

function fromHex(value) {
  return Buffer.from(String(value || ''), 'hex');
}

class PasswordAuth {
  constructor(filePath) {
    this.filePath = filePath;
    this.record = null;
    this.challenges = new Map();
    if (fs.existsSync(filePath)) {
      try {
        const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (record.salt && record.verifier && record.iterations) this.record = record;
      } catch {
        this.record = null;
      }
    }
  }

  hasPassword() {
    return Boolean(this.record);
  }

  setPassword(password) {
    if (typeof password !== 'string' || password.length < 6 || password.length > 64) {
      throw new Error('连接密码长度需要为 6–64 个字符');
    }
    const salt = crypto.randomBytes(16);
    const verifier = crypto.pbkdf2Sync(password, salt, DEFAULT_ITERATIONS, 32, 'sha256');
    this.record = {
      version: 1,
      iterations: DEFAULT_ITERATIONS,
      salt: salt.toString('hex'),
      verifier: verifier.toString('hex'),
    };
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.record, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    this.challenges.clear();
  }

  createChallenge() {
    if (!this.record) return { enabled: false };
    const now = Date.now();
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(id);
    }
    const id = crypto.randomUUID();
    const nonce = crypto.randomBytes(32);
    this.challenges.set(id, { nonce, expiresAt: now + 60000 });
    return {
      enabled: true,
      id,
      nonce: nonce.toString('hex'),
      salt: this.record.salt,
      iterations: this.record.iterations,
    };
  }

  verifyProof(id, proofHex) {
    if (!this.record) return false;
    const challenge = this.challenges.get(id);
    this.challenges.delete(id);
    if (!challenge || challenge.expiresAt <= Date.now()) return false;
    const supplied = fromHex(proofHex);
    const expected = crypto
      .createHmac('sha256', fromHex(this.record.verifier))
      .update(challenge.nonce)
      .digest();
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }
}

module.exports = { PasswordAuth };
