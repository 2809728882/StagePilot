const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.mpeg', '.mpg',
]);

function mediaId(filePath) {
  return crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 20);
}

function scanMedia(directories) {
  const files = [];
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(extension)) continue;
      const filePath = path.join(directory, entry.name);
      files.push({
        id: mediaId(filePath),
        name: path.basename(entry.name, extension),
        fileName: entry.name,
        path: filePath,
      });
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

module.exports = { scanMedia };
