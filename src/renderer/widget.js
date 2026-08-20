'use strict';

const api = window.widgetApi;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 300;
const SECONDARY_SCALE = 0.34;
const BG_SCHEME = 'widget-bg'; // custom protocol served by the main process

const card = document.getElementById('card');
const content = document.querySelector('.content');
const sizer = document.getElementById('sizer');
const gear = document.getElementById('gear');
const pin = document.getElementById('pin');
const grip = document.getElementById('grip');
const bgImage = document.getElementById('bgImage');
const scrim = document.getElementById('scrim');
const el = {
  city: document.getElementById('city'),
  time: document.getElementById('time'),
  meridiem: document.getElementById('meridiem'),
  date: document.getElementById('date'),
  zone: document.getElementById('zone'),
};

let widget = null;
let timer = null;

/* ---------------- color helpers ---------------- */

function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return `rgba(255, 255, 255, ${alpha})`;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* ---------------- deterministic sizing ---------------- */
//
// Two widgets with the same Size must be the same size, so the card width is derived from
// worst-case reference text instead of whatever the clock happens to read right now.
// Otherwise "Daegu / Wednesday, August 19" and "Vancouver / Tuesday, August 18" produce
// different boxes at identical settings. The city line is clipped rather than measured,
// because city names vary far too much in length.

function measureText(text, family, px, weight, spacing, tabular) {
  sizer.style.fontFamily = family;
  sizer.style.fontSize = `${px}px`;
  sizer.style.fontWeight = String(weight);
  sizer.style.letterSpacing = spacing || 'normal';
  sizer.style.fontVariantNumeric = tabular ? 'tabular-nums' : 'normal';
  sizer.textContent = text;
  return sizer.getBoundingClientRect().width;
}

// Widest weekday and month name for the locale, measured once per font.
let widestNames = null;
let widestNamesKey = '';

function widestNamesFor(family) {
  if (widestNamesKey === family && widestNames) return widestNames;
  const widest = (list) =>
    list.reduce(
      (best, name) => {
        const w = measureText(name, family, 200, 400);
        return w > best.w ? { w, name } : best;
      },
      { w: -1, name: '' }
    ).name;

  const weekday = widest(
    Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(LOCALE, { weekday: 'long', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2026, 0, 4 + i))
      )
    )
  );
  const month = widest(
    Array.from({ length: 12 }, (_, m) =>
      new Intl.DateTimeFormat(LOCALE, { month: 'long', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2026, m, 15))
      )
    )
  );
  widestNames = { weekday, month };
  widestNamesKey = family;
  return widestNames;
}

// Longest date the current format can ever produce, built by swapping the widest names
// and all-8 numbers into the locale pattern, so it stays correct if the format changes.
function worstCaseDate(family, timeZone) {
  const { weekday, month } = widestNamesFor(family);
  const parts = new Intl.DateTimeFormat(LOCALE, { timeZone, dateStyle: DATE_STYLE }).formatToParts(
    new Date()
  );
  return parts
    .map((part) => {
      if (part.type === 'weekday') return weekday;
      if (part.type === 'month') return /^d+$/.test(part.value) ? '88' : month;
      if (part.type === 'day') return '88';
      if (part.type === 'year') return '8888';
      return part.value;
    })
    .join('');
}

// Longest city name in the curated list, measured once per font. Reserving a constant
// keeps every widget the same width instead of letting the chosen name decide it.
let widestLabel = null;
let widestLabelKey = '';

function widestLabelFor(family) {
  if (widestLabelKey === family && widestLabel !== null) return widestLabel;
  let best = '';
  let bestWidth = -1;
  const table = typeof CITIES !== 'undefined' ? CITIES : [];
  for (const [, city] of table) {
    const text = city;
    const w = measureText(text, family, 200, 600, '0.04em');
    if (w > bestWidth) {
      bestWidth = w;
      best = text;
    }
  }
  widestLabel = best;
  widestLabelKey = family;
  return widestLabel;
}

/** Width the content box needs, independent of the city, the date and the zone shown. */
function contentWidth(w) {
  const s = w.style;
  const d = w.display;
  const family = s.fontFamily;
  const sub = Math.max(9, Math.round(s.fontSize * SECONDARY_SCALE));

  // Digits are tabular, so any all-8 string of the right shape measures the true maximum.
  let width = measureText(d.showSeconds ? '88:88:88' : '88:88', family, s.fontSize, 600, '-0.01em', true);
  if (d.hour12) width += sub * 0.35 + measureText('PM', family, sub, 600);

  if (d.showDate) {
    width = Math.max(width, measureText(worstCaseDate(family, w.timeZone), family, sub, 400));
  }
  if (d.showCity) {
    const ref = widestLabelFor(family);
    if (ref) width = Math.max(width, measureText(ref, family, sub, 600, '0.04em'));
  }
  if (d.showZone) {
    // Five-letter abbreviation plus the widest offset covers every IANA zone.
    width = Math.max(width, measureText('MMMMM · UTC+88:88', family, sub * 0.86, 400));
  }
  return Math.ceil(width);
}

/* ---------------- style ---------------- */

function applyStyle(w) {
  const s = w.style;
  const root = card.style;
  const sub = Math.max(9, Math.round(s.fontSize * SECONDARY_SCALE));

  root.setProperty('--size', `${s.fontSize}px`);
  root.setProperty('--sub-size', `${sub}px`);
  root.setProperty('--font', s.fontFamily);
  root.setProperty('--fg', s.textColor);
  root.setProperty('--sub', hexToRgba(s.textColor, 0.78));
  root.setProperty('--tool-dim', hexToRgba(s.textColor, 0.45));
  root.setProperty('--bg', s.bgColor);
  content.style.width = `${contentWidth(w)}px`;

  const src = s.bgImage ? `${BG_SCHEME}://image/${encodeURIComponent(s.bgImage)}` : '';
  if (src) {
    if (bgImage.getAttribute('src') !== src) bgImage.setAttribute('src', src);
    bgImage.hidden = false;
    scrim.hidden = false;
  } else {
    bgImage.removeAttribute('src');
    bgImage.hidden = true;
    scrim.hidden = true;
  }

  card.classList.toggle('locked', !!w.behavior.locked);
}

/* ---------------- render ---------------- */

function paint() {
  if (!widget) return;
  const m = renderModel(new Date(), widget);
  const d = widget.display;

  el.city.textContent = d.showCity ? m.city : '';
  el.time.textContent = m.time;
  el.meridiem.textContent = d.hour12 ? m.meridiem : '';
  el.date.textContent = d.showDate ? m.dateText : '';
  el.zone.textContent = d.showZone ? m.zoneText : '';
}

// Re-arm on the next second (or minute) boundary so the clock never drifts.
function scheduleTick() {
  clearTimeout(timer);
  const now = Date.now();
  const step = widget && widget.display.showSeconds ? 1000 : 60000;
  const wait = step - (now % step) + 15;
  timer = setTimeout(() => {
    paint();
    scheduleTick();
  }, wait);
}

/* ---------------- auto-fit the window to the content ---------------- */

let lastSize = '';
function reportSize() {
  const r = card.getBoundingClientRect();
  const w = Math.ceil(r.width);
  const h = Math.ceil(r.height);
  const key = `${w}x${h}`;
  if (key === lastSize || w < 2 || h < 2) return;
  lastSize = key;
  api.reportSize({ width: w, height: h });
}

new ResizeObserver(reportSize).observe(card);

/* ---------------- input ---------------- */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let drag = null; // move
let resize = null; // scale via the corner grip

card.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !widget || widget.behavior.locked) return;
  drag = { sx: e.screenX, sy: e.screenY };
  api.dragStart();
  e.preventDefault();
});

grip.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !widget || widget.behavior.locked) return;
  e.stopPropagation(); // do not start a move drag
  e.preventDefault();
  const r = card.getBoundingClientRect();
  resize = { sx: e.screenX, sy: e.screenY, w: r.width, h: r.height, size: widget.style.fontSize };
  card.classList.add('resizing');
});

window.addEventListener('mousemove', (e) => {
  if (resize) {
    // Scale the font, and the window auto-fits to the new content size.
    const rw = (resize.w + (e.screenX - resize.sx)) / resize.w;
    const rh = (resize.h + (e.screenY - resize.sy)) / resize.h;
    const next = clamp(Math.round(resize.size * ((rw + rh) / 2)), MIN_FONT_SIZE, MAX_FONT_SIZE);
    if (next !== widget.style.fontSize) {
      widget.style.fontSize = next;
      applyStyle(widget);
    }
    return;
  }
  if (drag) api.dragMove(e.screenX - drag.sx, e.screenY - drag.sy);
});

window.addEventListener('mouseup', () => {
  if (resize) {
    card.classList.remove('resizing');
    const size = widget.style.fontSize;
    resize = null;
    api.update({ style: { fontSize: size } }); // save once, at the end of the drag
  }
  if (drag) {
    drag = null;
    api.dragEnd();
  }
});

for (const btn of [gear, pin]) {
  btn.addEventListener('mousedown', (e) => e.stopPropagation());
}

gear.addEventListener('click', (e) => {
  e.stopPropagation();
  api.openSettings();
});

pin.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!widget) return;
  const next = !widget.behavior.locked;
  widget.behavior.locked = next;
  card.classList.toggle('locked', next);
  api.update({ behavior: { locked: next } });
});

card.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.openContextMenu();
});

card.addEventListener('dblclick', () => api.openSettings());

/* ---------------- state sync ---------------- */

function applyConfig(config) {
  const next = (config.widgets || []).find((w) => w.id === api.id);
  if (!next) return;
  if (resize) return; // do not fight an in-progress resize
  widget = next;
  applyStyle(widget);
  paint();
  scheduleTick();
  requestAnimationFrame(reportSize);
}

api.getState().then(({ config }) => applyConfig(config));
api.onState(applyConfig);

// A late-loading font or image changes the measured size, so report again once settled.
document.fonts?.ready.then(() => requestAnimationFrame(reportSize));
bgImage.addEventListener('load', () => requestAnimationFrame(reportSize));
