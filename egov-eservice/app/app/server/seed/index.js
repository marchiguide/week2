'use strict';

const crypto = require('../lib/crypto');
const clock = require('../lib/clock');
const { SERVICES } = require('../lib/codes');
const { cases, returns } = require('./case-data');

const PASSWORD = 'Test@1234';

const STAFF = [
  ['off.reg1', 'เจ้าหน้าที่ทะเบียน 1', 'officer', 'registry'],
  ['off.reg2', 'เจ้าหน้าที่ทะเบียน 2', 'officer', 'registry'],
  ['off.works1', 'เจ้าหน้าที่โยธา 1', 'officer', 'works'],
  ['head1', 'หัวหน้าฝ่าย', 'head', null],
  ['exec1', 'ผู้บริหาร', 'executive', null],
  ['audit1', 'ผู้ตรวจสอบภายใน', 'auditor', null],
  ['admin1', 'ผู้ดูแลระบบ', 'admin', null],
];

// [key, idNo, name, mobile, registered]
const CITIZENS = [
  ['somchai', '1101700123456', 'สมชาย ใจดี', '0812345678', 1],
  ['somying', '3100600987659', 'สมหญิง รักไทย', '0823456789', 1],
  ['mana', '5500400111221', 'มานะ ตั้งใจ', null, 0],
  ['piti', '1909900555015', 'ปิติ มีสุข', '0834567890', 1],
];

const SERVICE_FEES_AND_SLA = [
  ['SV-01', 20, null, 3, 1],
  ['SV-02', 500, null, 10, 2],
  ['SV-03', 1000, 10, 15, 3],
];

const HOLIDAYS = [
  ['2026-12-07', 'ชดเชยวันหยุดทดสอบ (สมมติ)'],
  ['2026-12-10', 'วันรัฐธรรมนูญทดสอบ (สมมติ)'],
  ['2026-12-31', 'วันสิ้นปีทดสอบ (สมมติ)'],
  ['2027-01-01', 'วันขึ้นปีใหม่ทดสอบ (สมมติ)'],
];

// The fixture contains Bangkok wall-clock times with minute precision.
function fixtureIso(value) {
  return value ? value.replace(' ', 'T') + ':00+07:00' : null;
}

function seedAccounts(db, now) {
  const passwordHash = crypto.hashPasswordCached(PASSWORD);
  const insertStaff = db.prepare('INSERT INTO users (username, password_hash, name, role, dept, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [username, name, role, dept] of STAFF) {
    insertStaff.run(username, passwordHash, name, role, dept, now);
  }

  const insertCitizen = db.prepare(
    "INSERT INTO citizens (id_hash, id_enc, name, mobile_enc, email, registered, consent_at, registered_at, created_at) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)"
  );
  const citizenIds = new Map();
  for (const [key, idNo, name, mobile, registered] of CITIZENS) {
    const registeredAt = registered ? '2026-10-01T09:00:00+07:00' : null;
    const { lastInsertRowid } = insertCitizen.run(
      crypto.blindIndex(idNo), crypto.encrypt(idNo), name, crypto.encrypt(mobile), registered,
      registeredAt, registeredAt, registeredAt || now
    );
    citizenIds.set(key, lastInsertRowid);
  }
  return citizenIds;
}

function seedCatalog(db, now) {
  const insertService = db.prepare('INSERT INTO services (id, name, fee_type, fee, fee_per_sqm, sla, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const [id, fee, feePerSqm, sla, sortOrder] of SERVICE_FEES_AND_SLA) {
    const { name, feeType } = SERVICES[id];
    insertService.run(id, name, feeType, fee, feePerSqm, sla, sortOrder, now);
  }

  const insertHoliday = db.prepare('INSERT INTO holidays (date, name, created_at) VALUES (?, ?, ?)');
  for (const [date, name] of HOLIDAYS) insertHoliday.run(date, name, now);
}

// Build a one-page PDF synchronously so the BLOB can be inserted in the reset transaction.
function attachmentPdf(name) {
  const stream = 'BT /F1 14 Tf 20 100 Td (Seed attachment: ' + name + ') Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + 'endstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (const offset of offsets) pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(pdf, 'ascii');
}

function prepareAttachmentSeeder(db) {
  const insert = db.prepare(
    "INSERT INTO files (id, draft_id, case_no, citizen_id, doc_key, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?)"
  );
  const pdfs = new Map();
  return (serviceId, citizenId, createdAt, draftId, caseNo) => {
    for (const { key, required } of SERVICES[serviceId].docs) {
      if (!required) continue;
      const name = key + '.pdf';
      if (!pdfs.has(key)) pdfs.set(key, attachmentPdf(name));
      const data = pdfs.get(key);
      const fileId = 'seed-' + (caseNo || draftId) + '-' + key;
      insert.run(fileId, draftId, caseNo, citizenId, key, name, data.length, data, createdAt);
    }
  };
}

function seedTimeline(insert, row, history, worksReviewer) {
  const { caseNo, serviceId, status, paidAt, owner, issuer, approver, approvedAt, closedAt, cancelledAt } = row;
  const firstStep = serviceId === 'SV-03' ? 1 : null;
  function add(event, time, actor, actorRole, fromStatus, toStatus, step = firstStep, note = null, data = null) {
    insert.run(caseNo, time, actor, actorRole, event, fromStatus, toStatus, step, note, data && JSON.stringify(data));
  }

  add('SUBMITTED', paidAt, 'citizen', 'citizen', null, 'SUBMITTED');

  // Where no historical workflow timestamp is supplied, use the payment timestamp.
  if (issuer) add('CLAIM', paidAt, issuer, 'officer', 'SUBMITTED', 'IN_REVIEW');
  if (row.step === 2 || worksReviewer) {
    add('FORWARD', paidAt, issuer, 'officer', 'IN_REVIEW', 'IN_REVIEW', 2, null, { fromDept: 'registry', toDept: 'works' });
  }
  if (worksReviewer) add('CLAIM', paidAt, worksReviewer, 'officer', 'IN_REVIEW', 'IN_REVIEW', 2);
  if (status === 'PENDING_APPROVAL' || status === 'APPROVED') {
    add('FORWARD', paidAt, worksReviewer || issuer, 'officer', 'IN_REVIEW', 'PENDING_APPROVAL', row.step, null, {
      fromDept: worksReviewer ? 'works' : 'registry', toDept: null,
    });
  }
  if (approvedAt) add('APPROVE', approvedAt, approver, 'head', 'PENDING_APPROVAL', 'APPROVED', row.step);

  history.forEach(([returnedAt, resubmittedAt, pausedDays, reason], index) => {
    add('RETURN', fixtureIso(returnedAt), owner, 'officer', 'IN_REVIEW', 'NEED_FIX', row.step, reason, { returnCount: index + 1 });
    if (resubmittedAt) {
      add('RESUBMIT', fixtureIso(resubmittedAt), 'citizen', 'citizen', 'NEED_FIX', 'IN_REVIEW', row.step, null, { pausedDays });
    }
  });

  if (status === 'COMPLETED') add('ISSUE', closedAt, issuer || 'system', issuer ? 'officer' : 'system', 'APPROVED', status, row.step);
  if (status === 'REJECTED') add('REJECT', closedAt, 'system', 'system', 'IN_REVIEW', status, row.step);
  if (cancelledAt) add('CANCEL', cancelledAt, 'citizen', 'citizen', 'SUBMITTED', status);
}

function seedCases(db, citizenIds, attachFiles) {
  const insertCase = db.prepare(
    'INSERT INTO cases (case_no, service_id, citizen_id, qty, area_sqm, fee, status, step, dept, owner, issuer, approver, approved_at, ' +
    'return_count, returned_at, fix_deadline, paid_at, payment_ref, receipt_no, due_at, closed_at, cancelled_at, created_at, updated_at) ' +
    'VALUES (@caseNo, @serviceId, @citizenId, @qty, @areaSqm, @fee, @status, @step, @dept, @owner, @issuer, @approver, @approvedAt, ' +
    '@returnCount, @returnedAt, @fixDeadline, @paidAt, @paymentRef, @receiptNo, @dueAt, @closedAt, @cancelledAt, @paidAt, @updatedAt)'
  );
  const insertEvent = db.prepare(
    'INSERT INTO case_events (case_no, time, actor, actor_role, event, from_status, to_status, step, note, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertPaidPayment = db.prepare(
    "INSERT INTO payments (ref, draft_id, citizen_id, amount, status, qr_created_at, qr_expires_at, paid_at, case_no, receipt_no, created_at) " +
    "VALUES (@paymentRef, @legacyDraftRef, @citizenId, @fee, 'PAID', @paidAt, @qrExpiresAt, @paidAt, @caseNo, @receiptNo, @paidAt)"
  );
  const registryStatuses = new Set(['SUBMITTED', 'IN_REVIEW', 'NEED_FIX', 'APPROVED']);

  for (const [number, label, applicant, serviceId, input, fee, status, paid, due, details = {}] of cases) {
    const suffix = '2569-' + String(number).padStart(6, '0');
    const caseNo = 'EG-' + suffix;
    const receiptNo = 'RC-' + suffix;
    const paidAt = fixtureIso(paid);
    const dept = details.dept || (registryStatuses.has(status) ? 'registry' : null);
    const owner = details.owner ?? null;
    const issuer = details.issuer ?? (dept === 'registry' ? owner : null);
    const history = returns[label] || [];
    const [lastReturn, lastResubmit] = history.at(-1) || [];
    const row = {
      caseNo, serviceId, citizenId: citizenIds.get(applicant),
      qty: serviceId === 'SV-01' ? input : null,
      areaSqm: serviceId === 'SV-03' ? input : null,
      fee, status, step: details.step ?? null, dept, owner, issuer,
      approver: details.approver ?? null, approvedAt: fixtureIso(details.approvedAt),
      returnCount: details.returnCount ?? 0, returnedAt: fixtureIso(details.returnedAt), fixDeadline: fixtureIso(details.fixDeadline),
      paidAt, paymentRef: 'SEED-' + receiptNo, receiptNo, dueAt: fixtureIso(due),
      closedAt: fixtureIso(details.closedAt), cancelledAt: fixtureIso(details.cancelledAt),
      updatedAt: fixtureIso(lastResubmit || lastReturn || details.approvedAt || details.closedAt || details.cancelledAt) || paidAt,
    };
    insertCase.run(row);
    seedTimeline(insertEvent, row, history, details.worksReviewer);
    attachFiles(serviceId, row.citizenId, paidAt, null, caseNo);

    // Imported payments carry their receipt numbers and use references outside the new QR sequence.
    insertPaidPayment.run({
      ...row, legacyDraftRef: 'SEED-' + caseNo, qrExpiresAt: clock.toIso(clock.toMs(paidAt) + 15 * 60 * 1000),
    });
  }
}

function seedDrafts(db, citizenId, attachFiles) {
  const createdAt = '2026-12-01T08:55:00+07:00';
  const expiresAt = '2026-12-01T09:10:00+07:00';
  const insertDraft = db.prepare(
    'INSERT INTO drafts (draft_id, citizen_id, service_id, status, qty, fee, fee_locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertDraft.run('DR-0001', citizenId, 'SV-01', 'DRAFT', 2, 40, 0, createdAt, createdAt);
  insertDraft.run('DR-0002', citizenId, 'SV-02', 'PENDING_PAYMENT', null, 500, 1, createdAt, createdAt);
  attachFiles('SV-02', citizenId, createdAt, 'DR-0002', null);
  db.prepare(
    "INSERT INTO payments (ref, draft_id, citizen_id, amount, status, qr_created_at, qr_expires_at, created_at) VALUES ('PP-0001', 'DR-0002', ?, 500, 'PENDING', ?, ?, ?)"
  ).run(citizenId, createdAt, expiresAt, createdAt);
}

function seedDocument(db) {
  const document = {
    docNo: 'DOC-2569-000001',
    caseNo: 'EG-2569-000005',
    verifyCode: 'K7M2Q9XA',
    applicant: 'สมชาย ใจดี',
    serviceId: 'SV-01',
    issuedAt: '2026-11-05T10:00:00+07:00',
    validUntil: '2027-02-02',
    signer: 'เจ้าหน้าที่ทะเบียน 1',
    issuedBy: 'off.reg1',
  };
  db.prepare(
    'INSERT INTO documents (doc_no, case_no, verify_code, applicant, service_id, issued_at, valid_until, signer, signature, issued_by, created_at) ' +
    'VALUES (@docNo, @caseNo, @verifyCode, @applicant, @serviceId, @issuedAt, @validUntil, @signer, @signature, @issuedBy, @issuedAt)'
  ).run({ ...document, signature: crypto.signDocument(document) });
}

// lib/reset.js calls seed after clearing all tables, inside the same transaction.
module.exports = function seed(db) {
  const now = clock.nowIso();
  const citizenIds = seedAccounts(db, now);
  seedCatalog(db, now);

  const attachFiles = prepareAttachmentSeeder(db);
  seedCases(db, citizenIds, attachFiles);
  seedDrafts(db, citizenIds.get('somchai'), attachFiles);
  seedDocument(db);

  const setCounter = db.prepare('INSERT INTO counters (name, value) VALUES (?, ?)');
  for (const [name, value] of [['case:2569', 30], ['receipt:2569', 30], ['doc:2569', 1], ['draft', 2], ['payment', 1]]) {
    setCounter.run(name, value);
  }
};
