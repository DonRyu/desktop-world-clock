'use strict';

const api = window.settingsApi;
const BG_SCHEME = 'widget-bg';

// The city table lives in cities.js, shared with the main process.

const FONTS = [
  ["'Segoe UI', 'Malgun Gothic', sans-serif", 'Segoe UI'],
  ["'Segoe UI Light', 'Segoe UI', sans-serif", 'Segoe UI Light'],
  ["'Malgun Gothic', sans-serif", 'Malgun Gothic'],
  ["'Consolas', monospace", 'Consolas (monospace)'],
  ["'Cascadia Mono', 'Consolas', monospace", 'Cascadia Mono'],
  ["'Courier New', monospace", 'Courier New'],
  ["'Georgia', serif", 'Georgia'],
  ["'Times New Roman', serif", 'Times New Roman'],
  ["'Arial', sans-serif", 'Arial'],
  ["'Tahoma', sans-serif", 'Tahoma'],
  ["'Verdana', sans-serif", 'Verdana'],
  ["'Trebuchet MS', sans-serif", 'Trebuchet MS'],
  ["'Impact', sans-serif", 'Impact'],
  ["'Franklin Gothic Medium', sans-serif", 'Franklin Gothic'],
];

// [element id, path inside the widget object, value kind]
const BINDINGS = [
  ['label', 'label', 'str'],
  ['showCity', 'display.showCity', 'bool'],
  ['showDate', 'display.showDate', 'bool'],
  ['showSeconds', 'display.showSeconds', 'bool'],
  ['hour12', 'display.hour12', 'bool'],
  ['showZone', 'display.showZone', 'bool'],
  ['fontFamily', 'style.fontFamily', 'str'],
  ['fontSize', 'style.fontSize', 'num'],
  ['textColor', 'style.textColor', 'str'],
  ['bgColor', 'style.bgColor', 'str'],
  ['locked', 'behavior.locked', 'bool'],
  ['opacity', 'behavior.opacity', 'num'],
];

const RANGE_LABELS = {
  fontSize: (v) => `${v}px`,
  opacity: (v) => `${Math.round(v * 100)}%`,
};

let state = null;
let selectedId = null;
let lastSelfEdit = 0;

const $ = (id) => document.getElementById(id);

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function patchFor(path, value) {
  const keys = path.split('.');
  const out = {};
  let cur = out;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else cur = cur[k] = {};
  });
  return out;
}

function setLocal(path, value) {
  const w = selected();
  if (!w) return;
  const keys = path.split('.');
  let cur = w;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
  cur[keys[keys.length - 1]] = value;
}

function selected() {
  return (state?.config.widgets || []).find((w) => w.id === selectedId) || null;
}

/* ---------------- widget list ---------------- */

// Bootstrap Icons eye / eye-slash. MIT licence, (c) 2019-2024 The Bootstrap Authors.
// https://icons.getbootstrap.com
const EYE_OPEN = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/></svg>';
const EYE_CLOSED = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755q-.247.248-.517.486z"/><path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829"/><path d="M3.35 5.47q-.27.24-.518.487A13 13 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12z"/></svg>';

function renderList() {
  const ul = $('widgetList');
  const widgets = state?.config.widgets || [];
  ul.innerHTML = '';
  for (const w of widgets) {
    const visible = w.behavior.visible !== false;

    const li = document.createElement('li');
    li.dataset.id = w.id;
    li.classList.toggle('active', w.id === selectedId);
    li.classList.toggle('hidden-widget', !visible);

    const text = document.createElement('div');
    text.className = 'item-text';
    const b = document.createElement('b');
    b.textContent = w.label || w.timeZone;
    const small = document.createElement('small');
    // Keyed off the picked city, not the Name, so renaming leaves this alone.
    small.textContent = subtitleFor(w.timeZone, w.city);
    const clock = document.createElement('span');
    clock.className = 'clock';
    text.append(b, small, clock);

    const eye = document.createElement('button');
    eye.className = 'eye';
    eye.title = visible ? 'Hide this widget' : 'Show this widget';
    eye.innerHTML = visible ? EYE_OPEN : EYE_CLOSED;
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      lastSelfEdit = Date.now();
      w.behavior.visible = !visible;
      api.updateWidget(w.id, { behavior: { visible: !visible } });
      renderList();
    });

    li.append(text, eye);
    li.addEventListener('click', () => select(w.id));
    ul.appendChild(li);
  }
  $('form').hidden = widgets.length === 0;
  $('empty').hidden = widgets.length !== 0;
  tickList();
}

function tickList() {
  const now = new Date();
  for (const li of $('widgetList').children) {
    const w = (state?.config.widgets || []).find((x) => x.id === li.dataset.id);
    if (!w) continue;
    const m = renderModel(now, w);
    li.querySelector('.clock').textContent = `${m.time}${m.meridiem ? ' ' + m.meridiem : ''}`;
  }
}

/* ---------------- form ---------------- */

// One control covers everything: the curated cities first, then every IANA zone so no
// location is unreachable. Values are "c:<index>" for a city and "z:<zone>" for a raw zone.
function fillStaticOptions() {
  const preset = $('tzPreset');
  preset.innerHTML = '';

  const cities = document.createElement('optgroup');
  cities.label = 'Cities';
  // Continent/Country/City, the same string the widget subtitle shows.
  CITIES.forEach(([zone, city, country], i) => {
    const o = document.createElement('option');
    o.value = `c:${i}`;
    o.textContent = cityDisplay(zone, city, country);
    cities.appendChild(o);
  });
  preset.appendChild(cities);

  const all = document.createElement('optgroup');
  all.label = 'All time zones';
  for (const tz of state?.timeZones || []) {
    const o = document.createElement('option');
    o.value = `z:${tz}`;
    // No country is known for these; the raw zone id keeps the list unambiguous.
    o.textContent = tz;
    all.appendChild(o);
  }
  preset.appendChild(all);

  const ff = $('fontFamily');
  ff.innerHTML = '';
  for (const [value, name] of FONTS) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = name;
    o.style.fontFamily = value;
    ff.appendChild(o);
  }
}

// Exact city match wins, otherwise the first preset on the same zone, otherwise the raw zone.
function syncPresetSelect() {
  const w = selected();
  if (!w) return;
  let i = CITIES.findIndex(([tz, city]) => tz === w.timeZone && city === w.city);
  if (i < 0) i = CITIES.findIndex(([tz]) => tz === w.timeZone);
  $('tzPreset').value = i >= 0 ? `c:${i}` : `z:${w.timeZone}`;
  $('tzStatus').textContent = w.timeZone;
}

function syncRangeLabel(id) {
  if (!RANGE_LABELS[id]) return;
  const lbl = $(`${id}Val`);
  if (lbl) lbl.textContent = RANGE_LABELS[id](Number($(id).value));
}

function syncBackground() {
  const w = selected();
  const preview = $('bgPreview');
  preview.innerHTML = '';
  if (w && w.style.bgImage) {
    const img = document.createElement('img');
    img.src = `${BG_SCHEME}://image/${encodeURIComponent(w.style.bgImage)}`;
    img.alt = '';
    preview.appendChild(img);
    $('clearBg').disabled = false;
  } else {
    const span = document.createElement('span');
    span.textContent = 'No image';
    preview.appendChild(span);
    $('clearBg').disabled = true;
  }
}

function populate() {
  const w = selected();
  if (!w) return;
  for (const [id, path, kind] of BINDINGS) {
    const elm = $(id);
    if (!elm) continue;
    const v = getPath(w, path);
    if (kind === 'bool') elm.checked = !!v;
    else elm.value = v == null ? '' : String(v);
    syncRangeLabel(id);
  }
  // Keep a custom font value selectable instead of silently snapping to the first option
  const ff = $('fontFamily');
  if (ff.value !== w.style.fontFamily) {
    const o = document.createElement('option');
    o.value = w.style.fontFamily;
    o.textContent = `${w.style.fontFamily} (custom)`;
    ff.appendChild(o);
    ff.value = w.style.fontFamily;
  }
  // Hint with the city this widget was picked from, not some arbitrary example.
  $('label').placeholder = w.city || '';
  syncPresetSelect();
  syncBackground();
  $('startWithWindows').checked = !!state.config.general.startWithWindows;
}

function commit(path, value) {
  if (!selectedId) return;
  lastSelfEdit = Date.now();
  api.updateWidget(selectedId, patchFor(path, value));
}

function bindInputs() {
  for (const [id, path, kind] of BINDINGS) {
    const elm = $(id);
    if (!elm) continue;
    elm.addEventListener('input', () => {
      let value;
      if (kind === 'bool') value = elm.checked;
      else if (kind === 'num') value = Number(elm.value);
      else value = elm.value;

      syncRangeLabel(id);
      setLocal(path, value);
      commit(path, value);
      // Renaming must not move the picker: a custom name has no preset to match, and
      // re-syncing would snap the dropdown to the first city sharing the zone.
      if (id === 'label') renderList();
    });
  }

  $('tzPreset').addEventListener('input', (e) => {
    const value = e.target.value;
    let tz;
    let label;
    if (value.startsWith('c:')) {
      const entry = CITIES[Number(value.slice(2))];
      if (!entry) return;
      // The Name box gets the city alone; the continent and country are added when the
      // subtitle is drawn.
      tz = entry[0];
      label = entry[1];
    } else {
      tz = value.slice(2);
      if (!isValidZone(tz)) return;
      label = zoneCity(tz);
    }
    // Picking sets both: the city is what settings display, the Name is the editable copy.
    $('label').value = label;
    setLocal('timeZone', tz);
    setLocal('label', label);
    setLocal('city', label);
    $('label').placeholder = label;
    lastSelfEdit = Date.now();
    api.updateWidget(selectedId, { timeZone: tz, label, city: label });
    $('tzStatus').textContent = tz;
    renderList();
  });

  $('pickBg').addEventListener('click', async () => {
    if (!selectedId) return;
    lastSelfEdit = Date.now();
    const w = await api.pickBackground(selectedId);
    if (w) {
      setLocal('style.bgImage', w.style.bgImage);
      syncBackground();
    }
  });

  $('clearBg').addEventListener('click', async () => {
    if (!selectedId) return;
    lastSelfEdit = Date.now();
    await api.clearBackground(selectedId);
    setLocal('style.bgImage', '');
    syncBackground();
  });

  $('addWidget').addEventListener('click', async () => {
    const w = await api.addWidget(state?.systemZone);
    if (w) selectedId = w.id;
  });

  $('dupWidget').addEventListener('click', async () => {
    if (!selectedId) return;
    const w = await api.duplicateWidget(selectedId);
    if (w) selectedId = w.id;
  });

  $('delWidget').addEventListener('click', async () => {
    if (!selectedId) return;
    await api.removeWidget(selectedId);
    selectedId = state?.config.widgets[0]?.id || null;
  });

  $('startWithWindows').addEventListener('input', (e) => {
    lastSelfEdit = Date.now();
    api.updateGeneral({ startWithWindows: e.target.checked });
  });

  $('quitApp').addEventListener('click', () => api.quit());
}

function select(id) {
  selectedId = id;
  for (const li of $('widgetList').children) li.classList.toggle('active', li.dataset.id === id);
  populate();
}

setInterval(tickList, 1000);

/* ---------------- state ---------------- */

function onState(config) {
  if (!state) return;
  state.config = config;
  if (!config.widgets.some((w) => w.id === selectedId)) {
    selectedId = config.widgets[0]?.id || null;
  }
  renderList();
  if (selectedId && Date.now() - lastSelfEdit > 500) populate();
  $('startWithWindows').checked = !!config.general.startWithWindows;
}

api.getState().then((s) => {
  state = s;
  selectedId = s.config.widgets[0]?.id || null;
  fillStaticOptions();
  bindInputs();
  renderList();
  if (selectedId) populate();
});

api.onState(onState);
api.onFocusWidget((id) => {
  if (!state) return;
  if (state.config.widgets.some((w) => w.id === id)) select(id);
});
