'use strict';
/**
 * Append-only Audit Trail (DECISIONS §13 · CONTRACT §6.8). The `audit` table has triggers that ABORT
 * any UPDATE/DELETE; this module only INSERTs. Time comes from the test clock.
 *
 *   const { logAudit } = require('../../lib/audit');
 *   logAudit({ user: req.user, event: 'CLAIM', caseNo, fromStatus: 'SUBMITTED', toStatus: 'IN_REVIEW' });
 *   logAudit({ username: 'admin1', role: 'admin', event: 'ADMIN_CHANGE', detail: 'SV-01 fee 20 → 25' });
 *
 * detail formats (CONTRACT §6.8): RETURN/REJECT/UNMASK = reason text · FORWARD = note · ISSUE = docNo ·
 * EXPORT = 'xlsx 2026-11 ALL' / 'audit-csv' · ADMIN_CHANGE = 'SV-01 fee 20 → 25' | 'holiday add 2026-12-02' |
 * 'exec1 role executive → auditor'
 */
const { db } = require('./db');
const clock = require('./clock');
const { AUDIT_EVENTS } = require('./codes');

/**
 * @param {object} e
 * @param {object} [e.user]      req.user (username + role taken from it)
 * @param {string} [e.username]  explicit (overrides user)
 * @param {string} [e.role]
 * @param {string} e.event       one of AUDIT_EVENTS
 * @param {string} [e.caseNo]
 * @param {string} [e.fromStatus]
 * @param {string} [e.toStatus]
 * @param {string} [e.detail]
 * @param {string} [e.time]      ISO override (default clock.nowIso())
 * @returns {number} new audit id
 */
function logAudit(e) {
  const username = e.username || (e.user && e.user.username) || 'system';
  const role = e.role || (e.user && e.user.role) || 'system';
  if (!AUDIT_EVENTS.includes(e.event)) console.warn(`[audit] unknown event "${e.event}"`);
  const info = db.prepare(
    `INSERT INTO audit (time, username, role, event, case_no, from_status, to_status, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    e.time || clock.nowIso(), username, role, e.event,
    e.caseNo || null, e.fromStatus || null, e.toStatus || null,
    e.detail == null ? '' : String(e.detail)
  );
  return Number(info.lastInsertRowid);
}

/** Row → API shape {id,time,username,role,event,caseNo,fromStatus,toStatus,detail} */
function toApi(r) {
  return {
    id: r.id, time: r.time, username: r.username, role: r.role, event: r.event,
    caseNo: r.case_no, fromStatus: r.from_status, toStatus: r.to_status, detail: r.detail,
  };
}

module.exports = { logAudit, toApi, AUDIT_EVENTS };
