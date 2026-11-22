'use strict';
/**
 * Officer / head workflow (block B06): queue, claim, return, forward, approve, reject, unmask.
 *
 * CONTRACT §2.6–2.8 §6.3 · DECISIONS §1 §3 (routing) §5 §9 §10 §11 §18 · BUGS B07 B08 B09 B11 B12.
 *
 * Where a case sits (same conventions as the seed, block B02):
 *   SUBMITTED         dept = registry, owner NULL                      (registry queue, claimable)
 *   IN_REVIEW         dept = registry|works, owner = officer | NULL     (SV-03 step 2 enters works unclaimed)
 *   NEED_FIX          dept/owner unchanged (resubmit returns it to the same owner)
 *   PENDING_APPROVAL  dept NULL, owner = head username                  (/head/approvals)
 *   APPROVED          dept = registry, owner NULL, issuer = registry officer of step 1 (waits for "issue")
 *   REJECTED          dept NULL, owner NULL, closed_at set
 *
 * Every state change runs in one IMMEDIATE transaction with a conditional UPDATE, so two concurrent
 * claims can never both win (better-sqlite3 is synchronous; the WHERE clause is the second guard).
 */
const { db } = require('../../lib/db');
const clock = require('../../lib/clock');
const { bug } = require('../../lib/bugs');
const { ApiError } = require('../../lib/errors');
const { logAudit } = require('../../lib/audit');
const crypto = require('../../lib/crypto');
const fmt = require('../../lib/format');
const { SERVICES } = require('../../lib/codes');
const rules = require('../../rules');

const WORKLOAD_LIMIT = 10;          // A-19: IN_REVIEW cases held, checked only when claiming
const RETURN_LIMIT = 2;             // A-20
const FIX_WINDOW_MS = 168 * 3600 * 1000; // A-21: 7 calendar days
const MIN_REASON = 10;              // A-12 (counted after trimming)
const QUEUE_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'APPROVED'];
const CLAIMABLE = ['SUBMITTED', 'IN_REVIEW'];

// ---------------------------------------------------------------- helpers

function holidaySet() {
  return new Set(db.prepare('SELECT date FROM holidays').pluck().all());
}

function slaLevelOf(row, nowIso, holidays) {
  if (!row.due_at && !['COMPLETED', 'REJECTED', 'CANCELLED', 'NEED_FIX'].includes(row.status)) return 'normal';
  return rules.slaLevel(row, nowIso, holidays);
}

function approverRole(serviceId) {
  return (SERVICES[serviceId] && SERVICES[serviceId].approver) || 'head';
}

function trimmed(reason) {
  return typeof reason === 'string' ? reason.trim() : '';
}

function requireReason(reason) {
  if ([...trimmed(reason)].length < MIN_REASON) throw new ApiError('REASON_TOO_SHORT');
  return trimmed(reason);
}

function loadCase(caseNo) {
  const row = db.prepare(`
    SELECT c.*, z.name AS applicant_name, z.id_enc AS applicant_id_enc
    FROM cases c JOIN citizens z ON z.id = c.citizen_id
    WHERE c.case_no = ?`).get(String(caseNo || ''));
  if (!row) throw new ApiError('NOT_FOUND');
  return row;
}

function decryptId(enc) {
  try { return crypto.decrypt(enc) || ''; } catch (_) { return ''; }
}

function firstHead() {
  return db.prepare("SELECT username FROM users WHERE role = 'head' AND active = 1 ORDER BY id LIMIT 1").pluck().get() || null;
}

function workload(username) {
  return db.prepare("SELECT COUNT(*) FROM cases WHERE status = 'IN_REVIEW' AND owner = ?").pluck().get(username);
}

function addEvent(c, user, event, fromStatus, toStatus, step, note, data, time) {
  db.prepare(`INSERT INTO case_events (case_no, time, actor, actor_role, event, from_status, to_status, step, note, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(c.case_no, time, user.username, user.role, event, fromStatus, toStatus,
      step == null ? null : step, note || null, data ? JSON.stringify(data) : null);
}

/** Issuer rule (A-27) — the one in documents/ (B07) is authoritative; same logic as fallback. */
function isIssuer(c, user) {
  try {
    const docs = require('../documents/documents');
    if (docs && typeof docs.isIssuer === 'function') return docs.isIssuer(c, user);
  } catch (_) { /* documents module not present */ }
  const issuer = c.service_id === 'SV-01' ? (c.approver || c.owner) : c.issuer;
  return !!user && user.role === 'officer' && user.dept === 'registry' && user.username === issuer;
}

// ---------------------------------------------------------------- permissions (also used by the page)

/** Which action buttons the viewer gets on /officer/cases/:caseNo (CONTRACT §2.6 · §0.5 "absent = not rendered"). */
function actionsFor(user, c) {
  const a = { claim: false, return: false, forward: false, approve: false, reject: false, issue: false, unmask: false };
  if (!user || (user.role !== 'officer' && user.role !== 'head')) return a;
  a.unmask = true;
  const holder = user.role === 'officer' && c.owner === user.username && c.status === 'IN_REVIEW';
  if (user.role === 'officer') {
    a.claim = CLAIMABLE.includes(c.status) && !c.owner && c.dept === user.dept;
    a.return = holder && (c.return_count < RETURN_LIMIT || bug('B12'));
    a.forward = holder && approverRole(c.service_id) === 'head';
    a.approve = holder && approverRole(c.service_id) === 'officer';
    a.reject = a.approve;
    a.issue = c.status === 'APPROVED' && isIssuer(c, user);
  } else { // head
    const decide = c.status === 'PENDING_APPROVAL' && approverRole(c.service_id) === 'head';
    a.approve = decide;
    a.reject = decide;
  }
  return a;
}

/** Attachments visibility (DECISIONS §18): head all · officer own dept, current step or already passed. */
function canSeeFiles(user, c) {
  if (!user) return false;
  if (user.role === 'head') return true;
  if (user.role !== 'officer') return false;
  if (user.dept === 'registry') return true; // every service starts at registry
  if (user.dept === 'works') return c.service_id === 'SV-03' && (c.dept === 'works' || Number(c.step || 0) >= 2);
  return false;
}

// ---------------------------------------------------------------- queue

/**
 * Queue rows (BR-16: due ASC, case number ASC). Officer: own department · head: every department (read-only).
 * filter: all · unclaimed (SUBMITTED/IN_REVIEW without holder) · mine (IN_REVIEW held by me).
 */
function queueRows(user, filter) {
  const f = ['all', 'unclaimed', 'mine'].includes(filter) ? filter : 'all';
  const where = [`c.status IN (${QUEUE_STATUSES.map(() => '?').join(',')})`, 'c.dept IS NOT NULL'];
  const params = [...QUEUE_STATUSES];
  if (user.role === 'officer') { where.push('c.dept = ?'); params.push(user.dept || ''); }
  if (f === 'unclaimed') where.push("c.status IN ('SUBMITTED','IN_REVIEW') AND c.owner IS NULL");
  if (f === 'mine') { where.push("c.status = 'IN_REVIEW' AND c.owner = ?"); params.push(user.username); }
  const rows = db.prepare(`
    SELECT c.*, z.name AS applicant_name, z.id_enc AS applicant_id_enc
    FROM cases c JOIN citizens z ON z.id = c.citizen_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.due_at ASC, c.case_no ASC`).all(...params);
  const now = clock.nowIso();
  const holidays = holidaySet();
  return rows.map((c) => {
    const idNo = decryptId(c.applicant_id_enc);
    return {
      row: c,
      caseNo: c.case_no,
      serviceId: c.service_id,
      applicantName: c.applicant_name,
      idMasked: fmt.maskId(idNo),
      idNoFull: idNo, // never sent unless BUG_MODE=B09
      status: c.status,
      step: c.service_id === 'SV-03' ? (c.step || 1) : null,
      dept: c.dept,
      owner: c.owner || null,
      dueAt: c.due_at,
      slaLevel: slaLevelOf(c, now, holidays),
      canClaim: user.role === 'officer' && CLAIMABLE.includes(c.status) && !c.owner && c.dept === user.dept,
    };
  });
}

/** JSON items for GET /api/officer/queue — never idNo / 13 digits (BR-24) unless B09. */
function queueApiItems(user, filter) {
  return queueRows(user, filter).map((r) => {
    const item = {
      caseNo: r.caseNo, serviceId: r.serviceId, applicantName: r.applicantName, idMasked: r.idMasked,
      status: r.status, step: r.step, dept: r.dept, owner: r.owner, dueAt: r.dueAt, slaLevel: r.slaLevel,
    };
    if (bug('B09')) item.idNo = r.idNoFull; // B09: API leaks full ID (screen still masked)
    return item;
  });
}

/** PENDING_APPROVAL rows for /head/approvals (BR-16 order). */
function approvalRows() {
  return db.prepare(`
    SELECT c.*, z.name AS applicant_name
    FROM cases c JOIN citizens z ON z.id = c.citizen_id
    WHERE c.status = 'PENDING_APPROVAL'
    ORDER BY c.due_at ASC, c.case_no ASC`).all().map((c) => ({
    row: c,
    caseNo: c.case_no,
    serviceId: c.service_id,
    applicantName: c.applicant_name,
    step: c.service_id === 'SV-03' ? (c.step || 3) : null,
    dueAt: c.due_at,
  }));
}

// ---------------------------------------------------------------- actions

/** POST /api/officer/cases/:caseNo/claim — order: permission → ALREADY_CLAIMED → WORKLOAD_LIMIT. */
const claim = db.transaction((caseNo, user) => {
  if (user.role !== 'officer') throw new ApiError('FORBIDDEN');
  const c = loadCase(caseNo);
  if (c.dept && c.dept !== user.dept) throw new ApiError('FORBIDDEN');            // other department's queue
  if (!CLAIMABLE.includes(c.status)) {
    if (c.status === 'NEED_FIX' && c.owner) throw new ApiError('ALREADY_CLAIMED'); // still held while waiting for the citizen
    throw new ApiError('INVALID_STATE');                                            // head stage / approved / closed
  }
  if (c.owner === user.username) throw new ApiError('ALREADY_CLAIMED');           // own case (B08 too)
  if (c.owner && !bug('B08')) throw new ApiError('ALREADY_CLAIMED');              // B08: skips "already held"
  if (workload(user.username) >= WORKLOAD_LIMIT) throw new ApiError('WORKLOAD_LIMIT');

  const now = clock.nowIso();
  // Registry claim of the first step makes this officer the document issuer (A-27).
  const issuer = c.dept === 'registry' && Number(c.step || 1) <= 1 ? user.username : c.issuer;
  const guard = bug('B08') ? '' : ' AND owner IS NULL';
  const info = db.prepare(`UPDATE cases SET status = 'IN_REVIEW', owner = ?, issuer = ?, updated_at = ?
    WHERE case_no = ? AND status IN ('SUBMITTED','IN_REVIEW')${guard}`).run(user.username, issuer, now, c.case_no);
  if (info.changes !== 1) throw new ApiError('ALREADY_CLAIMED');
  addEvent(c, user, 'CLAIM', c.status, 'IN_REVIEW', c.step, null, { dept: c.dept }, now);
  logAudit({ user, event: 'CLAIM', caseNo: c.case_no, fromStatus: c.status, toStatus: 'IN_REVIEW', time: now });
  return { owner: user.username, status: 'IN_REVIEW', caseNo: c.case_no };
}).immediate;

/** Holder check shared by return / forward: officer + holder → else 403 · status IN_REVIEW → else 409. */
function requireHolder(c, user) {
  if (user.role !== 'officer' || c.owner !== user.username) throw new ApiError('FORBIDDEN');
  if (c.status !== 'IN_REVIEW') throw new ApiError('INVALID_STATE');
}

/** POST /api/officer/cases/:caseNo/return {reason} — ≥10 chars · ≤2 times · fix window +168 h. */
const returnCase = db.transaction((caseNo, user, body) => {
  const c = loadCase(caseNo);
  requireHolder(c, user);
  if (c.return_count >= RETURN_LIMIT && !bug('B12')) throw new ApiError('RETURN_LIMIT');
  const reason = requireReason(body && body.reason);

  const now = clock.nowIso();
  const fixDeadline = clock.toIso(clock.toMs(now) + FIX_WINDOW_MS);
  const count = c.return_count + 1;
  const info = db.prepare(`UPDATE cases SET status = 'NEED_FIX', return_count = ?, returned_at = ?, fix_deadline = ?,
    updated_at = ? WHERE case_no = ? AND status = 'IN_REVIEW' AND owner = ?`)
    .run(count, now, fixDeadline, now, c.case_no, user.username);
  if (info.changes !== 1) throw new ApiError('INVALID_STATE');
  addEvent(c, user, 'RETURN', 'IN_REVIEW', 'NEED_FIX', c.step, reason, { returnCount: count, fixDeadline }, now);
  logAudit({ user, event: 'RETURN', caseNo: c.case_no, fromStatus: 'IN_REVIEW', toStatus: 'NEED_FIX', detail: reason, time: now });
  return { status: 'NEED_FIX', returnCount: count, fixDeadline };
}).immediate;

/**
 * POST /api/officer/cases/:caseNo/forward {note?} — automatic routing (DECISIONS §3, no target choice):
 *   SV-02 registry → head · SV-03 step 1 registry → step 2 works (unclaimed) · step 2 works → step 3 head.
 */
const forward = db.transaction((caseNo, user, body) => {
  const c = loadCase(caseNo);
  requireHolder(c, user);
  const service = SERVICES[c.service_id];
  if (!service || service.approver !== 'head') throw new ApiError('INVALID_STATE'); // SV-01 is decided by the officer
  const note = typeof (body && body.note) === 'string' ? body.note.trim().slice(0, 500) : '';

  const now = clock.nowIso();
  let next;
  if (c.service_id === 'SV-03' && Number(c.step || 1) <= 1) {
    next = { status: 'IN_REVIEW', step: 2, dept: 'works', owner: null };
  } else {
    next = { status: 'PENDING_APPROVAL', step: c.service_id === 'SV-03' ? 3 : null, dept: null, owner: firstHead() };
  }
  const issuer = c.issuer || (c.dept === 'registry' ? user.username : null);
  const info = db.prepare(`UPDATE cases SET status = ?, step = ?, dept = ?, owner = ?, issuer = ?, updated_at = ?
    WHERE case_no = ? AND status = 'IN_REVIEW' AND owner = ?`)
    .run(next.status, next.step, next.dept, next.owner, issuer, now, c.case_no, user.username);
  if (info.changes !== 1) throw new ApiError('INVALID_STATE');
  addEvent(c, user, 'FORWARD', 'IN_REVIEW', next.status, next.step, note, { fromDept: c.dept, toDept: next.dept }, now);
  logAudit({ user, event: 'FORWARD', caseNo: c.case_no, fromStatus: 'IN_REVIEW', toStatus: next.status, detail: note, time: now });
  const out = { status: next.status };
  if (next.step != null) out.step = next.step;
  return out;
}).immediate;

/**
 * Who may decide (approve / reject): SV-01 → the holding officer while IN_REVIEW (head → 403) ·
 * SV-02/03 → head while PENDING_APPROVAL (officer → 403; BUG B07 lets an officer APPROVE anyway).
 */
function checkDecider(c, user, action) {
  if (approverRole(c.service_id) === 'officer') {
    if (user.role !== 'officer') throw new ApiError('FORBIDDEN');
    if (c.status !== 'IN_REVIEW') throw new ApiError('INVALID_STATE');
    if (c.owner !== user.username) throw new ApiError('FORBIDDEN');
    return;
  }
  if (user.role === 'head') {
    if (c.status !== 'PENDING_APPROVAL') throw new ApiError('INVALID_STATE');
    return;
  }
  if (action === 'approve' && bug('B07') && user.role === 'officer') {
    if (!['PENDING_APPROVAL', 'IN_REVIEW'].includes(c.status)) throw new ApiError('INVALID_STATE');
    return; // B07: no head-only check on the API
  }
  throw new ApiError('FORBIDDEN');
}

/** POST /api/cases/:caseNo/approve */
const approve = db.transaction((caseNo, user) => {
  const c = loadCase(caseNo);
  checkDecider(c, user, 'approve');
  const now = clock.nowIso();
  // Back to the registry queue, unheld, waiting for the issuer (A-27; seed …000019 has the same shape).
  const issuer = c.issuer || (c.dept === 'registry' ? c.owner : null) || (user.role === 'officer' ? user.username : null);
  const info = db.prepare(`UPDATE cases SET status = 'APPROVED', approver = ?, approved_at = ?, owner = NULL,
    dept = 'registry', issuer = ?, updated_at = ? WHERE case_no = ? AND status = ?`)
    .run(user.username, now, issuer, now, c.case_no, c.status);
  if (info.changes !== 1) throw new ApiError('INVALID_STATE');
  addEvent(c, user, 'APPROVE', c.status, 'APPROVED', c.step, null, null, now);
  logAudit({ user, event: 'APPROVE', caseNo: c.case_no, fromStatus: c.status, toStatus: 'APPROVED', time: now });
  return { status: 'APPROVED' };
}).immediate;

/** POST /api/cases/:caseNo/reject {reason} */
const reject = db.transaction((caseNo, user, body) => {
  const c = loadCase(caseNo);
  checkDecider(c, user, 'reject');
  const reason = requireReason(body && body.reason);
  const now = clock.nowIso();
  const info = db.prepare(`UPDATE cases SET status = 'REJECTED', closed_at = ?, reject_reason = ?, owner = NULL, dept = NULL,
    updated_at = ? WHERE case_no = ? AND status = ?`).run(now, reason, now, c.case_no, c.status);
  if (info.changes !== 1) throw new ApiError('INVALID_STATE');
  addEvent(c, user, 'REJECT', c.status, 'REJECTED', c.step, reason, null, now);
  logAudit({ user, event: 'REJECT', caseNo: c.case_no, fromStatus: c.status, toStatus: 'REJECTED', detail: reason, time: now });
  return { status: 'REJECTED', closedAt: now };
}).immediate;

/** POST /api/officer/cases/:caseNo/unmask {reason} — officer/head · reason required · Audit UNMASK (B11 skips it). */
function unmask(caseNo, user, body) {
  if (user.role !== 'officer' && user.role !== 'head') throw new ApiError('FORBIDDEN');
  const c = loadCase(caseNo);
  const reason = trimmed(body && body.reason);
  if (!reason) throw new ApiError('REASON_REQUIRED');
  const idNo = fmt.digitsOnly(decryptId(c.applicant_id_enc));
  if (!bug('B11')) {
    logAudit({ user, event: 'UNMASK', caseNo: c.case_no, detail: reason.slice(0, 500) });
  }
  return { idNo };
}

// ---------------------------------------------------------------- page data

const EVENT_TEXT = {
  SUBMITTED: 'ชำระเงินและส่งคำขอแล้ว',
  CLAIM: 'รับเรื่อง',
  RETURN: 'ตีกลับให้แก้ไขเอกสาร',
  RESUBMIT: 'ประชาชนส่งแก้ไขแล้ว',
  FORWARD: 'ผ่าน/ส่งต่อ',
  APPROVE: 'อนุมัติ',
  REJECT: 'ไม่อนุมัติ',
  ISSUE: 'ออกเอกสาร',
  CANCEL: 'ประชาชนยกเลิกคำขอ',
  AUTO_CANCEL: 'ยกเลิกอัตโนมัติ (เลยเวลาแก้ไข)',
};

function stepText(c) {
  if (c.service_id !== 'SV-03') return null;
  const step = Number(c.step || 1);
  if (step >= 3) return 'ขั้นตอน 3/3 · หัวหน้าฝ่าย';
  if (step === 2) return 'ขั้นตอน 2/3 · ฝ่ายโยธา';
  return 'ขั้นตอน 1/3 · ฝ่ายทะเบียน';
}

/** Everything /officer/cases/:caseNo renders. Never contains the full ID (TC-PDPA-01 greps the HTML). */
function caseView(caseNo, user) {
  const c = loadCase(caseNo);
  const now = clock.nowIso();
  const idNo = decryptId(c.applicant_id_enc);
  const events = db.prepare('SELECT * FROM case_events WHERE case_no = ? ORDER BY time ASC, id ASC').all(c.case_no)
    .map((e) => ({
      time: e.time,
      event: e.event,
      text: EVENT_TEXT[e.event] || e.event,
      actor: e.actor && e.actor !== 'system' ? e.actor : null,
      note: e.note || '',
      fromStatus: e.from_status,
      toStatus: e.to_status,
    }));
  const files = canSeeFiles(user, c)
    ? db.prepare('SELECT id, name, doc_key, size FROM files WHERE case_no = ? ORDER BY created_at ASC, rowid ASC').all(c.case_no)
    : [];
  const doc = db.prepare('SELECT doc_no, verify_code, issued_at, valid_until, signer FROM documents WHERE case_no = ? ORDER BY issued_at DESC LIMIT 1')
    .get(c.case_no) || null;
  const lastReturn = db.prepare("SELECT note FROM case_events WHERE case_no = ? AND event = 'RETURN' ORDER BY time DESC, id DESC LIMIT 1")
    .get(c.case_no);
  return {
    c,
    caseNo: c.case_no,
    serviceId: c.service_id,
    serviceName: fmt.serviceName(c.service_id),
    stepText: stepText(c),
    applicantName: c.applicant_name,
    idMasked: fmt.maskId(idNo),
    slaLevel: slaLevelOf(c, now, holidaySet()),
    owner: c.owner,
    returnCount: c.return_count,
    events,
    files,
    filesHidden: !canSeeFiles(user, c),
    doc,
    lastReturnReason: c.status === 'NEED_FIX' && lastReturn ? lastReturn.note : null,
    actions: actionsFor(user, c),
    workload: user.role === 'officer' ? workload(user.username) : null,
  };
}

// ---------------------------------------------------------------- staff JSON (CONTRACT §6.7 — idMasked only, never idNo)

/** GET /api/cases/:caseNo for officer/head (fallback; citizen JSON belongs to the citizen module). */
function staffCaseJson(caseNo) {
  const c = loadCase(caseNo);
  const doc = db.prepare('SELECT doc_no, verify_code FROM documents WHERE case_no = ? ORDER BY issued_at DESC LIMIT 1').get(c.case_no);
  return {
    caseNo: c.case_no,
    serviceId: c.service_id,
    status: c.status,
    step: c.service_id === 'SV-03' ? Number(c.step || 1) : null,
    fee: c.fee,
    paidAt: c.paid_at,
    dueAt: c.due_at,
    slaLevel: slaLevelOf(c, clock.nowIso(), holidaySet()),
    owner: c.owner || null,
    returnCount: c.return_count,
    closedAt: c.closed_at || null,
    applicantName: c.applicant_name,
    idMasked: fmt.maskId(decryptId(c.applicant_id_enc)),
    fixDeadline: c.status === 'NEED_FIX' ? c.fix_deadline : null,
    docNo: doc ? doc.doc_no : null,
    verifyCode: doc ? doc.verify_code : null,
  };
}

/** GET /api/cases/:caseNo/files for officer/head: 403 outside DECISIONS §18 scope. */
function staffFiles(caseNo, user) {
  const c = loadCase(caseNo);
  if (!canSeeFiles(user, c)) throw new ApiError('FORBIDDEN');
  return db.prepare('SELECT id, name, doc_key, size FROM files WHERE case_no = ? ORDER BY created_at ASC, rowid ASC')
    .all(c.case_no).map((f) => ({ fileId: f.id, name: f.name, docKey: f.doc_key, size: f.size }));
}

/** GET /api/files/:fileId for officer/head: 404 unknown / not attached to a case · 403 outside scope. */
function staffFile(fileId, user) {
  const f = db.prepare('SELECT id, case_no, name, mime, size, data FROM files WHERE id = ?').get(String(fileId || ''));
  if (!f || !f.case_no) throw new ApiError('NOT_FOUND');
  const c = loadCase(f.case_no);
  if (!canSeeFiles(user, c)) throw new ApiError('FORBIDDEN');
  return f;
}

module.exports = {
  WORKLOAD_LIMIT, RETURN_LIMIT,
  queueRows, queueApiItems, approvalRows, workload,
  claim, returnCase, forward, approve, reject, unmask,
  caseView, actionsFor, canSeeFiles, isIssuer,
  staffCaseJson, staffFiles, staffFile,
};
