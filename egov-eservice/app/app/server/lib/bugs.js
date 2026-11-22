'use strict';
/**
 * BUG_MODE switches (BUGS.md · DECISIONS §16). Usage:
 *
 *   const { bug } = require('../../lib/bugs');
 *   if (bug('B03')) { ...buggy path... } else { ...correct path... }
 *
 * BUG_MODE="B03,B07" (comma separated, spaces/case ignored). Unset/empty → app is 100% correct.
 * Bugs must only affect NEW calculations / permission checks, never the seed data (A-35).
 *
 * Owner of each bug:
 *   B01 SV-03 area 101 → ฿1,000 (> instead of ≥)            rules/      (B03 block)
 *   B02 file of exactly 5,242,880 bytes rejected             citizen/    (B05)
 *   B03 SLA skips weekends only, not holiday table           rules/      (B03)
 *   B04 SLA does not pause during NEED_FIX                   rules/      (B03)
 *   B05 QR aged exactly 15:00 still payable                  citizen/    (B05)
 *   B06 citizen can open another citizen's case (IDOR)       citizen/    (B05)
 *   B07 officer can approve SV-02 without head (API)         officer/    (B06)
 *   B08 second claim not rejected (takes ownership)          officer/    (B06)
 *   B09 officer queue API returns full idNo                  officer/    (B06)
 *   B10 on-time % divided by "received" not "closed"         dashboard/  (B09)
 *   B11 unmask does not write Audit UNMASK                   officer/    (B06)
 *   B12 third return allowed                                 officer/    (B06)
 */
const config = require('./config');

const KNOWN = new Set(['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12']);

function parse(raw) {
  return String(raw || '')
    .split(/[,\s;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

const active = new Set(parse(config.bugModeRaw));
const unknown = [...active].filter((c) => !KNOWN.has(c));

/** true when bug `code` (e.g. 'B03') is enabled via BUG_MODE. */
function bug(code) {
  return active.has(String(code).trim().toUpperCase());
}

function activeBugs() {
  return [...active].sort();
}

module.exports = { bug, activeBugs, unknownBugs: unknown, KNOWN_BUGS: [...KNOWN] };
