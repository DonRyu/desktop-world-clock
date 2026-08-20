'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { CITIES, zoneCity } = require('../renderer/cities.js');
const CONFIG_VERSION = 10;

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 300;

function systemZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Default Name for a zone: the city alone. The widget adds the continent and country when
 * it draws the subtitle, so this stays short and stays editable.
 */
function cityFromZone(tz) {
  const entry = CITIES.find(([zone]) => zone === tz);
  return entry ? entry[1] : zoneCity(tz);
}

function defaultWidget(tz) {
  const zone = tz || systemZone();
  return {
    id: crypto.randomUUID(),
    label: cityFromZone(zone), // the Name, free text
    city: cityFromZone(zone), // what was picked; drives the settings labels only
    timeZone: zone,
    bounds: null, // { x, y } - placed automatically on first run
    style: {
      fontFamily: "'Segoe UI', 'Malgun Gothic', sans-serif",
      fontSize: 46,
      textColor: '#ffffff',
      bgColor: '#0f1420',
      bgImage: '', // file name inside userData/backgrounds, empty for a plain color
    },
    display: {
      hour12: false,
      showSeconds: true,
      showCity: true,
      showDate: true,
      showZone: true, // time zone / UTC offset line (already reflects DST)
    },
    behavior: {
      visible: true, // shown on the desktop
      locked: false, // pinned: cannot be moved or resized, and stays above other windows
      opacity: 1, // whole-window alpha
    },
  };
}

function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    general: { startWithWindows: false },
    widgets: [defaultWidget(systemZone())],
  };
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function pick(target, source, keys) {
  for (const k of keys) if (source && source[k] !== undefined) target[k] = source[k];
  return target;
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const HANGUL = /[ㄱ-ㆎ가-힣]/;

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'config.json');
    this._needsWrite = false;
    this.data = this._read();
    // Persist a migrated or freshly created config right away instead of waiting
    // for the first edit.
    if (this._needsWrite) this.save();
  }

  _read() {
    try {
      // Strip a UTF-8 BOM; JSON.parse rejects it and the config would silently reset.
      const raw = fs.readFileSync(this.file, 'utf8').replace(/^﻿/, '');
      const parsed = JSON.parse(raw);
      this._needsWrite = Number(parsed.version) !== CONFIG_VERSION;
      return this._migrate(parsed);
    } catch {
      this._needsWrite = true;
      return defaultConfig();
    }
  }

  // Rebuild every widget from the current schema, keeping only the keys that still
  // exist. Anything a newer version dropped is discarded rather than carried along.
  _migrate(parsed) {
    const base = defaultConfig();
    const fromVersion = Number(parsed.version) || 1;
    const cfg = {
      version: CONFIG_VERSION,
      general: { ...base.general, ...(parsed.general || {}) },
      widgets: [],
    };

    for (const w of Array.isArray(parsed.widgets) ? parsed.widgets : []) {
      const d = defaultWidget(w.timeZone || systemZone());
      if (w.id) d.id = w.id;
      // An empty Name is a deliberate choice - the widget then draws no city line - so it
      // must survive a reload rather than being refilled with the default.
      if (typeof w.label === 'string') d.label = w.label;
      if (typeof w.city === 'string' && w.city.trim()) d.city = w.city;
      if (isObject(w.bounds)) d.bounds = { x: Number(w.bounds.x) || 0, y: Number(w.bounds.y) || 0 };

      pick(d.style, w.style, ['fontFamily', 'fontSize', 'textColor', 'bgColor', 'bgImage']);
      pick(d.display, w.display, ['hour12', 'showSeconds', 'showCity', 'showDate', 'showZone']);
      pick(d.behavior, w.behavior, ['visible', 'locked', 'opacity']);

      d.style.fontSize = clampNumber(d.style.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, 46);
      d.behavior.opacity = clampNumber(d.behavior.opacity, 0.1, 1, 1);

      // v1 -> v2: the Korean defaults predate the English-only UI.
      if (fromVersion < 2 && HANGUL.test(d.label)) d.label = cityFromZone(d.timeZone);

      // v6 -> v7: strip the continent v6 baked into the label; it is presentation now.
      if (fromVersion === 6) {
        const prefix = `${d.timeZone.split('/')[0]}/`;
        if (d.label.startsWith(prefix)) d.label = d.label.slice(prefix.length);
      }

      // -> v9: v8 baked Continent/Country into the label. Keep only the last segment,
      // which is the city, so the Name box holds a plain name again.
      if (fromVersion === 8 && d.label.includes('/')) {
        d.label = d.label.split('/').pop().trim();
      }

      // -> v10: before the split there was only the label. If it still matches a city in
      // the table it was the picked one; if the user had already renamed the widget the
      // original choice is unrecoverable, so fall back to the zone's own city.
      if (fromVersion < 10) {
        const picked = CITIES.find(([zone, city]) => zone === d.timeZone && city === d.label);
        d.city = picked ? picked[1] : zoneCity(d.timeZone);
      }

      cfg.widgets.push(d);
    }

    if (!cfg.widgets.length) cfg.widgets = base.widgets;
    return cfg;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[store] failed to save config:', err);
    }
  }

  get config() {
    return this.data;
  }

  get widgets() {
    return this.data.widgets;
  }

  find(id) {
    return this.data.widgets.find((w) => w.id === id) || null;
  }

  add(tz) {
    const w = defaultWidget(tz);
    this.data.widgets.push(w);
    this.save();
    return w;
  }

  duplicate(id) {
    const src = this.find(id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = crypto.randomUUID();
    copy.bounds = src.bounds ? { x: src.bounds.x + 28, y: src.bounds.y + 28 } : null;
    this.data.widgets.push(copy);
    this.save();
    return copy;
  }

  update(id, patch) {
    const idx = this.data.widgets.findIndex((w) => w.id === id);
    if (idx < 0) return null;
    const next = deepMerge(this.data.widgets[idx], patch);
    next.style.fontSize = clampNumber(next.style.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, 46);
    next.behavior.opacity = clampNumber(next.behavior.opacity, 0.1, 1, 1);
    this.data.widgets[idx] = next;
    this.save();
    return next;
  }

  remove(id) {
    const before = this.data.widgets.length;
    this.data.widgets = this.data.widgets.filter((w) => w.id !== id);
    const changed = this.data.widgets.length !== before;
    if (changed) this.save();
    return changed;
  }

  updateGeneral(patch) {
    this.data.general = { ...this.data.general, ...patch };
    this.save();
    return this.data.general;
  }
}

module.exports = {
  Store,
  defaultWidget,
  cityFromZone,
  systemZone,
  deepMerge,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
};
