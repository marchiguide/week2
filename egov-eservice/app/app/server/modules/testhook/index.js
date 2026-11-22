'use strict';
/**
 * Test hooks (CONTRACT §8 · DECISIONS §15) — mounted only when TEST_MODE=1.
 * (server/index.js additionally answers 404 for every /api/test/* when TEST_MODE is off, so other blocks'
 *  hooks such as /api/test/payments/:ref/pay or /api/test/documents/:docNo/tamper are covered too.)
 *
 *   POST /api/test/reset   → 200 {"ok":true,"now":"2026-12-01T09:00:00+07:00"} · wipes everything (sessions too) + seed
 *   GET  /api/test/clock   → 200 {"now":"…+07:00"}
 *   PUT  /api/test/clock   {"now":"2026-12-01T16:30:00+07:00"} → 200 {"now":…} (frozen) · 400 INVALID_TIME
 *
 * Requests to /api/test/* never trigger the notification hook (CONTRACT §0.7).
 */
const express = require('express');
const config = require('../../lib/config');
const clock = require('../../lib/clock');
const { resetAll } = require('../../lib/reset');
const { sendError } = require('../../lib/errors');

module.exports = function register(app) {
  if (!config.testMode) return;
  const r = express.Router();

  r.post('/reset', (req, res) => {
    const out = resetAll();
    res.json({ ok: true, now: out.now });
  });

  r.get('/clock', (req, res) => {
    res.json({ now: clock.nowIso() });
  });

  r.put('/clock', (req, res) => {
    const value = req.body && req.body.now;
    const now = clock.set(value);
    if (!now) return sendError(res, 'INVALID_TIME');
    res.json({ now });
  });

  app.use('/api/test', r);
};
