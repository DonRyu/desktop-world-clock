'use strict';
/*
 * Time zone and daylight saving time math.
 * Offsets are read from Intl (ICU's bundled IANA tz database) on every tick, so
 * DST transitions (March/November in the north, October/April in the south) are
 * picked up automatically, and odd cases such as Lord Howe's 30-minute DST or
 * India's +5:30 come out correct without any special casing.
 *
 * ZONE_OVERRIDES patches the handful of zones whose rules changed after the bundled
 * database was cut. See the table below.
 */

const _fmtCache = new Map();

function partsFormatter(timeZone) {
  let f = _fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    _fmtCache.set(timeZone, f);
  }
  return f;
}

function isValidZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall clock straight from ICU, with no override applied. */
function rawZonedParts(date, timeZone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return {
    year: +out.year,
    month: +out.month,
    day: +out.day,
    hour: +out.hour % 24,
    minute: +out.minute,
    second: +out.second,
  };
}

function rawOffsetMinutes(date, timeZone) {
  const p = rawZonedParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/* ------------------------------------------------------------------ */
/* Rules newer than the bundled tz database                            */
/* ------------------------------------------------------------------ */

/*
 * Electron 43 ships tzdata 2025c. A zone listed here is one whose rule changed in a
 * later release, held as a flat offset that applies from `from` onward.
 *
 * Each entry retires itself: if the bundled database already agrees at `probe`, the
 * override is ignored. So once Electron ships newer tz data the patch simply stops
 * firing, and the entry can be deleted at leisure rather than urgently.
 */
const ZONE_OVERRIDES = {
  // British Columbia stops moving its clocks: after the March 2026 spring forward it
  // stays on daylight time for good, so the November 2026 fall back never happens.
  // tzdata 2026b has this; 2025c still falls back every November.
  'America/Vancouver': {
    from: Date.UTC(2026, 10, 1, 9), // 2026-11-01T09:00Z, the fall back that is skipped
    probe: Date.UTC(2027, 0, 15, 12), // a winter instant where the two databases differ
    offsetMinutes: -420, // UTC-07:00 year round
    abbr: 'PDT',
  },
};

const _overrideActive = new Map();

/** An override only applies while the bundled database still disagrees with it. */
function overrideFor(date, timeZone) {
  const rule = ZONE_OVERRIDES[timeZone];
  if (!rule || date.getTime() < rule.from) return null;

  let active = _overrideActive.get(timeZone);
  if (active === undefined) {
    try {
      active = rawOffsetMinutes(new Date(rule.probe), timeZone) !== rule.offsetMinutes;
    } catch {
      active = false;
    }
    _overrideActive.set(timeZone, active);
  }
  return active ? rule : null;
}

/**
 * Shifts the instant by the override offset and formats it as UTC, which reproduces the
 * wall clock the overridden rule implies. Zones without an override pass straight through.
 */
function effective(date, timeZone) {
  const rule = overrideFor(date, timeZone);
  if (!rule) return { date, zone: timeZone, rule: null };
  return { date: new Date(date.getTime() + rule.offsetMinutes * 60000), zone: 'UTC', rule };
}

/* ------------------------------------------------------------------ */

function zonedParts(date, timeZone) {
  const eff = effective(date, timeZone);
  return rawZonedParts(eff.date, eff.zone);
}

/** Offset from UTC in minutes. Seoul 540, New York -240 in summer / -300 in winter. */
function offsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * Standard-time offset for that year = the smaller of the January and July offsets.
 * Works for both hemispheres.
 */
function standardOffsetMinutes(date, timeZone) {
  const y = zonedParts(date, timeZone).year;
  const jan = offsetMinutes(new Date(Date.UTC(y, 0, 1, 12)), timeZone);
  const jul = offsetMinutes(new Date(Date.UTC(y, 6, 1, 12)), timeZone);
  return Math.min(jan, jul);
}

/** Whether DST is currently in effect, and by how many minutes. */
function dstInfo(date, timeZone) {
  const cur = offsetMinutes(date, timeZone);
  const std = standardOffsetMinutes(date, timeZone);
  const delta = cur - std;
  return { active: delta > 0, deltaMinutes: delta, offsetMinutes: cur };
}

function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}

/** Abbreviation such as EDT or KST. Returns null for zones that have none. */
function zoneAbbr(date, timeZone) {
  const rule = overrideFor(date, timeZone);
  if (rule) return rule.abbr || null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(date);
    const v = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    return /^[A-Z]{2,5}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * What the desktop widget prints above the clock: the Name on its own, and nothing at all
 * when the Name is blank. The country only appears in the settings window, where it helps
 * tell two entries apart.
 */
function cityLabelOf(tz, label) {
  return (label || '').trim();
}

const LOCALE = 'en-US';
const DATE_STYLE = 'full'; // e.g. "Monday, August 17, 2026"

/** Builds every string a single widget needs to draw. */
function renderModel(date, widget) {
  const tz = isValidZone(widget.timeZone) ? widget.timeZone : 'UTC';
  const locale = LOCALE;
  const d = widget.display || {};
  const eff = effective(date, tz);
  const p = zonedParts(date, tz);
  const dst = dstInfo(date, tz);

  let hour = p.hour;
  let meridiem = '';
  if (d.hour12) {
    meridiem = new Intl.DateTimeFormat(locale, { timeZone: eff.zone, hour: 'numeric', hour12: true })
      .formatToParts(eff.date)
      .find((x) => x.type === 'dayPeriod')?.value || (p.hour < 12 ? 'AM' : 'PM');
    hour = p.hour % 12 || 12;
  }

  const time = d.hour12
    ? `${hour}:${pad2(p.minute)}${d.showSeconds ? ':' + pad2(p.second) : ''}`
    : `${pad2(hour)}:${pad2(p.minute)}${d.showSeconds ? ':' + pad2(p.second) : ''}`;

  let dateText = '';
  if (d.showDate) {
    try {
      dateText = new Intl.DateTimeFormat(locale, {
        timeZone: eff.zone,
        dateStyle: DATE_STYLE,
      }).format(eff.date);
    } catch {
      dateText = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
    }
  }

  const abbr = zoneAbbr(date, tz);
  const offset = formatOffset(dst.offsetMinutes);

  return {
    time,
    meridiem,
    dateText,
    city: cityLabelOf(tz, widget.label),
    zoneText: abbr ? `${abbr} · ${offset}` : offset,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    isValidZone,
    offsetMinutes,
    standardOffsetMinutes,
    dstInfo,
    formatOffset,
    zoneAbbr,
    renderModel,
    ZONE_OVERRIDES,
  };
}
