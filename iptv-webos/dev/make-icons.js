// Generates app/icon.png (80x80) and app/largeIcon.png (130x130) with no dependencies.
// Draws a rounded blue tile with a white "play" triangle.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function icon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r = size * 0.2;
  // triangle
  const ax = size * 0.38, ay = size * 0.28, bx = size * 0.38, by = size * 0.72, cx = size * 0.74, cy = size * 0.5;
  const sign = (px, py, x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      // rounded-rect alpha
      const dx = Math.max(r - x - 0.5, 0, x + 0.5 - (size - r));
      const dy = Math.max(r - y - 0.5, 0, y + 0.5 - (size - r));
      const inside = Math.sqrt(dx * dx + dy * dy) <= r;
      const px = x + 0.5, py = y + 0.5;
      const d1 = sign(px, py, ax, ay, bx, by), d2 = sign(px, py, bx, by, cx, cy), d3 = sign(px, py, cx, cy, ax, ay);
      const tri = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
      const t = y / size;
      const col = tri ? [255, 255, 255] : [Math.round(30 + 20 * t), Math.round(140 - 40 * t), Math.round(240 - 60 * t)];
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; raw[o + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const appDir = path.join(__dirname, '..', 'app');
fs.writeFileSync(path.join(appDir, 'icon.png'), icon(80));
fs.writeFileSync(path.join(appDir, 'largeIcon.png'), icon(130));
console.log('icons written');
