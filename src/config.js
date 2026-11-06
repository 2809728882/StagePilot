const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function isIntegerBetween(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function normalizeConfig(defaults, overrides = {}) {
  const programs = Array.isArray(overrides.programs) ? overrides.programs : defaults.programs;
  const mediaDirectories = Array.isArray(overrides.mediaDirectories)
    ? overrides.mediaDirectories
    : defaults.mediaDirectories;
  return {
    port: isIntegerBetween(overrides.port, 1024, 65535) ? overrides.port : defaults.port,
    transitionMs: isIntegerBetween(overrides.transitionMs, 50, 5000)
      ? overrides.transitionMs
      : defaults.transitionMs,
    programs: programs.filter((program) => program
      && typeof program.id === 'string'
      && typeof program.name === 'string'
      && typeof program.command === 'string'),
    mediaDirectories: mediaDirectories.filter((directory) => typeof directory === 'string' && directory.trim()),
  };
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function loadConfig(projectRoot, userDataRoot, options = {}) {
  const defaultPath = path.join(projectRoot, 'config', 'default.json');
  const dataRoot = process.env.STAGEPILOT_DATA_DIR || path.join(userDataRoot, 'stagepilot');
  const userConfigPath = path.join(dataRoot, 'config.json');
  const tokenPath = path.join(dataRoot, 'pairing-token.txt');

  ensureDirectory(dataRoot);
  const defaults = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
  if (options.defaultMediaDirectory) {
    defaults.mediaDirectories = [options.defaultMediaDirectory];
  }
  let overrides = {};
  let configWarning = null;
  if (fs.existsSync(userConfigPath)) {
    try {
      overrides = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
    } catch {
      configWarning = '用户配置文件格式损坏，已使用安全默认值；原文件未被覆盖';
    }
  } else {
    writeJsonAtomic(userConfigPath, defaults);
  }

  let token;
  if (fs.existsSync(tokenPath)) {
    token = fs.readFileSync(tokenPath, 'utf8').trim();
  }
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    fs.writeFileSync(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  const config = normalizeConfig(defaults, overrides);

  config.mediaDirectories = config.mediaDirectories.map((directory) =>
    path.resolve(projectRoot, directory)
  );

  return { config, token, tokenPath, dataRoot, userConfigPath, configWarning };
}

function saveConfig(userConfigPath, config) {
  const serializable = {
    port: config.port,
    transitionMs: config.transitionMs,
    programs: config.programs,
    mediaDirectories: config.mediaDirectories,
  };
  writeJsonAtomic(userConfigPath, serializable);
}

function rotateToken(bundle) {
  const token = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(bundle.tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  bundle.token = token;
  return token;
}

module.exports = { loadConfig, normalizeConfig, rotateToken, saveConfig };
