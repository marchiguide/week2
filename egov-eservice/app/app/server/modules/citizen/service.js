'use strict';
/**
 * Citizen side (block B05): drafts, attachments, simulated PromptPay QR, payment callback, my cases,
 * cancel, resubmit, attachment download permissions.
 *
 * CONTRACT §1 §2.4–2.6 §4 §5 §6.2 §6.7 §8 · DECISIONS §3 §4 §5 §6 §7 §9 §11 §18 · BUGS B02 B05 B06.
 *
 * Every state change runs inside one IMMEDIATE transaction (better-sqlite3 is synchronous, so concurrent
 * HTTP requests are serialised; conditional UPDATEs are the second guard). Numbers come from lib/counters.
 *
 * Draft lifecycle (table drafts.status):
 *   DRAFT → PENDING_PAYMENT (first QR: fee recomputed from the current catalogue and LOCKED, A-42)
 *         → SUBMITTED (paid: case_no set) · DELETED (citizen deleted it: payments VOID, files removed)
 * Payment rows (payments.status): PENDING · PAID · EXPIRED (superseded by a newer QR) · VOID (draft deleted).
 *   A PENDING row whose age ≥ 15:00 is reported as EXPIRED (computed from the clock, never stored).
 */
const { db } = require('../../lib/db');
const clock = require('../../lib/clock');
const { bug } = require('../../lib/bugs');
const { ApiError } = require('../../lib/errors');
const counters = require('../../lib/counters');
const crypto = require('../../lib/crypto');
const fmt = require('../../lib/format');
const codes = require('../../lib/codes');
const upload = require('../../lib/upload');
const rules = require('../../rules');

const QR_TTL_MS = 15 * 60 * 1000;               // A-15: payable while age < 15:00
const OPEN_DRAFT = ['DRAFT', 'PENDING_PAYMENT'];
const EXTRA_KEY = 'extra';

// ---------------------------------------------------------------- small helpers

function serviceRow(serviceId) {
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!row) throw new ApiError('BAD_REQUEST', {}, 'ไม่พบบริการ');
  return row;
}

function serviceDef(serviceId) {
  return codes.SERVICES[serviceId] || null;
}

function docKeysOf(serviceId) {
  return serviceDef(serviceId).docs.map((d) => d.key).concat(EXTRA_KEY);
}

function holidaySet() {
  return new Set(db.prepare('SELECT date FROM holidays').pluck().all());
}

function slaLevelOf(row, nowIso, holidays) {
  try {
    return rules.slaLevel({ status: row.status, due_at: row.due_at }, nowIso, holidays);
  } catch (_) {
    return codes.CLOSED_STATUSES.includes(row.status) ? 'closed' : 'normal';
  }
}

function decryptId(enc) {
  try { return crypto.decrypt(enc) || ''; } catch (_) { return ''; }
}

function pad4(n) { return String(n).padStart(4, '0'); }

function isBlank(v) { return v === undefined || v === null || (typeof v === 'string' && v.trim() === ''); }

/** Raw user input for the fee rule of a service (SV-01 qty default 1, A-56). */
function feeInput(serviceId, body) {
  if (serviceId === 'SV-01') return { qty: body.qty === undefined || body.qty === null ? 1 : body.qty };
  if (serviceId === 'SV-03') {
    const a = body.areaSqm !== undefined ? body.areaSqm : body.area;
    return { areaSqm: a === undefined ? null : a };
  }
  return {};
}

/** Fee from rules/ with the CURRENT catalogue row; throws INVALID_QTY / INVALID_AREA / AREA_TOO_LARGE. */
function computeFee(serviceId, input) {
  const svc = serviceRow(serviceId);
  if (serviceId === 'SV-01') return rules.fee('SV-01', isBlank(input.qty) ? NaN : input.qty, svc);
  if (serviceId === 'SV-03') return rules.fee('SV-03', isBlank(input.areaSqm) ? NaN : input.areaSqm, svc);
  return rules.fee(serviceId, null, svc);
}

function toInt(v) {
  if (isBlank(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * Precomputed fee table for the wizard page (keeps the page in sync with rules/, incl. BUG_MODE B01):
 * {valid: {value: fee}, min, max, errorBelow, errorAbove, errorInvalid} for SV-01 / SV-03, {flat} for SV-02.
 */
function feeTable(serviceId) {
  const svc = serviceRow(serviceId);
  const tryFee = (v) => {
    try { return { fee: rules.fee(serviceId, v, svc) }; } catch (e) { return { error: e.message, code: e.code }; }
  };
  if (serviceId === 'SV-02') return { flat: tryFee(null).fee };
  const max = serviceId === 'SV-01' ? 5 : 500;
  const valid = {};
  for (let v = 1; v <= max; v++) {
    const r = tryFee(v);
    if (r.fee !== undefined) valid[v] = r.fee;
  }
  const below = tryFee(0);
  const above = tryFee(max + 1);
  const invalid = tryFee(NaN);
  return {
    valid,
    min: 1,
    max,
    errorBelow: below.error || '',
    errorAbove: above.error || '',
    errorInvalid: invalid.error || below.error || '',
  };
}

// ---------------------------------------------------------------- drafts

function draftFiles(draftId) {
  return db.prepare(
    'SELECT id, name, doc_key, size, mime FROM files WHERE draft_id = ? ORDER BY created_at ASC, rowid ASC'
  ).all(draftId).map(fileJson);
}

function fileJson(f) {
  return { fileId: f.id, name: f.name, docKey: f.doc_key, size: f.size };
}

/** Names of required documents still missing, in CONTRACT §4.3 order. */
function missingDocs(serviceId, files) {
  const have = new Set(files.map((f) => f.docKey));
  return serviceDef(serviceId).docs.filter((d) => d.required && !have.has(d.key)).map((d) => d.name);
}

/** Fee shown for a draft: the locked amount, or (still a DRAFT) the fee with the current catalogue. */
function currentDraftFee(d) {
  if (d.fee_locked) return d.fee;
  try { return computeFee(d.service_id, { qty: d.qty, areaSqm: d.area_sqm }); } catch (_) { return d.fee; }
}

function latestPayment(draftId) {
  return db.prepare(
    "SELECT * FROM payments WHERE draft_id = ? AND status != 'VOID' ORDER BY qr_created_at DESC, rowid DESC LIMIT 1"
  ).get(draftId) || null;
}

function draftJson(d, opts = {}) {
  const files = draftFiles(d.draft_id);
  const p = latestPayment(d.draft_id);
  const out = {
    draftId: d.draft_id,
    serviceId: d.service_id,
    serviceName: fmt.serviceName(d.service_id),
    status: d.status,
    qty: d.qty,
    areaSqm: d.area_sqm,
    fee: currentDraftFee(d),
    feeLocked: !!d.fee_locked,
    caseNo: d.case_no || null,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    files,
    missing: missingDocs(d.service_id, files),
    payment: p ? paymentJson(p, opts.nowMs) : null,
  };
  return out;
}

/** Own draft (any status except DELETED) or 404 NOT_FOUND — same answer for "missing" and "someone else's". */
function getOwnDraft(citizenId, draftId) {
  const d = db.prepare("SELECT * FROM drafts WHERE draft_id = ? AND status != 'DELETED'").get(String(draftId || ''));
  if (!d || d.citizen_id !== citizenId) throw new ApiError('NOT_FOUND');
  return d;
}

function listDrafts(citizenId) {
  return db.prepare(
    "SELECT * FROM drafts WHERE citizen_id = ? AND status IN ('DRAFT','PENDING_PAYMENT') ORDER BY draft_id ASC"
  ).all(citizenId).map((d) => ({
    draftId: d.draft_id,
    serviceId: d.service_id,
    serviceName: fmt.serviceName(d.service_id),
    status: d.status,
    fee: currentDraftFee(d),
    qty: d.qty,
    areaSqm: d.area_sqm,
    updatedAt: d.updated_at,
  }));
}

const createDraft = db.transaction((citizenId, body) => {
  const serviceId = String((body && body.serviceId) || '');
  if (!serviceDef(serviceId)) throw new ApiError('BAD_REQUEST', {}, 'ไม่พบบริการ');
  const input = feeInput(serviceId, body || {});
  const fee = computeFee(serviceId, input);
  const draftId = `DR-${pad4(counters.next('draft'))}`;
  const now = clock.nowIso();
  db.prepare(`INSERT INTO drafts (draft_id, citizen_id, service_id, status, qty, area_sqm, fee, fee_locked, created_at, updated_at)
    VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, 0, ?, ?)`)
    .run(draftId, citizenId, serviceId,
      serviceId === 'SV-01' ? toInt(input.qty) : null,
      serviceId === 'SV-03' ? toInt(input.areaSqm) : null,
      fee, now, now);
  return { draftId, fee, serviceId, status: 'DRAFT' };
}).immediate;

/** PATCH a DRAFT's input (qty / areaSqm). Locked drafts (PENDING_PAYMENT) cannot change. */
const updateDraft = db.transaction((citizenId, draftId, body) => {
  const d = getOwnDraft(citizenId, draftId);
  if (d.status !== 'DRAFT') throw new ApiError('INVALID_STATE');
  const merged = {
    qty: body && body.qty !== undefined ? body.qty : d.qty,
    areaSqm: body && (body.areaSqm !== undefined || body.area !== undefined)
      ? (body.areaSqm !== undefined ? body.areaSqm : body.area) : d.area_sqm,
  };
  const fee = computeFee(d.service_id, merged);
  db.prepare('UPDATE drafts SET qty = ?, area_sqm = ?, fee = ?, updated_at = ? WHERE draft_id = ?')
    .run(d.service_id === 'SV-01' ? toInt(merged.qty) : null,
      d.service_id === 'SV-03' ? toInt(merged.areaSqm) : null,
      fee, clock.nowIso(), d.draft_id);
  return { draftId: d.draft_id, fee, serviceId: d.service_id, status: d.status };
}).immediate;

/** DELETE draft: DRAFT / unpaid PENDING_PAYMENT only. Its payment refs become 404 (VOID). */
const deleteDraft = db.transaction((citizenId, draftId) => {
  const d = getOwnDraft(citizenId, draftId);
  if (!OPEN_DRAFT.includes(d.status)) throw new ApiError('INVALID_STATE');
  const now = clock.nowIso();
  db.prepare("UPDATE drafts SET status = 'DELETED', updated_at = ? WHERE draft_id = ?").run(now, d.draft_id);
  db.prepare("UPDATE payments SET status = 'VOID' WHERE draft_id = ? AND status != 'PAID'").run(d.draft_id);
  db.prepare('DELETE FROM files WHERE draft_id = ? AND case_no IS NULL').run(d.draft_id);
}).immediate;

// ---------------------------------------------------------------- files

function cleanName(name) {
  const base = String(name || 'file').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  return (base || 'file').slice(0, 200);
}

/**
 * Validate one uploaded file (multer object). Order: size → type (magic bytes only, A-49) → plan PDF only.
 * B02: a file of exactly 5,242,880 bytes is rejected (< instead of ≤).
 * @returns {string} detected mime type
 */
function validateFile(file, docKey) {
  const size = file.size != null ? file.size : (file.buffer ? file.buffer.length : 0);
  const tooLarge = bug('B02') ? size >= codes.MAX_FILE_BYTES : size > codes.MAX_FILE_BYTES;
  if (tooLarge) throw new ApiError('FILE_TOO_LARGE');
  const mime = upload.sniff(file.buffer);
  if (!mime) throw new ApiError('FILE_TYPE');
  if (docKey === 'plan' && mime !== 'application/pdf') throw new ApiError('PLAN_NOT_PDF');
  return mime;
}

function newFileId() {
  return `F-${String(counters.next('file')).padStart(6, '0')}`;
}

const insertFile = (row) => db.prepare(`INSERT INTO files (id, draft_id, case_no, citizen_id, doc_key, name, mime, size, data, created_at)
  VALUES (@id, @draftId, @caseNo, @citizenId, @docKey, @name, @mime, @size, @data, @createdAt)`).run(row);

const addDraftFile = db.transaction((citizenId, draftId, file, docKeyRaw) => {
  const d = getOwnDraft(citizenId, draftId);
  if (d.status !== 'DRAFT') throw new ApiError('INVALID_STATE');
  if (!file || !file.buffer) throw new ApiError('BAD_REQUEST', {}, 'กรุณาเลือกไฟล์');
  const docKey = String(docKeyRaw || '').trim();
  if (!docKeysOf(d.service_id).includes(docKey)) throw new ApiError('BAD_REQUEST', {}, 'ประเภทเอกสารไม่ถูกต้อง');
  const mime = validateFile(file, docKey);
  const count = db.prepare('SELECT COUNT(*) FROM files WHERE draft_id = ?').pluck().get(d.draft_id);
  if (count >= codes.MAX_FILES_PER_CASE) throw new ApiError('FILE_COUNT');
  const row = {
    id: newFileId(), draftId: d.draft_id, caseNo: null, citizenId, docKey,
    name: cleanName(file.originalname), mime, size: file.buffer.length, data: file.buffer, createdAt: clock.nowIso(),
  };
  insertFile(row);
  db.prepare('UPDATE drafts SET updated_at = ? WHERE draft_id = ?').run(row.createdAt, d.draft_id);
  return { fileId: row.id, name: row.name, docKey, size: row.size };
}).immediate;

const removeDraftFile = db.transaction((citizenId, draftId, fileId) => {
  const d = getOwnDraft(citizenId, draftId);
  if (d.status !== 'DRAFT') throw new ApiError('INVALID_STATE');
  const info = db.prepare('DELETE FROM files WHERE id = ? AND draft_id = ? AND case_no IS NULL').run(String(fileId || ''), d.draft_id);
  if (!info.changes) throw new ApiError('NOT_FOUND', {}, 'ไม่พบไฟล์');
}).immediate;

// ---------------------------------------------------------------- payments (simulated PromptPay)

function paymentStatus(p, nowMs = clock.nowMs()) {
  if (p.status === 'PAID') return 'PAID';
  if (p.status === 'EXPIRED' || p.status === 'VOID') return 'EXPIRED';
  const age = nowMs - clock.toMs(p.qr_created_at);
  const expired = bug('B05') ? age > QR_TTL_MS : age >= QR_TTL_MS;
  return expired ? 'EXPIRED' : 'PENDING';
}

function paymentJson(p, nowMs) {
  return {
    ref: p.ref,
    amount: p.amount,
    status: paymentStatus(p, nowMs),
    qrCreatedAt: p.qr_created_at,
    qrExpiresAt: p.qr_expires_at,
    caseNo: p.case_no || null,
    receiptNo: p.receipt_no || null,
    paidAt: p.paid_at || null,
    draftId: p.draft_id,
  };
}

/** POST /api/drafts/:id/payment — new QR (always a new ref). Locks the fee when entering PENDING_PAYMENT. */
const createPayment = db.transaction((citizenId, draftId) => {
  const d = getOwnDraft(citizenId, draftId);
  if (!OPEN_DRAFT.includes(d.status)) throw new ApiError('INVALID_STATE');
  const missing = missingDocs(d.service_id, draftFiles(d.draft_id));
  if (missing.length) throw new ApiError('MISSING_DOCS', { missing }, `ยังขาดเอกสาร: ${missing.join(', ')}`);

  const now = clock.nowIso();
  let amount = d.fee;
  if (!d.fee_locked) {
    amount = computeFee(d.service_id, { qty: d.qty, areaSqm: d.area_sqm });
    db.prepare("UPDATE drafts SET fee = ?, fee_locked = 1, status = 'PENDING_PAYMENT', updated_at = ? WHERE draft_id = ?")
      .run(amount, now, d.draft_id);
  } else if (d.status !== 'PENDING_PAYMENT') {
    db.prepare("UPDATE drafts SET status = 'PENDING_PAYMENT', updated_at = ? WHERE draft_id = ?").run(now, d.draft_id);
  }
  // A new QR supersedes older unpaid ones of this draft (never two payable refs for one draft).
  db.prepare("UPDATE payments SET status = 'EXPIRED' WHERE draft_id = ? AND status = 'PENDING'").run(d.draft_id);

  const ref = `PP-${pad4(counters.next('payment'))}`;
  const createdMs = clock.toMs(now);
  const expires = clock.toIso(createdMs + QR_TTL_MS);
  db.prepare(`INSERT INTO payments (ref, draft_id, citizen_id, amount, status, qr_created_at, qr_expires_at, created_at)
    VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)`).run(ref, d.draft_id, citizenId, amount, now, expires, now);
  return { ref, amount, qrCreatedAt: now, qrExpiresAt: expires, status: 'PENDING' };
}).immediate;

/** GET /api/payments/:ref (owner only; deleted-draft refs → 404). */
function getPayment(citizenId, ref) {
  const p = db.prepare('SELECT * FROM payments WHERE ref = ?').get(String(ref || ''));
  if (!p || p.status === 'VOID' || p.citizen_id !== citizenId) throw new ApiError('NOT_FOUND', {}, 'ไม่พบรายการชำระเงิน');
  return paymentJson(p);
}

/** Payment ref for the QR picture (owner only). */
function getOwnPaymentRow(citizenId, ref) {
  const p = db.prepare('SELECT * FROM payments WHERE ref = ?').get(String(ref || ''));
  if (!p || p.status === 'VOID' || p.citizen_id !== citizenId) return null;
  return p;
}

function parseAmount(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return NaN;
}

/**
 * POST /api/test/payments/:ref/pay — simulated bank callback.
 *   404 unknown/void ref · duplicate PAID → 200 duplicate:true (same numbers) · age ≥ 15:00 → 410 QR_EXPIRED
 *   (B05: > 15:00) · amount ≠ locked fee → 422 AMOUNT_MISMATCH · else case EG-<BE of payment time>-n.
 */
const payByRef = db.transaction((ref, rawAmount) => {
  const p = db.prepare('SELECT * FROM payments WHERE ref = ?').get(String(ref || ''));
  if (!p || p.status === 'VOID') throw new ApiError('NOT_FOUND', {}, 'ไม่พบรายการชำระเงิน');
  if (p.status === 'PAID') {
    return { status: 'PAID', caseNo: p.case_no, receiptNo: p.receipt_no, duplicate: true };
  }
  const nowMs = clock.nowMs();
  if (paymentStatus(p, nowMs) === 'EXPIRED') throw new ApiError('QR_EXPIRED');
  const amount = parseAmount(rawAmount);
  if (!Number.isFinite(amount) || amount !== p.amount) throw new ApiError('AMOUNT_MISMATCH');

  const d = db.prepare('SELECT * FROM drafts WHERE draft_id = ?').get(p.draft_id);
  if (!d || d.status === 'DELETED') throw new ApiError('NOT_FOUND', {}, 'ไม่พบรายการชำระเงิน');
  if (d.status !== 'PENDING_PAYMENT') throw new ApiError('INVALID_STATE');

  const paidAt = clock.toIso(nowMs);
  const be = clock.beYear(paidAt);
  const n = counters.next(`case:${be}`);
  const caseNo = counters.formatSeq('EG', be, n);
  const receiptNo = counters.formatSeq('RC', be, n); // A-48: receipt sequence = case sequence
  if (counters.peek(`receipt:${be}`) < n) counters.set(`receipt:${be}`, n);

  const svc = serviceRow(d.service_id);
  const dueAt = rules.dueAt(paidAt, Number(svc.sla));
  const step = d.service_id === 'SV-03' ? 1 : null;

  db.prepare(`INSERT INTO cases (case_no, draft_id, service_id, citizen_id, qty, area_sqm, fee, form_json, status, step, dept,
      owner, return_count, paid_at, payment_ref, receipt_no, due_at, created_at, updated_at)
    VALUES (@caseNo, @draftId, @serviceId, @citizenId, @qty, @areaSqm, @fee, @formJson, 'SUBMITTED', @step, 'registry',
      NULL, 0, @paidAt, @ref, @receiptNo, @dueAt, @paidAt, @paidAt)`).run({
    caseNo, draftId: d.draft_id, serviceId: d.service_id, citizenId: d.citizen_id, qty: d.qty, areaSqm: d.area_sqm,
    fee: p.amount, formJson: d.form_json, step, paidAt, ref: p.ref, receiptNo, dueAt,
  });
  db.prepare("UPDATE payments SET status = 'PAID', paid_at = ?, case_no = ?, receipt_no = ? WHERE ref = ?")
    .run(paidAt, caseNo, receiptNo, p.ref);
  db.prepare("UPDATE payments SET status = 'EXPIRED' WHERE draft_id = ? AND status = 'PENDING' AND ref != ?").run(d.draft_id, p.ref);
  db.prepare("UPDATE drafts SET status = 'SUBMITTED', case_no = ?, updated_at = ? WHERE draft_id = ?").run(caseNo, paidAt, d.draft_id);
  db.prepare('UPDATE files SET case_no = ? WHERE draft_id = ?').run(caseNo, d.draft_id);
  db.prepare(`INSERT INTO case_events (case_no, time, actor, actor_role, event, from_status, to_status, step, data_json)
    VALUES (?, ?, 'citizen', 'citizen', 'SUBMITTED', NULL, 'SUBMITTED', ?, ?)`)
    .run(caseNo, paidAt, step, JSON.stringify({ ref: p.ref, receiptNo, amount: p.amount }));
  return { status: 'PAID', caseNo, receiptNo, duplicate: false };
}).immediate;

// ---------------------------------------------------------------- cases

function loadCase(caseNo) {
  return db.prepare(`
    SELECT c.*, z.name AS applicant_name, z.id_enc AS applicant_id_enc
    FROM cases c JOIN citizens z ON z.id = c.citizen_id
    WHERE c.case_no = ?`).get(String(caseNo || '')) || null;
}

/** Citizen may see a case only when it is theirs (B06: ownership not checked → IDOR). */
function citizenOwns(user, c) {
  return !!c && !!user && user.kind === 'citizen' && c.citizen_id === user.citizenId;
}
function citizenCanView(user, c) {
  return !!c && (citizenOwns(user, c) || bug('B06'));
}

function stepOf(c) {
  return c.service_id === 'SV-03' ? Number(c.step || 1) : null;
}

function stepText(c) {
  const s = stepOf(c);
  if (s == null) return null;
  if (s >= 3) return 'ขั้นตอน 3/3 · หัวหน้าฝ่าย';
  if (s === 2) return 'ขั้นตอน 2/3 · ฝ่ายโยธา';
  return 'ขั้นตอน 1/3 · ฝ่ายทะเบียน';
}

function documentOf(caseNo) {
  return db.prepare(
    'SELECT doc_no, verify_code, issued_at, valid_until, signer FROM documents WHERE case_no = ? ORDER BY issued_at DESC LIMIT 1'
  ).get(caseNo) || null;
}

function lastReturnReason(c) {
  const r = db.prepare("SELECT note FROM case_events WHERE case_no = ? AND event = 'RETURN' ORDER BY time DESC, id DESC LIMIT 1")
    .get(c.case_no);
  return r ? (r.note || '') : '';
}

/** CONTRACT §6.7. Citizen viewer → idNo (full); officer/head → idMasked only (never idNo). */
function caseJson(c, user, nowIso = clock.nowIso(), holidays) {
  const idNo = decryptId(c.applicant_id_enc);
  const doc = documentOf(c.case_no);
  const out = {
    caseNo: c.case_no,
    serviceId: c.service_id,
    status: c.status,
    step: stepOf(c),
    fee: c.fee,
    paidAt: c.paid_at,
    dueAt: c.due_at,
    slaLevel: slaLevelOf(c, nowIso, holidays),
    owner: c.owner || null,
    returnCount: c.return_count || 0,
    closedAt: c.closed_at || null,
    applicantName: c.applicant_name,
  };
  if (user && user.kind === 'citizen') out.idNo = idNo;
  else out.idMasked = fmt.maskId(idNo);
  out.fixDeadline = c.status === 'NEED_FIX' ? (c.fix_deadline || null) : null;
  out.docNo = doc ? doc.doc_no : null;
  out.verifyCode = doc ? doc.verify_code : null;
  out.receiptNo = c.receipt_no || null;
  out.cancelledAt = c.cancelled_at || null;
  if (c.service_id === 'SV-01') out.qty = c.qty;
  if (c.service_id === 'SV-03') out.areaSqm = c.area_sqm;
  if (user && user.kind === 'citizen' && c.status === 'NEED_FIX') out.returnReason = lastReturnReason(c);
  return out;
}

function listMyCases(citizenId) {
  const now = clock.nowIso();
  const holidays = holidaySet();
  return db.prepare(
    'SELECT case_no, service_id, status, due_at, fee, paid_at, step FROM cases WHERE citizen_id = ? ORDER BY case_no DESC'
  ).all(citizenId).map((c) => ({
    caseNo: c.case_no,
    serviceId: c.service_id,
    status: c.status,
    dueAt: c.due_at,
    slaLevel: slaLevelOf(c, now, holidays),
    fee: c.fee,
    paidAt: c.paid_at,
  }));
}

/** Cancel: only SUBMITTED without holder (A-11). Conditional UPDATE wins/loses atomically against a claim. */
const cancelCase = db.transaction((user, caseNo) => {
  const c = loadCase(caseNo);
  if (!citizenOwns(user, c)) throw new ApiError('NOT_FOUND');
  const now = clock.nowIso();
  const info = db.prepare(`UPDATE cases SET status = 'CANCELLED', cancelled_at = ?, updated_at = ?, owner = NULL, dept = NULL
    WHERE case_no = ? AND status = 'SUBMITTED' AND owner IS NULL`).run(now, now, c.case_no);
  if (!info.changes) throw new ApiError('CANNOT_CANCEL');
  db.prepare(`INSERT INTO case_events (case_no, time, actor, actor_role, event, from_status, to_status, step, note)
    VALUES (?, ?, 'citizen', 'citizen', 'CANCEL', 'SUBMITTED', 'CANCELLED', ?, ?)`)
    .run(c.case_no, now, c.step == null ? null : c.step, 'ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
  return { status: 'CANCELLED', cancelledAt: now };
}).immediate;

/** Same rule as the SLA hook (A-46): NEED_FIX whose fix_deadline ≤ now is cancelled AT the deadline. */
function autoCancelIfExpired(c, nowIso) {
  if (c.status !== 'NEED_FIX' || !c.fix_deadline || nowIso < c.fix_deadline) return false;
  const info = db.prepare(`UPDATE cases SET status = 'CANCELLED', cancelled_at = fix_deadline, updated_at = fix_deadline,
      owner = NULL, dept = NULL WHERE case_no = ? AND status = 'NEED_FIX'`).run(c.case_no);
  if (info.changes) {
    db.prepare(`INSERT INTO case_events (case_no, time, actor, actor_role, event, from_status, to_status, step)
      VALUES (?, ?, 'system', 'system', 'AUTO_CANCEL', 'NEED_FIX', 'CANCELLED', ?)`)
      .run(c.case_no, c.fix_deadline, c.step == null ? null : c.step);
  }
  return true;
}

function wasAutoCancelled(c) {
  if (c.status !== 'CANCELLED') return false;
  if (c.fix_deadline && c.cancelled_at === c.fix_deadline) return true;
  return !!db.prepare("SELECT 1 FROM case_events WHERE case_no = ? AND event = 'AUTO_CANCEL' LIMIT 1").get(c.case_no);
}

function lastReturnTime(c) {
  if (c.returned_at) return c.returned_at;
  const r = db.prepare("SELECT time FROM case_events WHERE case_no = ? AND event = 'RETURN' ORDER BY time DESC, id DESC LIMIT 1")
    .get(c.case_no);
  return r ? r.time : null;
}

/** Resolve the docKey of a file sent with resubmit (field name, body.docKey, else "extra"). */
function resubmitDocKey(c, file, body) {
  const keys = docKeysOf(c.service_id);
  if (keys.includes(file.fieldname)) return file.fieldname;
  const fromBody = body && typeof body.docKey === 'string' ? body.docKey.trim() : '';
  if (keys.includes(fromBody)) return fromBody;
  return EXTRA_KEY;
}

/**
 * Resubmit after NEED_FIX (multipart files optional). Before the 168 h deadline → IN_REVIEW, back to the
 * same holder, dueAt extended by the business days in (returned, now] (rules.extendDue · B04 there).
 * At/after the deadline → auto-cancelled → 409 FIX_WINDOW_EXPIRED.
 * Returns {error} instead of throwing when the auto-cancel must be committed.
 */
const resubmitTx = db.transaction((user, caseNo, files, body) => {
  const c = loadCase(caseNo);
  if (!citizenOwns(user, c)) throw new ApiError('NOT_FOUND');
  const now = clock.nowIso();
  if (autoCancelIfExpired(c, now)) return { error: 'FIX_WINDOW_EXPIRED' };
  if (wasAutoCancelled(c)) return { error: 'FIX_WINDOW_EXPIRED' };
  if (c.status !== 'NEED_FIX') throw new ApiError('INVALID_STATE');

  const prepared = (files || []).map((f) => {
    const docKey = resubmitDocKey(c, f, body);
    return { f, docKey, mime: validateFile(f, docKey) };
  });
  if (prepared.length) {
    const have = db.prepare('SELECT COUNT(*) FROM files WHERE case_no = ?').pluck().get(c.case_no);
    if (have + prepared.length > codes.MAX_FILES_PER_CASE) throw new ApiError('FILE_COUNT');
  }

  const returnedAt = lastReturnTime(c) || now;
  const dueAt = rules.extendDue(c.due_at, returnedAt, now);
  const info = db.prepare(`UPDATE cases SET status = 'IN_REVIEW', due_at = ?, updated_at = ?
    WHERE case_no = ? AND status = 'NEED_FIX'`).run(dueAt, now, c.case_no);
  if (!info.changes) throw new ApiError('INVALID_STATE');

  for (const { f, docKey, mime } of prepared) {
    insertFile({
      id: newFileId(), draftId: c.draft_id || null, caseNo: c.case_no, citizenId: c.citizen_id, docKey,
      name: cleanName(f.originalname), mime, size: f.buffer.length, data: f.buffer, createdAt: now,
    });
  }
  const pausedDays = rules.businessDaysLeft(returnedAt, now);
  db.prepare(`INSERT INTO case_events (case_no, time, actor, actor_role, event, from_status, to_status, step, data_json)
    VALUES (?, ?, 'citizen', 'citizen', 'RESUBMIT', 'NEED_FIX', 'IN_REVIEW', ?, ?)`)
    .run(c.case_no, now, c.step == null ? null : c.step,
      JSON.stringify({ pausedDays, files: prepared.length, previousDueAt: c.due_at }));
  return { status: 'IN_REVIEW', dueAt };
}).immediate;

function resubmit(user, caseNo, files, body) {
  const r = resubmitTx(user, caseNo, files, body);
  if (r.error) throw new ApiError(r.error);
  return r;
}

// ---------------------------------------------------------------- attachments permission (DECISIONS §18)

/**
 * 'ok' | 'notfound' | 'forbidden'
 *   citizen: own case only (others → 404) · head: every department ·
 *   officer: own department, current step or already passed (registry = every service's first step;
 *   works = SV-03 at/after step 2) · executive/auditor/admin: 403.
 */
function fileAccess(user, c) {
  if (!user) return 'forbidden';
  if (user.kind === 'citizen') return citizenOwns(user, c) ? 'ok' : 'notfound';
  if (user.role === 'head') return 'ok';
  if (user.role !== 'officer') return 'forbidden';
  if (user.dept === 'registry') return 'ok';
  if (user.dept === 'works') {
    return c.service_id === 'SV-03' && (c.dept === 'works' || Number(c.step || 0) >= 2) ? 'ok' : 'forbidden';
  }
  return 'forbidden';
}

function caseFiles(caseNo) {
  return db.prepare(
    'SELECT id, name, doc_key, size, mime FROM files WHERE case_no = ? ORDER BY created_at ASC, rowid ASC'
  ).all(caseNo).map(fileJson);
}

function fileRow(fileId) {
  return db.prepare('SELECT * FROM files WHERE id = ?').get(String(fileId || '')) || null;
}

/** Access for one stored file: case files follow fileAccess(); draft-only files belong to the citizen. */
function fileRowAccess(user, f) {
  if (f.case_no) {
    const c = loadCase(f.case_no);
    if (!c) return 'notfound';
    return fileAccess(user, c);
  }
  if (user.kind === 'citizen') return f.citizen_id === user.citizenId ? 'ok' : 'notfound';
  return 'forbidden';
}

// ---------------------------------------------------------------- page models

const EVENT_TEXT = {
  SUBMITTED: 'ชำระเงินและส่งคำขอแล้ว',
  CLAIM: 'เจ้าหน้าที่รับเรื่อง',
  RETURN: 'ตีกลับให้แก้ไขเอกสาร',
  RESUBMIT: 'ส่งแก้ไขเอกสารแล้ว',
  FORWARD: 'ผ่านการตรวจ ส่งต่อขั้นถัดไป',
  APPROVE: 'อนุมัติ',
  REJECT: 'ไม่อนุมัติ',
  ISSUE: 'ออกเอกสารแล้ว',
  CANCEL: 'ยกเลิกคำขอ',
  AUTO_CANCEL: 'ยกเลิกอัตโนมัติ (เลยเวลาแก้ไข 7 วัน)',
};

function timeline(c) {
  return db.prepare('SELECT * FROM case_events WHERE case_no = ? ORDER BY time ASC, id ASC').all(c.case_no).map((e) => ({
    time: e.time,
    event: e.event,
    text: EVENT_TEXT[e.event] || e.event,
    // citizens see reasons for return/reject only (internal forward notes stay internal)
    note: (e.event === 'RETURN' || e.event === 'REJECT') ? (e.note || '') : '',
    toStatus: e.to_status,
  }));
}

/** Everything /citizen/cases/:caseNo renders. */
function caseView(c, user) {
  const now = clock.nowIso();
  const idNo = decryptId(c.applicant_id_enc);
  const doc = documentOf(c.case_no);
  const fixOpen = c.status === 'NEED_FIX' && (!c.fix_deadline || now < c.fix_deadline);
  return {
    c,
    caseNo: c.case_no,
    status: c.status,
    statusText: fmt.statusText(c.status),
    serviceId: c.service_id,
    serviceText: `${c.service_id} ${fmt.serviceName(c.service_id)}`,
    stepText: stepText(c),
    fee: c.fee,
    dueAt: c.due_at,
    slaLevel: slaLevelOf(c, now, holidaySet()),
    closedAt: ['COMPLETED', 'REJECTED'].includes(c.status) ? c.closed_at : null,
    idFull: fmt.formatId(idNo),
    applicantName: c.applicant_name,
    files: fileAccess(user, c) === 'ok' ? caseFiles(c.case_no) : [],
    events: timeline(c),
    doc,
    canCancel: c.status === 'SUBMITTED' && !c.owner && citizenOwns(user, c),
    needFix: c.status === 'NEED_FIX',
    returnReason: c.status === 'NEED_FIX' ? lastReturnReason(c) : '',
    fixDeadline: c.status === 'NEED_FIX' ? c.fix_deadline : null,
    canResubmit: fixOpen && citizenOwns(user, c),
    noRefund: c.status === 'REJECTED' || c.status === 'CANCELLED',
    rejectReason: c.status === 'REJECTED' ? (c.reject_reason || '') : '',
    receiptNo: c.receipt_no,
    paidAt: c.paid_at,
    qty: c.qty,
    areaSqm: c.area_sqm,
    docKeys: docKeysOf(c.service_id).map((k) => ({ key: k, name: k === EXTRA_KEY ? 'เอกสารเพิ่มเติม' : fmt.docName(k) })),
  };
}

/** Initial step of the wizard for a draft (no draft / DRAFT → 1 · PENDING_PAYMENT / SUBMITTED → 3). */
function wizardStep(d) {
  if (!d) return 1;
  return d.status === 'DRAFT' ? 1 : 3;
}

module.exports = {
  QR_TTL_MS, EXTRA_KEY,
  serviceDef, serviceRow, feeTable, computeFee,
  createDraft, updateDraft, deleteDraft, getOwnDraft, draftJson, listDrafts, draftFiles, missingDocs,
  addDraftFile, removeDraftFile, validateFile,
  createPayment, getPayment, getOwnPaymentRow, payByRef, paymentJson,
  loadCase, citizenOwns, citizenCanView, caseJson, listMyCases, cancelCase, resubmit,
  fileAccess, caseFiles, fileRow, fileRowAccess,
  caseView, wizardStep, holidaySet, stepText,
};
