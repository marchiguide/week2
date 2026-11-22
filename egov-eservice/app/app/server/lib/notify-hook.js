'use strict';

const { db } = require('./db');
const clock = require('./clock');
const { LEVEL } = require('./codes');
const { slaLevel } = require('../rules');
const { isIssuer } = require('../modules/documents/documents');

// The deadline is the effective cancellation time, even if the next request arrives later.
const cancelExpired = db.prepare(`
  UPDATE cases
  SET status = 'CANCELLED', cancelled_at = fix_deadline, updated_at = fix_deadline,
      owner = NULL, dept = NULL
  WHERE status = 'NEED_FIX' AND fix_deadline <= ?
  RETURNING case_no, cancelled_at, step
`);
const recordCancellation = db.prepare(`
  INSERT INTO case_events (case_no, time, actor, actor_role, event, from_status, to_status, step)
  VALUES (?, ?, 'system', 'system', 'AUTO_CANCEL', 'NEED_FIX', 'CANCELLED', ?)
`);
const activeCases = db.prepare(`
  SELECT case_no, status, due_at, service_id, dept, owner, issuer, approver
  FROM cases
  WHERE status IN ('SUBMITTED', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED')
    AND due_at IS NOT NULL
  ORDER BY case_no
`);
const activeStaff = db.prepare(`
  SELECT username, role, dept FROM users WHERE active = 1 AND role IN ('officer', 'head')
`);
const holidayDates = db.prepare('SELECT date FROM holidays').pluck();
const countNotifications = db.prepare('SELECT COUNT(*) FROM notifications WHERE recipient = ?').pluck();
const insertNotification = db.prepare(`
  INSERT INTO notifications (recipient, case_no, level, text, created_at)
  SELECT @recipient, @caseNo, @level, @text, @createdAt
  WHERE NOT EXISTS (
    SELECT 1 FROM notifications WHERE recipient = @recipient AND case_no = @caseNo AND level = @level
  )
`);

function recipientsFor(caseRow, level, staff, heads) {
  let recipients;
  if (caseRow.status === 'PENDING_APPROVAL') {
    recipients = heads.includes(caseRow.owner) ? [caseRow.owner] : heads;
  } else if (caseRow.status === 'APPROVED') {
    recipients = staff.filter((user) => isIssuer(caseRow, user)).map((user) => user.username);
  } else if (caseRow.owner) {
    recipients = staff.filter((user) => user.username === caseRow.owner).map((user) => user.username);
  } else {
    recipients = staff.filter((user) => user.role === 'officer' && user.dept === caseRow.dept)
      .map((user) => user.username);
  }

  return new Set(level === 'overdue' ? [...recipients, ...heads] : recipients);
}

const evaluate = db.transaction((now) => {
  const createdAt = clock.toIso(now);
  for (const { case_no, cancelled_at, step } of cancelExpired.all(createdAt)) {
    recordCancellation.run(case_no, cancelled_at, step);
  }

  const staff = activeStaff.all();
  const heads = staff.filter((user) => user.role === 'head').map((user) => user.username);
  const holidays = new Set(holidayDates.all());
  for (const caseRow of activeCases.all()) {
    const level = slaLevel(caseRow, now, holidays);
    if (level !== 'near' && level !== 'overdue') continue;

    const caseNo = caseRow.case_no;
    const text = `คำขอ ${caseNo} ${LEVEL[level]}`;
    for (const recipient of recipientsFor(caseRow, level, staff, heads)) {
      insertNotification.run({ recipient, caseNo, level, text, createdAt });
    }
  }
});

function run() {
  evaluate.immediate(clock.nowMs());
}

function bellCount(user) {
  return countNotifications.get(user.username);
}

module.exports = { run, bellCount };
