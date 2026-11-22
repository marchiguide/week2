'use strict';
/**
 * Runtime configuration (env vars). Read once at startup.
 *
 *   PORT        HTTP port (default 3000)
 *   TEST_MODE   "1" (or "true") → enable /api/test/* + frozen test clock. Unset/empty → off (/api/test/* = 404)
 *   BUG_MODE    comma list of bug codes, e.g. "B03,B07" (see lib/bugs.js). Unset/empty → correct app
 *   DB_PATH     SQLite file (default <app>/data/egov.db). In TEST_MODE the file is recreated on every start.
 *   APP_SECRET  master secret for AES-256-GCM + blind index (default = fixed test secret)
 *   DOC_HMAC_KEY  key for simulated document signature HMAC-SHA256 (default = fixed test key, A-22)
 */
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..', '..'); // .../app
const SERVER_ROOT = path.resolve(__dirname, '..');    // .../app/server

function flag(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

const config = {
  appRoot: APP_ROOT,
  serverRoot: SERVER_ROOT,
  port: Number(process.env.PORT || 3000),
  testMode: flag(process.env.TEST_MODE),
  bugModeRaw: process.env.BUG_MODE || '',
  dbPath: path.resolve(process.env.DB_PATH || path.join(APP_ROOT, 'data', 'egov.db')),
  isProd: process.env.NODE_ENV === 'production',
  appSecret: process.env.APP_SECRET || 'egov-sukjai-test-secret-not-for-production',
  docHmacKey: process.env.DOC_HMAC_KEY || 'egov-sukjai-test-signing-key',
  /** Test clock value after reset / at startup in TEST_MODE (A-01, Tuesday). */
  defaultTestNow: '2026-12-01T09:00:00+07:00',
  logRequests: flag(process.env.LOG_REQUESTS),
  strictModules: flag(process.env.STRICT_MODULES),
};

module.exports = config;
