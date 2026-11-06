const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadConfig, saveConfig } = require('../src/config');
const { scanMedia } = require('../src/media');

test('creates persistent configuration and pairing token', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagepilot-'));
  const bundle = loadConfig(path.resolve(__dirname, '..'), temp);
  assert.equal(bundle.config.port, 17860);
  assert.ok(bundle.token.length >= 24);
  assert.ok(fs.existsSync(bundle.userConfigPath));
});

test('recovers from malformed user config without overwriting it', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagepilot-broken-config-'));
  const dataRoot = path.join(temp, 'stagepilot');
  fs.mkdirSync(dataRoot);
  const userConfigPath = path.join(dataRoot, 'config.json');
  fs.writeFileSync(userConfigPath, '{broken');
  const bundle = loadConfig(path.resolve(__dirname, '..'), temp);
  assert.equal(bundle.config.port, 17860);
  assert.match(bundle.configWarning, /配置文件格式损坏/);
  assert.equal(fs.readFileSync(userConfigPath, 'utf8'), '{broken');
});

test('sanitizes invalid configuration values and program records', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagepilot-invalid-config-'));
  const dataRoot = path.join(temp, 'stagepilot');
  fs.mkdirSync(dataRoot);
  fs.writeFileSync(path.join(dataRoot, 'config.json'), JSON.stringify({
    port: 1,
    transitionMs: 999999,
    programs: [{ id: 'valid', name: 'Valid', command: 'valid.exe' }, { id: 'missing-command' }],
    mediaDirectories: ['media', null],
  }));
  const bundle = loadConfig(path.resolve(__dirname, '..'), temp);
  assert.equal(bundle.config.port, 17860);
  assert.equal(bundle.config.transitionMs, 260);
  assert.equal(bundle.config.programs.length, 1);
  assert.equal(bundle.config.mediaDirectories.length, 1);
});

test('atomically replaces an existing user configuration', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagepilot-save-config-'));
  const filePath = path.join(temp, 'config.json');
  fs.writeFileSync(filePath, '{}');
  saveConfig(filePath, { port: 17860, transitionMs: 480, programs: [], mediaDirectories: [] });
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).transitionMs, 480);
  assert.equal(fs.existsSync(`${filePath}.${process.pid}.tmp`), false);
});

test('discovers supported video files only', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagepilot-media-'));
  fs.writeFileSync(path.join(temp, 'demo.mp4'), '');
  fs.writeFileSync(path.join(temp, 'notes.txt'), '');
  const media = scanMedia([temp]);
  assert.equal(media.length, 1);
  assert.equal(media[0].fileName, 'demo.mp4');
});
