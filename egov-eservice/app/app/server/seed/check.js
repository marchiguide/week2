'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../lib/config');

const composeDbPath = path.resolve(config.appRoot, '..', 'data', 'egov.db');
const dbPath = !process.env.DB_PATH && !fs.existsSync(config.dbPath) ? composeDbPath : config.dbPath;

const backlogStatuses = "'SUBMITTED', 'IN_REVIEW', 'NEED_FIX', 'PENDING_APPROVAL', 'APPROVED'";
const resetTime = '2026-12-01T09:00:00+07:00';

// TEST-DATA §7. Period, service, received, closed, on time, on-time %, backlog, overdue.
const dashboardExpected = [
  ['2026-12', 'ALL',   3, 0, 0, '–',      21, 1],
  ['2026-12', 'SV-01', 3, 0, 0, '–',      11, 1],
  ['2026-12', 'SV-02', 0, 0, 0, '–',       7, 0],
  ['2026-12', 'SV-03', 0, 0, 0, '–',       3, 0],
  ['2026-11', 'ALL',  26, 7, 6, '85.7%',  21, 1],
  ['2026-11', 'SV-01',12, 3, 3, '100.0%', 11, 1],
  ['2026-11', 'SV-02',10, 3, 2, '66.7%',   7, 0],
  ['2026-11', 'SV-03', 4, 1, 1, '100.0%',  3, 0],
  ['2026-10', 'ALL',   1, 1, 1, '100.0%', 21, 1],
  ['2026',    'ALL',  30, 8, 7, '87.5%',  21, 1],
  ['2026',    'SV-01',16, 4, 4, '100.0%', 11, 1],
  ['2026',    'SV-02',10, 3, 2, '66.7%',   7, 0],
  ['2026',    'SV-03', 4, 1, 1, '100.0%',  3, 0],
];

function checkDashboard(db) {
  const totals = db.prepare(
    'WITH metrics AS (' +
    '  SELECT substr(paid_at, 1, length(@period)) = @period AS received, ' +
    "    status IN ('COMPLETED', 'REJECTED') AND substr(closed_at, 1, length(@period)) = @period AS closed, " +
    '    closed_at <= due_at AS ontime, status IN (' + backlogStatuses + ') AS backlog, ' +
    "    status <> 'NEED_FIX' AND due_at < @now AS overdue " +
    "  FROM cases WHERE @service = 'ALL' OR service_id = @service" +
    ') SELECT COUNT(*) FILTER (WHERE received) AS received, COUNT(*) FILTER (WHERE closed) AS closed, ' +
    '  COUNT(*) FILTER (WHERE closed AND ontime) AS ontime, COUNT(*) FILTER (WHERE backlog) AS backlog, ' +
    '  COUNT(*) FILTER (WHERE backlog AND overdue) AS overdue FROM metrics'
  );
  for (const [period, service, received, closed, ontime, ontimePct, backlog, overdue] of dashboardExpected) {
    const actual = totals.get({ period, service, now: resetTime });
    actual.ontimePct = actual.closed ? (actual.ontime * 100 / actual.closed).toFixed(1) + '%' : '–';
    assert.deepEqual(actual, { received, closed, ontime, ontimePct, backlog, overdue }, 'Dashboard ' + period + ' ' + service);
    console.log(period, service, actual.received, actual.closed, actual.ontime, actual.ontimePct, actual.backlog, actual.overdue);
  }
}

function caseNo(number) {
  return 'EG-2569-' + String(number).padStart(6, '0');
}

function checkQueues(db) {
  const queue = db.prepare(
    "SELECT case_no FROM cases WHERE dept = ? AND status IN ('SUBMITTED','IN_REVIEW','APPROVED') ORDER BY due_at, case_no"
  ).pluck();
  const registry = queue.all('registry');
  const works = queue.all('works');
  const head = db.prepare("SELECT case_no FROM cases WHERE status = 'PENDING_APPROVAL' ORDER BY due_at, case_no").pluck().all();

  assert.deepEqual(registry, [20, 22, 24, 23, 25, 26, 13, 15, 27, 28, 29, 30, 16, 18, 19, 12, 21].map(caseNo), 'Registry queue');
  assert.deepEqual(works, [caseNo(10)], 'Works queue');
  assert.deepEqual(head, [14, 11].map(caseNo), 'Head approvals');

  const unclaimed = db.prepare(
    "SELECT case_no FROM cases WHERE dept = 'registry' AND status IN ('SUBMITTED','IN_REVIEW') AND owner IS NULL ORDER BY due_at, case_no"
  ).pluck().all();
  assert.deepEqual(unclaimed, [24, 28, 29, 30].map(caseNo), 'Unclaimed registry queue');
  const workload = db.prepare(
    "SELECT u.username, COUNT(c.case_no) AS total FROM users u LEFT JOIN cases c ON c.owner = u.username AND c.status = 'IN_REVIEW' " +
    "WHERE u.role = 'officer' GROUP BY u.username ORDER BY u.username"
  ).all();
  assert.deepEqual(workload, [
    { username: 'off.reg1', total: 3 },
    { username: 'off.reg2', total: 9 },
    { username: 'off.works1', total: 0 },
  ], 'Officer workloads');
  console.log('Queues (registry, works, head):', registry.length, works.length, head.length);
}

function checkCounters(db) {
  const value = db.prepare('SELECT value FROM counters WHERE name = ?').pluck();
  const expected = [
    ['case:2569', 'EG-2569-', 6, 'EG-2569-000031'],
    ['case:2570', 'EG-2570-', 6, 'EG-2570-000001'],
    ['receipt:2569', 'RC-2569-', 6, 'RC-2569-000031'],
    ['doc:2569', 'DOC-2569-', 6, 'DOC-2569-000002'],
    ['draft', 'DR-', 4, 'DR-0003'],
    ['payment', 'PP-', 4, 'PP-0002'],
  ];
  const nextIds = [];
  for (const [counter, prefix, width, nextId] of expected) {
    const actual = prefix + String((value.get(counter) ?? 0) + 1).padStart(width, '0');
    assert.equal(actual, nextId, 'Next ' + counter);
    nextIds.push(actual);
  }
  console.log('Next IDs:', nextIds.join(', '));
}

function check(db) {
  const numbered = db.prepare('SELECT case_no FROM cases ORDER BY case_no').pluck().all();
  const drafts = db.prepare('SELECT draft_id FROM drafts WHERE case_no IS NULL ORDER BY draft_id').pluck().all();
  assert.deepEqual(numbered, Array.from({ length: 30 }, (_, index) => caseNo(index + 1)), 'Numbered cases');
  assert.deepEqual(drafts, ['DR-0001', 'DR-0002'], 'Unnumbered drafts');
  assert.equal(db.prepare('SELECT COUNT(*) FROM audit').pluck().get(), 0, 'Audit after reset');
  assert.equal(db.prepare('SELECT COUNT(*) FROM notifications').pluck().get(), 0, 'Notifications after reset');
  console.log('Numbered cases and unnumbered drafts:', numbered.length, drafts.length);
  checkQueues(db);
  console.log('Dashboard (period, service, received, closed, on time, on-time %, backlog, overdue)');
  checkDashboard(db);
  checkCounters(db);
}

try {
  // lib/db opens a fresh database in TEST_MODE. Inspect the live file without touching it.
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.transaction(() => check(db))();
    console.log('Seed checks passed.');
  } finally {
    db.close();
  }
} catch (error) {
  console.error('Seed check failed for ' + dbPath + '\n' + error.message);
  process.exitCode = 1;
}
