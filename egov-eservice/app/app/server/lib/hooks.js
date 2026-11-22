'use strict';
/**
 * Lifecycle hooks for modules that keep in-memory state.
 *
 *   const hooks = require('../../lib/hooks');
 *   hooks.onReset(() => myCache.clear());     // runs on POST /api/test/reset (after DB wipe, before seed)
 *   hooks.onAfterReset(() => {...});          // runs after seed + clock reset
 *
 * DB tables are wiped automatically — only register hooks for memory/disk state.
 */
const before = [];
const after = [];

function onReset(fn) { before.push(fn); }
function onAfterReset(fn) { after.push(fn); }
function run(list, label) {
  for (const fn of list) {
    try { fn(); } catch (e) { console.error(`[hooks] ${label} hook failed:`, e); }
  }
}
module.exports = {
  onReset, onAfterReset,
  runReset: () => run(before, 'reset'),
  runAfterReset: () => run(after, 'after-reset'),
};
