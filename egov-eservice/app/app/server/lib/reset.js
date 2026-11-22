'use strict';
/**
 * Full reset (POST /api/test/reset · also used at startup when the DB is empty):
 *   1. one transaction: wipe every table (sessions, OTP locks, notifications, audit, uploads, …)
 *      then run server/seed/index.js (TEST-DATA)
 *   2. in-memory reset hooks (lib/hooks.onReset) run before the seed
 *   3. clock back to 2026-12-01T09:00:00+07:00 (TEST_MODE) — before seeding so seed sees the reset clock
 */
const path = require('path');
const config = require('./config');
const clock = require('./clock');
const dbm = require('./db');
const hooks = require('./hooks');

const SEED = path.join(config.serverRoot, 'seed', 'index.js');

function loadSeed() {
  const mod = require(SEED);
  if (typeof mod === 'function') return mod;
  if (mod && typeof mod.seed === 'function') return mod.seed;
  if (mod && typeof mod.run === 'function') return mod.run;
  throw new Error('seed/index.js must export a function seed(db)');
}

function resetAll() {
  const db = dbm.db;
  const seed = loadSeed();
  const now = clock.reset();
  db.transaction(() => {
    dbm.wipeAll();
    hooks.runReset();
    seed(db);
  })();
  hooks.runAfterReset();
  return { ok: true, now };
}

module.exports = { resetAll };
