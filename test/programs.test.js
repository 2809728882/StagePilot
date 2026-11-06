const assert = require('node:assert/strict');
const test = require('node:test');
const { ProgramController } = require('../src/programs');

function fixture(failAction) {
  const calls = [];
  const controller = new ProgramController('/project', {
    statePath: '/session/state.json',
    displayBounds: { x: -1920, y: 0, width: 1920, height: 1080 },
    runner: async (_script, args) => {
      const action = args[args.indexOf('-Action') + 1];
      calls.push({ action, args });
      if (action === failAction) throw new Error('test failure');
      return JSON.stringify({ processId: 123, windowHandle: '456' });
    },
  });
  return { controller, calls };
}

test('switch uses the same HWND for preparation and confirmation, then commits', async () => {
  const { controller, calls } = fixture();
  const result = await controller.switchWindow(() => controller.focusWindow(123, '456'));
  assert.equal(result.windowHandle, '456');
  assert.deepEqual(calls.map((call) => call.action), ['Begin', 'Focus', 'Confirm', 'Commit']);
  const confirm = calls[2].args;
  assert.equal(confirm[confirm.indexOf('-WindowHandle') + 1], '456');
  for (const { args } of calls) {
    assert.equal(args[args.indexOf('-StatePath') + 1], '/session/state.json');
    assert.equal(args[args.indexOf('-DisplayX') + 1], '-1920');
  }
});

for (const failAction of ['Focus', 'Confirm', 'Commit']) {
  test(`failed ${failAction} rolls back before surfacing the error`, async () => {
    const { controller, calls } = fixture(failAction);
    await assert.rejects(controller.switchWindow(() => controller.focusWindow(123, '456')), /test failure/);
    assert.equal(calls.at(-1).action, 'Rollback');
  });
}

test('restore is available for shutdown and abnormal-exit recovery', async () => {
  const { controller, calls } = fixture();
  await controller.restoreWindows();
  assert.equal(calls[0].action, 'Restore');
});
