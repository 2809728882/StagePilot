const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function runPowerShell(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      ...args,
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeoutIndex = args.indexOf('-TimeoutSeconds');
    const seconds = timeoutIndex >= 0 ? Number(args[timeoutIndex + 1]) : 12;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(20000, (seconds + 8) * 1000));
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Window operation timed out; the target may be unresponsive.'));
      else if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });
  });
}

function parseWindowResult(output) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error('Window controller returned an invalid result');
  }
}

class ProgramController {
  constructor(projectRoot, options = {}) {
    this.windowScript = path.join(projectRoot, 'scripts', 'window-control.ps1');
    this.statePath = options.statePath || path.join(os.tmpdir(), `stagepilot-windows-${process.pid}-${crypto.randomUUID()}.json`);
    this.displayBounds = options.displayBounds || { x: 0, y: 0, width: 0, height: 0 };
    this.runner = options.runner || runPowerShell;
    this.getOverlayHandle = options.getOverlayHandle || (() => '0');
  }

  run(args) {
    const { x, y, width, height } = this.displayBounds;
    return this.runner(this.windowScript, [...args,
      '-StatePath', this.statePath,
      '-OverlayHandle', String(this.getOverlayHandle()),
      '-DisplayX', String(x), '-DisplayY', String(y),
      '-DisplayWidth', String(width), '-DisplayHeight', String(height),
    ]);
  }

  async beginSwitch() { await this.run(['-Action', 'Begin']); }
  async commitSwitch() { await this.run(['-Action', 'Commit']); }
  async rollbackSwitch() { await this.run(['-Action', 'Rollback']); }
  async restoreWindows() { await this.run(['-Action', 'Restore']); }

  async switchWindow(prepare, confirmDelay = 0) {
    await this.beginSwitch();
    try {
      const prepared = await prepare();
      if (confirmDelay) await new Promise((resolve) => setTimeout(resolve, confirmDelay));
      await this.confirmWindow(prepared.processId, prepared.windowHandle);
      await this.commitSwitch();
      return prepared;
    } catch (error) {
      try { await this.rollbackSwitch(); } catch (rollbackError) {
        throw new Error(`${error.message}; window state recovery failed: ${rollbackError.message}`);
      }
      throw error;
    }
  }

  async launchAndPrepare(program) {
    const args = [
      '-Action', 'Launch',
      '-Command', program.command,
      '-ProcessName', program.processName || '',
      '-TimeoutSeconds', String(program.timeoutSeconds || 12),
    ];
    if (program.arguments) args.push('-Arguments', program.arguments);
    return parseWindowResult(await this.run(args));
  }

  async listWindows() {
    const output = await this.run(['-Action', 'List']);
    return output ? JSON.parse(output) : [];
  }

  async focusWindow(processId, windowHandle) {
    const args = [
      '-Action', 'Focus',
      '-ProcessId', String(processId),
    ];
    if (windowHandle) args.push('-WindowHandle', String(windowHandle));
    return parseWindowResult(await this.run(args));
  }

  async confirmWindow(processId, windowHandle) {
    const args = [
      '-Action', 'Confirm',
      '-ProcessId', String(processId),
    ];
    if (windowHandle) args.push('-WindowHandle', String(windowHandle));
    return parseWindowResult(await this.run(args));
  }

  async closeWindow(processId, windowHandle) {
    const args = [
      '-Action', 'Close',
      '-ProcessId', String(processId),
    ];
    if (windowHandle) args.push('-WindowHandle', String(windowHandle));
    return parseWindowResult(await this.run(args));
  }
}

module.exports = { ProgramController };
