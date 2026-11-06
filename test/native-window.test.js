const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { once } = require('node:events');
const test = require('node:test');
const { ProgramController } = require('../src/programs');

test('native Unity topmost policy: switch, restore size, rollback, shutdown, unrelated windows', {
  skip: process.platform !== 'win32' || process.env.STAGEPILOT_NATIVE_TEST !== '1',
  timeout: 90000,
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagepilot-native-'));
  const executable = path.join(temp, 'fixture.exe');
  const csc = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  execFileSync(csc, ['/nologo', `/out:${executable}`, path.join(__dirname, 'fixtures/unity-window-fixture.cs')]);
  const child = spawn(executable, [], { windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  const waiting = []; const buffered = [];
  lines.on('line', (line) => {
    const value = JSON.parse(line);
    if (waiting.length) waiting.shift()(value); else buffered.push(value);
  });
  function read() {
    if (buffered.length) return Promise.resolve(buffered.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native fixture timed out')), 5000);
      waiting.push((value) => { clearTimeout(timer); resolve(value); });
    });
  }
  async function snapshot() { child.stdin.write('state\n'); return read(); }
  let overlayHandle = '0';
  const controller = new ProgramController(process.env.STAGEPILOT_NATIVE_ROOT || path.resolve(__dirname, '..'), {
    statePath: path.join(temp, 'state.json'), displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    getOverlayHandle: () => overlayHandle,
  });
  try {
    const windows = await read();
    const original = await snapshot();
    assert.equal(original.unity.topmost, true);
    overlayHandle = windows.hold;
    child.stdin.write('hold\n');
    assert.equal((await snapshot()).holdAboveUnity, true);
    await controller.switchWindow(() => controller.focusWindow(windows.processId, windows.browser));
    const switched = await snapshot();
    assert.equal(switched.unity.topmost, false);
    assert.equal(switched.unity.minimized, true);
    assert.equal(switched.foreground, windows.browser);
    assert.deepEqual(switched.other, original.other);
    await controller.switchWindow(() => controller.focusWindow(windows.processId, windows.unity));
    const restored = await snapshot();
    assert.equal(restored.unity.topmost, true);
    assert.equal(restored.unity.minimized, false);
    assert.deepEqual(restored.unity.rect, original.unity.rect);
    assert.equal(restored.holdAboveUnity, true, 'Unity must remain underneath the hold frame until reveal');
    await assert.rejects(controller.switchWindow(async () => {
      await controller.focusWindow(windows.processId, windows.browser);
      throw new Error('forced preparation failure');
    }), /forced preparation failure/);
    assert.deepEqual((await snapshot()).unity, restored.unity);
    assert.equal((await snapshot()).holdAboveUnity, true, 'rollback must not expose Unity above the hold');
    await controller.switchWindow(() => controller.focusWindow(windows.processId, windows.browser));
    await assert.rejects(controller.switchWindow(async () => {
      await controller.focusWindow(windows.processId, windows.unity);
      throw new Error('forced switch-back failure');
    }), /forced switch-back failure/);
    const rollbackToBrowser = await snapshot();
    assert.equal(rollbackToBrowser.unity.topmost, false);
    assert.equal(rollbackToBrowser.unity.minimized, true);
    await controller.restoreWindows();
    assert.deepEqual((await snapshot()).unity, restored.unity);
    assert.equal(JSON.parse(fs.readFileSync(controller.statePath)).records.length, 0);
  } finally {
    await controller.restoreWindows().catch(() => {});
    child.stdin.write('exit\n');
    await once(child, 'exit');
    lines.close();
  }
});
