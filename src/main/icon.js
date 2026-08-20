'use strict';
// Tray and window icons are drawn in code so no binary image file has to be committed.
// A minimal PNG encoder plus a tiny rasterizer is all that is needed.

// electron is required lazily so build scripts can reuse drawClock() under plain node.
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- widget-shaped icon rasterizer (4x4 supersampling) ---
//
// The icon mirrors the app itself: a rounded dark card with "WORLD" above a digital time,
// no border. Everything is a signed distance function, so it stays crisp at every size the
// .ico needs, from 16 px in the tray to 256 px in Explorer.

const CARD_BG = [15, 20, 32]; // #0F1420
const LABEL = [77, 163, 255]; // #4DA3FF
const DIGIT = [255, 255, 255];

const LABEL_TEXT = 'WORLD';

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Negative inside, positive outside.
function roundRectDist(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

/* ---------------- seven-segment digits ---------------- */

const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const DIGIT_SEGMENTS = {
  0: 'abcdef',
  1: 'bc',
  2: 'abdeg',
  3: 'abcdg',
  4: 'bcfg',
  5: 'acdfg',
  6: 'acdefg',
  7: 'abc',
  8: 'abcdefg',
  9: 'abcdfg',
};

function segmentLine(seg, x, y, w, h) {
  const mid = y + h / 2;
  switch (seg) {
    case 'a': return [x, y, x + w, y];
    case 'b': return [x + w, y, x + w, mid];
    case 'c': return [x + w, mid, x + w, y + h];
    case 'd': return [x, y + h, x + w, y + h];
    case 'e': return [x, mid, x, y + h];
    case 'f': return [x, y, x, mid];
    default:  return [x, mid, x + w, mid]; // g
  }
}

/* ---------------- minimal stroke font for the label ---------------- */
//
// Only the capitals in LABEL_TEXT are defined. Each glyph is a list of polylines in a unit
// box (0,0 top-left to 1,1 bottom-right); curves are approximated with short segments,
// which is plenty at label size.

const GLYPHS = {
  W: [[[0, 0], [0.22, 1], [0.5, 0.32], [0.78, 1], [1, 0]]],
  O: [
    [
      [0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1],
      [0.3, 1], [0, 0.7], [0, 0.3], [0.3, 0],
    ],
  ],
  R: [
    [[0, 1], [0, 0], [0.7, 0], [1, 0.24], [0.7, 0.48], [0, 0.48]],
    [[0.5, 0.48], [1, 1]],
  ],
  L: [[[0, 0], [0, 1], [1, 1]]],
  D: [[[0, 0], [0.6, 0], [1, 0.32], [1, 0.68], [0.6, 1], [0, 1], [0, 0]]],
};

// Relative advance widths so W does not get the same slot as L.
const GLYPH_WIDTH = { W: 1.3, O: 1, R: 0.95, L: 0.8, D: 1 };

/** Turns the label into absolute line segments inside the given box. */
function labelLines(text, x, y, maxW, h, tracking) {
  const units = [...text].reduce((sum, ch) => sum + (GLYPH_WIDTH[ch] || 1), 0);
  const scale = (maxW - (text.length - 1) * tracking) / units;

  const lines = [];
  let cx = x;
  for (const ch of text) {
    const w = (GLYPH_WIDTH[ch] || 1) * scale;
    for (const poly of GLYPHS[ch] || []) {
      for (let i = 0; i < poly.length - 1; i++) {
        lines.push([
          cx + poly[i][0] * w,
          y + poly[i][1] * h,
          cx + poly[i + 1][0] * w,
          y + poly[i + 1][1] * h,
        ]);
      }
    }
    cx += w + tracking;
  }
  return lines;
}

/* ---------------- layout ---------------- */

/**
 * Three tiers of detail. Below 40 px there is no room for four digits, and the label needs
 * at least 64 px to stay legible, so small sizes show just "12".
 */
function buildShapes(size) {
  const u = (v) => v * size;
  const compact = size < 40;
  const tiny = size < 20;
  const withLabel = size >= 64;

  const card = {
    cx: u(0.5),
    cy: u(0.5),
    hw: u(compact ? 0.47 : 0.46),
    hh: u(compact ? 0.36 : 0.35),
    r: u(compact ? 0.1 : 0.12),
  };

  const digits = [];
  const dots = [];
  const thickness = tiny ? 1 : Math.max(1, u(compact ? 0.062 : 0.038));

  // A seven-segment "1" only lights the right-hand strokes, so its cell shifts left by
  // half a width to keep the spacing even.
  const push = (d, x, y, w, h) => digits.push({ d, x: x + (d === 1 ? -w / 2 : 0), y, w, h });

  if (compact) {
    const dw = u(tiny ? 0.2 : 0.25);
    const dh = u(tiny ? 0.34 : 0.4);
    const gap = u(tiny ? 0.14 : 0.1);
    let x = card.cx - (dw * 2 + gap) / 2;
    const y = card.cy - dh / 2;
    for (const d of [1, 2]) {
      push(d, x, y, dw, dh);
      x += dw + gap;
    }
  } else {
    const dw = u(0.15);
    const dh = u(withLabel ? 0.28 : 0.34);
    const pairGap = u(0.05);
    const colonGap = u(0.055);
    const colonW = u(0.03);
    const total = dw * 4 + pairGap * 2 + colonGap * 2 + colonW;
    let x = card.cx - total / 2;
    // With a label above, the time sits a little lower in the card.
    const y = card.cy - dh / 2 + u(withLabel ? 0.075 : 0);

    for (const d of [1, 2]) {
      push(d, x, y, dw, dh);
      x += dw + pairGap;
    }
    x += colonGap - pairGap;
    const colonX = x + colonW / 2;
    const colonR = thickness * 0.6;
    dots.push({ x: colonX, y: y + dh * 0.3, r: colonR });
    dots.push({ x: colonX, y: y + dh * 0.7, r: colonR });
    x += colonW + colonGap;

    for (const d of [0, 0]) {
      push(d, x, y, dw, dh);
      x += dw + pairGap;
    }
  }

  // Left edge of the actual digit ink, so the label lines up with the "1" rather than
  // with the empty half of its seven-segment cell.
  let inkLeft = Infinity;
  for (const g of digits) {
    const lit = DIGIT_SEGMENTS[g.d];
    const usesLeftEdge = /[adefg]/.test(lit);
    inkLeft = Math.min(inkLeft, usesLeftEdge ? g.x : g.x + g.w);
  }

  const label = withLabel
    ? {
        lines: labelLines(LABEL_TEXT, inkLeft, card.cy - u(0.245), u(0.44), u(0.1), u(0.024)),
        thickness: Math.max(1, u(0.019)),
      }
    : null;

  return { card, digits, dots, label, thickness };
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const { card, digits, dots, label, thickness } = buildShapes(size);
  const half = thickness / 2;

  const digitLines = [];
  for (const g of digits) {
    for (const seg of SEGMENTS) {
      if (DIGIT_SEGMENTS[g.d].includes(seg)) digitLines.push(segmentLine(seg, g.x, g.y, g.w, g.h));
    }
  }
  const labelHalf = label ? label.thickness / 2 : 0;

  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0, ag = 0, ab = 0, covered = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          if (roundRectDist(px, py, card.cx, card.cy, card.hw, card.hh, card.r) > 0) continue;

          let col = CARD_BG;
          for (const [ax, ay, bx, by] of digitLines) {
            if (segDist(px, py, ax, ay, bx, by) <= half) { col = DIGIT; break; }
          }
          if (col === CARD_BG) {
            for (const d of dots) {
              if (Math.hypot(px - d.x, py - d.y) <= d.r) { col = DIGIT; break; }
            }
          }
          if (col === CARD_BG && label) {
            for (const [ax, ay, bx, by] of label.lines) {
              if (segDist(px, py, ax, ay, bx, by) <= labelHalf) { col = LABEL; break; }
            }
          }

          ar += col[0];
          ag += col[1];
          ab += col[2];
          covered++;
        }
      }

      if (!covered) continue;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(ar / covered);
      rgba[i + 1] = Math.round(ag / covered);
      rgba[i + 2] = Math.round(ab / covered);
      rgba[i + 3] = Math.round((covered / (SS * SS)) * 255);
    }
  }

  return encodePng(size, size, rgba);
}

let cached = null;

function appIcon() {
  const { nativeImage } = require('electron');
  if (!cached) {
    const img = nativeImage.createFromBuffer(drawIcon(64));
    img.addRepresentation({ scaleFactor: 2, buffer: drawIcon(128) });
    cached = img;
  }
  return cached;
}

function trayIcon() {
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromBuffer(drawIcon(16));
  img.addRepresentation({ scaleFactor: 2, buffer: drawIcon(32) });
  return img;
}

module.exports = { appIcon, trayIcon, drawIcon };
