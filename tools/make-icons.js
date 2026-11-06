'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'icons');

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function writePng(file, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

function render(size) {
  const S = 4;
  const N = size * S;
  const px = Buffer.alloc(N * N * 4);
  const set = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const o = (y * N + x) * 4;
    px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
  };

  function fill(x0, y0, w, h, rgb) {
    x0 = Math.round(x0 * S); y0 = Math.round(y0 * S);
    w = Math.round(w * S); h = Math.round(h * S);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, rgb);
  }

  function roundRect(x0, y0, w, h, r, rgb) {
    x0 = Math.round(x0 * S); y0 = Math.round(y0 * S);
    w = Math.round(w * S); h = Math.round(h * S); r = Math.round(r * S);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let dx = 0, dy = 0;
        if (x < r) dx = r - x; else if (x > w - 1 - r) dx = x - (w - 1 - r);
        if (y < r) dy = r - y; else if (y > h - 1 - r) dy = y - (h - 1 - r);
        if (dx * dx + dy * dy <= r * r) set(x0 + x, y0 + y, rgb);
      }
    }
  }

  const cream = hexRgb('#f6efe2');
  const paper = hexRgb('#f3eadb');
  const dark = hexRgb('#2b2621');
  const cellEmpty = hexRgb('#f4ead8');
  const cellWall = hexRgb('#171411');
  const coral = hexRgb('#ef6f6c');
  const teal = hexRgb('#43aa8b');
  const yellow = hexRgb('#f4c95d');
  const blue = hexRgb('#4361ee');

  fill(0, 0, size, size, paper);
  // 顶部柔和色块
  roundRect(size * 0.08, size * 0.06, size * 0.84, size * 0.88, size * 0.075, dark);

  const boardX = size * 0.135;
  const boardY = size * 0.115;
  const boardW = size * 0.73;
  const boardH = size * 0.77;
  roundRect(boardX, boardY, boardW, boardH, size * 0.05, hexRgb('#3b342d'));

  const pad = size * 0.032;
  const gap = size * 0.012;
  const innerW = boardW - pad * 2;
  const innerH = boardH - pad * 2;
  const cw = (innerW - gap * 6) / 7;
  const ch = (innerH - gap * 7) / 8;
  const x0 = boardX + pad;
  const y0 = boardY + pad;

  const walls = ['0,6', '1,6', '7,0', '7,1', '7,2', '7,3'];
  const coralCells = ['2,0', '3,0', '4,0', '3,1'];
  const tealCells = ['4,2', '4,3', '5,3', '5,4'];
  const yellowCells = ['6,5', '6,6', '7,5', '7,6'];
  const targets = ['0,3', '3,2', '6,4'];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 7; c++) {
      const key = r + ',' + c;
      let color = cellEmpty;
      if (walls.indexOf(key) >= 0) color = cellWall;
      else if (targets.indexOf(key) >= 0) color = cream;
      else if (coralCells.indexOf(key) >= 0) color = coral;
      else if (tealCells.indexOf(key) >= 0) color = teal;
      else if (yellowCells.indexOf(key) >= 0) color = yellow;
      else if (r === 5 && c === 0) color = blue;
      const x = x0 + c * (cw + gap);
      const y = y0 + r * (ch + gap);
      roundRect(x, y, cw, ch, size * 0.012, color);
    }
  }

  // 目标格的强调点
  for (const t of targets) {
    const [r, c] = t.split(',').map(Number);
    const x = x0 + c * (cw + gap) + cw * 0.28;
    const y = y0 + r * (ch + gap) + ch * 0.28;
    roundRect(x, y, cw * 0.44, ch * 0.44, size * 0.006, hexRgb('#b9aa95'));
  }

  // 缩采样
  const out = Buffer.alloc(size * size * 4);
  const ss = S * S;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sums = [0, 0, 0, 0];
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const o = ((y * S + dy) * N + (x * S + dx)) * 4;
          sums[0] += px[o]; sums[1] += px[o + 1]; sums[2] += px[o + 2]; sums[3] += px[o + 3];
        }
      }
      const o2 = (y * size + x) * 4;
      out[o2] = sums[0] / ss; out[o2 + 1] = sums[1] / ss;
      out[o2 + 2] = sums[2] / ss; out[o2 + 3] = sums[3] / ss;
    }
  }
  return out;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const rgba = render(size);
  writePng(path.join(OUT_DIR, 'icon-' + size + '.png'), size, size, rgba);
  console.log('icon-' + size + '.png');
}
