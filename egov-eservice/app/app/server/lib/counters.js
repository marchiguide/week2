'use strict';
/**
 * Atomic sequences in table `counters` (better-sqlite3 is synchronous → no interleaving inside one
 * statement; next() is safe for concurrent HTTP requests, e.g. TC-PAY-03 six payments at once).
 *
 *   const counters = require('../../lib/counters');
 *   const n = counters.next('case:2569');            // → 31 after reset (seed sets value = 30)
 *   counters.formatSeq('EG', 2569, n)                 // → 'EG-2569-000031'
 *   counters.next('draft') → 3 → `DR-${String(3).padStart(4,'0')}` (DR-0003)
 *
 * Seed (B02) sets starting values with counters.set(name, lastIssued).
 */
const { db } = require('./db');

function next(name) {
  db.prepare('INSERT INTO counters (name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING').run(name);
  return db.prepare('UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value').get(name).value;
}
function peek(name) {
  const r = db.prepare('SELECT value FROM counters WHERE name = ?').get(name);
  return r ? r.value : 0;
}
function set(name, value) {
  db.prepare('INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(name, value);
}
/** 'EG', 2569, 31 → 'EG-2569-000031' */
function formatSeq(prefix, beYear, n, width = 6) {
  return `${prefix}-${beYear}-${String(n).padStart(width, '0')}`;
}

module.exports = { next, peek, set, formatSeq };
