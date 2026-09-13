/* 图标生成：SVG → 多尺寸 PNG → ICO
   用法：electron assets/icons/make-icon.js
   设计：圆角方牌 + 声波竖条（中间高两侧低），与小尺寸下的可读性兼顾 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/* 7 根竖条，形成声波轮廓；中间最高，两侧递减但不对称，看着更自然 */
const BARS = [0.30, 0.56, 0.86, 1.00, 0.74, 0.46, 0.26];

function svg(size) {
  const S = 256;                 // 内部统一按 256 画，再缩放
  const pad = 40;                // 圆角方牌内边距
  const W = S - pad * 2;
  const bw = W / (BARS.length * 2 - 1);   // 条宽
  const gap = bw;
  const cy = S / 2;
  const maxH = W * 0.78;

  let bars = '';
  BARS.forEach((f, i) => {
    const h = Math.max(bw, maxH * f);
    const x = pad + i * (bw + gap);
    const y = cy - h / 2;
    bars += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" `
          + `height="${h.toFixed(2)}" rx="${(bw / 2).toFixed(2)}" fill="#fff"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#4f8ef7"/>
      <stop offset="0.55" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#1a3fb8"/>
    </linearGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${S}" height="${S}" rx="58" fill="url(#g)"/>
  <rect x="0" y="0" width="${S}" height="${S}" rx="58" fill="url(#s)"/>
  ${bars}
</svg>`;
}

/* ICO 容器：把多个 PNG 打成一个 .ico（格式：ICONDIR + 目录项 + PNG 数据） */
function buildIco(pngs) {
  const n = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type = icon
  header.writeUInt16LE(n, 4);      // count
  const dir = Buffer.alloc(16 * n);
  let offset = 6 + 16 * n;
  const blobs = [];
  pngs.forEach((p, i) => {
    const o = i * 16;
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o + 0);   // 256 记作 0
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(p.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += p.data.length;
    blobs.push(p.data);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 300, height: 300, show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  });

  const pngs = [];
  for (const size of SIZES) {
    const html = `<!doctype html><html><body style="margin:0;background:transparent">
      ${svg(size)}</body></html>`;
    const tmp = path.join(OUT, `_tmp-${size}.html`);
    fs.writeFileSync(tmp, html, 'utf8');
    await win.loadFile(tmp);
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    const buf = img.toPNG();
    pngs.push({ size, data: buf });
    fs.writeFileSync(path.join(OUT, `app-icon-${size}.png`), buf);
    fs.rmSync(tmp, { force: true });
    console.log(`  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
  }

  fs.writeFileSync(path.join(OUT, 'app-icon.ico'), buildIco(pngs));
  // 主 PNG 用 256 那张
  fs.writeFileSync(path.join(OUT, 'app-icon.png'), pngs[pngs.length - 1].data);
  console.log('app-icon.ico 与 app-icon.png 已生成');
  app.exit(0);
});
