const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function createIco(images) {
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = headerSize;
  images.forEach(({ size, buffer }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(buffer.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += buffer.length;
  });

  return Buffer.concat([header, ...images.map(({ buffer }) => buffer)]);
}

app.whenReady().then(() => {
  const root = path.resolve(__dirname, '..');
  const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'));
  const window = new BrowserWindow({ width: 512, height: 512, frame: false, transparent: true, show: false });
  const svgData = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  return window.loadURL('data:text/html,<meta charset="utf-8">')
    .then(() => window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const render = (size) => {
          const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
          canvas.getContext('2d').drawImage(image, 0, 0, size, size);
          return canvas.toDataURL('image/png').split(',')[1];
        };
        resolve({
          png: render(512),
          ico: ${JSON.stringify(ICO_SIZES)}.map((size) => ({ size, data: render(size) }))
        });
      };
      image.onerror = () => reject(new Error('SVG render failed'));
      image.src = ${JSON.stringify(svgData)};
    })`))
    .then(({ png, ico }) => {
      fs.writeFileSync(path.join(root, 'assets', 'icon.png'), Buffer.from(png, 'base64'));
      fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), createIco(
        ico.map(({ size, data }) => ({ size, buffer: Buffer.from(data, 'base64') }))
      ));
    });
}).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => app.quit());
