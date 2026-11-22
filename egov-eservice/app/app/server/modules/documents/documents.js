'use strict';

const { db } = require('../../lib/db');
const clock = require('../../lib/clock');
const counters = require('../../lib/counters');
const { randomCode, signDocument, verifyDocumentSignature } = require('../../lib/crypto');
const { ApiError } = require('../../lib/errors');
const { logAudit } = require('../../lib/audit');
const { maskName } = require('../../lib/format');

const DOCUMENT_FIELDS = `d.doc_no AS docNo, d.case_no AS caseNo, d.verify_code AS verifyCode,
  d.applicant, d.service_id AS serviceId, d.issued_at AS issuedAt, d.valid_until AS validUntil, d.signer`;

function isIssuer(caseRow, user) {
  const issuer = caseRow.service_id === 'SV-01' ? caseRow.approver || caseRow.owner : caseRow.issuer;
  return user?.role === 'officer' && user.dept === 'registry' && user.username === issuer;
}

function lastValidDay(serviceId, issuedAt) {
  const { dateKey, year, month, day } = clock.parts(issuedAt);
  if (serviceId === 'SV-01') return clock.addDaysKey(dateKey, 89);

  // When the next year has no February 29, the anniversary is February 28 (A-58).
  const anniversaryDay = month === 2 && day === 29 ? 28 : day;
  const anniversary = clock.dateKey(clock.fromBkk(year + 1, month, anniversaryDay));
  return clock.addDaysKey(anniversary, -1);
}

const issue = db.transaction((caseNo, user) => {
  const caseRow = db.prepare(`
    SELECT c.*, citizen.name AS applicant, approver.name AS signer
    FROM cases c
    JOIN citizens citizen ON citizen.id = c.citizen_id
    LEFT JOIN users approver ON approver.username = c.approver
    WHERE c.case_no = ?
  `).get(caseNo);
  if (!caseRow) throw new ApiError('NOT_FOUND');
  if (!isIssuer(caseRow, user)) throw new ApiError('FORBIDDEN');
  if (caseRow.status !== 'APPROVED' || !caseRow.signer) throw new ApiError('INVALID_STATE');

  const issuedAt = clock.nowIso();
  const year = clock.beYear(issuedAt);
  const docNo = counters.formatSeq('DOC', year, counters.next(`doc:${year}`));
  const codeExists = db.prepare('SELECT 1 FROM documents WHERE verify_code = ?');
  let verifyCode = randomCode();
  while (codeExists.get(verifyCode)) verifyCode = randomCode();

  const document = {
    docNo, caseNo, verifyCode, issuedAt,
    applicant: caseRow.applicant,
    serviceId: caseRow.service_id,
    validUntil: lastValidDay(caseRow.service_id, issuedAt),
    signer: caseRow.signer,
  };
  db.prepare(`
    INSERT INTO documents (doc_no, case_no, verify_code, applicant, service_id, issued_at,
      valid_until, signer, signature, issued_by, created_at)
    VALUES (@docNo, @caseNo, @verifyCode, @applicant, @serviceId, @issuedAt,
      @validUntil, @signer, @signature, @issuedBy, @issuedAt)
  `).run({ ...document, signature: signDocument(document), issuedBy: user.username });

  db.prepare(`
    UPDATE cases SET status = 'COMPLETED', closed_at = ?, updated_at = ?, owner = NULL, dept = NULL
    WHERE case_no = ?
  `).run(issuedAt, issuedAt, caseNo);
  db.prepare(`
    INSERT INTO case_events (case_no, time, actor, actor_role, event, from_status, to_status, step, data_json)
    VALUES (?, ?, ?, ?, 'ISSUE', 'APPROVED', 'COMPLETED', ?, ?)
  `).run(caseNo, issuedAt, user.username, user.role, caseRow.step, JSON.stringify({ docNo }));
  logAudit({
    user, caseNo, event: 'ISSUE', time: issuedAt,
    fromStatus: 'APPROVED', toStatus: 'COMPLETED', detail: docNo,
  });
  return { docNo, verifyCode, status: 'COMPLETED' };
}).immediate;

function verify(code) {
  const document = db.prepare(`
    SELECT ${DOCUMENT_FIELDS}, d.signature FROM documents d WHERE d.verify_code = ?
  `).get(code);
  if (!document) return { result: 'NOT_FOUND' };
  if (!verifyDocumentSignature(document, document.signature)) return { result: 'TAMPERED' };

  const { docNo, applicant, serviceId, issuedAt, validUntil, signer } = document;
  const name = applicant.trim().replace(/\s+/gu, ' ');
  return {
    result: clock.dateKey(clock.now()) > validUntil ? 'EXPIRED' : 'VALID',
    docNo, applicantMasked: name.includes(' ') ? maskName(name) : `${name} ***`,
    serviceId, issuedAt, validUntil, signer,
  };
}

function findForDownload(docNo) {
  return db.prepare(`
    SELECT ${DOCUMENT_FIELDS}, c.citizen_id AS citizenId
    FROM documents d JOIN cases c ON c.case_no = d.case_no
    WHERE d.doc_no = ?
  `).get(docNo);
}

function verificationUrl(req, code) {
  const origin = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return new URL(`/verify/${encodeURIComponent(code)}`, origin).href;
}

module.exports = { issue, isIssuer, verify, findForDownload, verificationUrl };
