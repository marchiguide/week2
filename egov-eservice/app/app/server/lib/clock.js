'use strict';
/**
 * The ONLY source of "now" for business rules (README §3 rule 5 · CONTRACT §8).
 *
 *   - TEST_MODE=1 : clock is FROZEN (A-37). Starts at 2026-12-01T09:00:00+07:00, changed only by
 *                   PUT /api/test/clock or POST /api/test/reset.
 *   - otherwise   : real time.
 *
 * Never call Date.now() / new Date() for rule logic anywhere else — use clock.now()/nowMs()/nowIso().
 *
 * Asia/Bangkok is a fixed +07:00 offset (no DST), so all conversions here are plain arithmetic
 * (deterministic, no Intl/TZ dependency).
 *
 * Storage convention (whole app): every time column is TEXT 'YYYY-MM-DDTHH:MM:SS+07:00'
 * (always +07:00, always with seconds) → string comparison == chronological comparison.
 * Date-only values (holidays, validUntil) are 'YYYY-MM-DD' (Bangkok calendar date).
 */
const config = require('./config');

const OFFSET_MIN = 7 * 60;
const OFFSET_MS = OFFSET_MIN * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Strict ISO 8601 with explicit offset (Z or ±HH:MM). Seconds and fraction optional.
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

let frozenMs = null; // number when frozen (TEST_MODE)

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

/** Parse a strict ISO string with offset → Date, or null if invalid / no offset / impossible date. */
function parseIso(str) {
  if (typeof str !== 'string') return null;
  const m = ISO_RE.exec(str.trim());
  if (!m) return null;
  const [, Y, Mo, D, h, mi, s = '00', frac = '0', off] = m;
  const y = +Y, mo = +Mo, d = +D, H = +h, M = +mi, S = +s;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || H > 23 || M > 59 || S > 59) return null;
  let offMin = 0;
  if (off !== 'Z') {
    const sign = off[0] === '-' ? -1 : 1;
    const oh = +off.slice(1, 3), om = +off.slice(4, 6);
    if (oh > 14 || om > 59) return null;
    offMin = sign * (oh * 60 + om);
  }
  const ms = Math.floor(Number('0.' + frac) * 1000);
  const utc = Date.UTC(y, mo - 1, d, H, M, S, ms) - offMin * 60000;
  // reject impossible calendar dates (e.g. 2026-02-30)
  const chk = new Date(Date.UTC(y, mo - 1, d));
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  return new Date(utc);
}

function toMs(x) {
  if (x == null) return null;
  if (x instanceof Date) return x.getTime();
  if (typeof x === 'number') return x;
  if (typeof x === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return fromDateKey(x).getTime(); // date-only → 00:00 Bangkok
    const d = parseIso(x);
    if (d) return d.getTime();
    const t = Date.parse(x);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Bangkok wall-clock parts of a Date|ms|ISO string. weekday: 0=Sun … 6=Sat. */
function parts(x) {
  const ms = toMs(x);
  if (ms == null) return null;
  const b = new Date(ms + OFFSET_MS); // shift, then read UTC fields = Bangkok wall clock
  const year = b.getUTCFullYear(), month = b.getUTCMonth() + 1, day = b.getUTCDate();
  return {
    year, month, day,
    hour: b.getUTCHours(), minute: b.getUTCMinutes(), second: b.getUTCSeconds(), ms: b.getUTCMilliseconds(),
    weekday: b.getUTCDay(),
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
    beYear: year + 543,
  };
}

/** Format as 'YYYY-MM-DDTHH:MM:SS+07:00' (the storage/API format). null-safe. */
function toIso(x) {
  const p = parts(x);
  if (!p) return null;
  return `${p.dateKey}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}+07:00`;
}

/** Date for a Bangkok wall-clock time. month is 1-12. */
function fromBkk(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms) - OFFSET_MS);
}

/** 'YYYY-MM-DD' (+ optional 'HH:MM[:SS]') Bangkok → Date. */
function fromDateKey(key, time = '00:00:00') {
  const [y, m, d] = key.split('-').map(Number);
  const [h = 0, mi = 0, s = 0] = String(time).split(':').map(Number);
  return fromBkk(y, m, d, h, mi, s);
}

/** Bangkok calendar date 'YYYY-MM-DD' of x. */
function dateKey(x) { const p = parts(x); return p ? p.dateKey : null; }

/** Add n calendar days to a 'YYYY-MM-DD' key. */
function addDaysKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Weekday of a 'YYYY-MM-DD' key (0=Sun … 6=Sat). */
function weekdayOfKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Buddhist-era year (Bangkok calendar) of x, e.g. 2026-12-31T23:59+07:00 → 2569, 2027-01-01T00:00+07:00 → 2570. */
function beYear(x) { const p = parts(x); return p ? p.beYear : null; }

// ---------------------------------------------------------------- the clock itself

function nowMs() {
  if (frozenMs != null) return frozenMs;
  return Date.now(); // the single allowed real-time read
}
function now() { return new Date(nowMs()); }
function nowIso() { return toIso(nowMs()); }

/**
 * Set (freeze) the clock. Accepts strict ISO with offset only.
 * @returns {string|null} normalized '+07:00' ISO, or null if invalid (caller answers 400 INVALID_TIME)
 */
function set(iso) {
  const d = parseIso(iso);
  if (!d) return null;
  frozenMs = d.getTime();
  return nowIso();
}

/** Back to the start value: frozen at 2026-12-01T09:00:00+07:00 in TEST_MODE, real time otherwise. */
function reset() {
  frozenMs = config.testMode ? parseIso(config.defaultTestNow).getTime() : null;
  return nowIso();
}

function isFrozen() { return frozenMs != null; }

reset();

module.exports = {
  OFFSET_MS, DAY_MS,
  now, nowMs, nowIso, set, reset, isFrozen,
  parseIso, toIso, toMs, parts, fromBkk, fromDateKey, dateKey, addDaysKey, weekdayOfKey, beYear,
};
