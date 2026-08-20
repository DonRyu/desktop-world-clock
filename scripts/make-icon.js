'use strict';
/*
 * Builds build/icon.ico from the same clock drawing the tray uses, so the
 * installer, the .exe and the taskbar entry all match the tray icon.
 *
 * The .ico embeds PNG-compressed images, which Windows has supported since Vista
 * and which electron-builder and NSIS both accept.
 *
 *   node scripts/make-icon.js
 */

const fs = require('fs');
const path = require('path');
const { drawIcon } = require('../src/main/icon.js');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const OUT = path.join(__dirname, '..', 'build', 'icon.ico');

const images = SIZES.map((size) => ({ size, png: drawIcon(size) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(images.length, 4);

const DIR_ENTRY = 16;
let offset = header.length + images.length * DIR_ENTRY;

const entries = images.map(({ size, png }) => {
  const e = Buffer.alloc(DIR_ENTRY);
  e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
  e.writeUInt8(size >= 256 ? 0 : size, 1);
  e.writeUInt8(0, 2); // palette colours
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, ...entries, ...images.map((i) => i.png)]));

console.log(
  `wrote ${path.relative(process.cwd(), OUT)} ` +
    `(${SIZES.join(', ')} px, ${(fs.statSync(OUT).size / 1024).toFixed(1)} kB)`
);

/* ------------------------------------------------------------------ */
/* Microsoft Store tiles                                               */
/* ------------------------------------------------------------------ */
//
// electron-builder's appx target reads these four from build/appx. All are required.

const { drawTile } = require('../src/main/icon.js');

const TILES = [
  ['StoreLogo.png', 50, 50],
  ['Square150x150Logo.png', 150, 150],
  ['Square44x44Logo.png', 44, 44],
  ['Wide310x150Logo.png', 310, 150],
];

const APPX_DIR = path.join(__dirname, '..', 'build', 'appx');
fs.mkdirSync(APPX_DIR, { recursive: true });

for (const [name, w, h] of TILES) {
  fs.writeFileSync(path.join(APPX_DIR, name), drawTile(w, h));
  console.log(`wrote build/appx/${name} (${w}x${h})`);
}
