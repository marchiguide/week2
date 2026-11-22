'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const Database = require('better-sqlite3');
const database = require('../lib/db');
const {
  fee, isBusinessDay, nextBusinessDay, d0, dueAt, extendDue, businessDaysLeft,
  slaLevel, isOnTime,
} = require('.');

const holidays = new Set(['2026-12-07', '2026-12-10', '2026-12-31', '2027-01-01']);
const dec = (day, time = '09:00:00') => `2026-12-${day}T${time}+07:00`;
const sv01 = { fee: 20 };
const sv02 = { fee: 500 };
const sv03 = { fee: 1000, fee_per_sqm: 10 };

test('TC-FEE-01: SV-01 charges per copy and validates the range', () => {
  for (const [qty, amount] of [[1, 20], [2, 40], [3, 60], [4, 80], [5, 100]]) {
    assert.equal(fee('SV-01', qty, sv01), amount);
  }
  for (const qty of [0, 6, 2.5, true, [2], '']) {
    assert.throws(() => fee('SV-01', qty, sv01), {
      code: 'INVALID_QTY', status: 400, message: 'จำนวนฉบับต้อง 1–5 ฉบับ',
    });
  }
});

test('TC-FEE-01: SV-02 uses the flat fee and SV-03 charges the excess above 100 sqm', () => {
  assert.equal(fee('SV-02', undefined, sv02), 500);
  for (const [area, amount] of [
    [1, 1000], [100, 1000], [101, 1010], [102, 1020], [250, 2500],
    [300, 3000], [499, 4990], [500, 5000],
  ]) {
    assert.equal(fee('SV-03', area, sv03), amount);
  }
  for (const area of [0, -1, 1.5, undefined, 'abc']) {
    assert.throws(() => fee('SV-03', area, sv03), {
      code: 'INVALID_AREA', status: 400, message: 'กรุณาระบุพื้นที่ 1–500 ตร.ม.',
    });
  }
  assert.throws(() => fee('SV-03', 501, sv03), {
    code: 'AREA_TOO_LARGE', status: 400,
    message: 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน',
  });
});

test('Fees use the supplied service row, including admin changes and zero fees', () => {
  assert.equal(fee('SV-01', '2', { fee: 25 }), 50);
  assert.equal(fee('SV-02', undefined, { fee: 0 }), 0);
  assert.equal(fee('SV-03', '101', { fee: 1500, fee_per_sqm: 20 }), 1520);
});

const dueExamples = [
  [dec('01'), 3, '2026-12-01', dec('04', '16:30:00')],
  [dec('01', '16:29:00'), 3, '2026-12-01', dec('04', '16:30:00')],
  [dec('01', '16:30:00'), 3, '2026-12-02', dec('08', '16:30:00')],
  [dec('04', '10:00:00'), 3, '2026-12-04', dec('11', '16:30:00')],
  [dec('05', '10:00:00'), 3, '2026-12-08', dec('14', '16:30:00')],
  [dec('01'), 10, '2026-12-01', dec('17', '16:30:00')],
  [dec('01'), 15, '2026-12-01', dec('24', '16:30:00')],
  [dec('29', '10:00:00'), 3, '2026-12-29', '2027-01-05T16:30:00+07:00'],
  [dec('31', '23:59:00'), 3, '2027-01-04', '2027-01-07T16:30:00+07:00'],
];

for (const [index, [paid, sla, start, expected]] of dueExamples.entries()) {
  test(`TC-SLA-01 row ${String.fromCharCode(97 + index)}: D0 and deadline`, () => {
    assert.equal(d0(paid, holidays), start);
    assert.equal(dueAt(paid, sla, holidays), expected);
  });
}

test('Bangkok cutoff advances D0 at 16:30:00 even for UTC timestamps', () => {
  assert.equal(d0('2026-12-01T09:29:59Z', holidays), '2026-12-01');
  assert.equal(d0('2026-12-01T09:30:00Z', holidays), '2026-12-02');
  assert.equal(d0(dec('07'), holidays), '2026-12-08');
});

test('TC-SLA-02: extensions count Bangkok business dates through resubmission', () => {
  const deadline = dueAt(dec('01'), 3, holidays);
  const seedDeadline = '2026-11-27T16:30:00+07:00';
  const seedReturn = '2026-11-27T14:00:00+07:00';
  for (const [due, returned, resubmitted, expected] of [
    [deadline, dec('02', '11:00:00'), dec('03', '10:00:00'), dec('08', '16:30:00')],
    [seedDeadline, seedReturn, dec('01'), dec('01', '16:30:00')],
    [seedDeadline, seedReturn, dec('04', '10:00:00'), dec('04', '16:30:00')],
    [deadline, dec('02'), dec('02', '15:00:00'), deadline],
    [deadline, dec('04', '10:00:00'), dec('08', '17:00:00'), dec('08', '16:30:00')],
  ]) {
    assert.equal(extendDue(due, returned, resubmitted, holidays), expected, resubmitted);
  }
});

test('TC-SLA-03: days left and warning levels at the deadline and across a holiday', () => {
  const friday = dec('04', '16:30:00');
  const tuesday = dec('08', '16:30:00');
  for (const [due, now, days, level] of [
    [friday, dec('01'), 3, 'normal'],
    [friday, dec('02'), 2, 'normal'],
    [friday, dec('03'), 1, 'near'],
    [friday, friday, 0, 'near'],
    [friday, dec('04', '16:30:01'), 0, 'overdue'],
    [friday, dec('04', '16:31:00'), 0, 'overdue'],
    [friday, dec('05'), 0, 'overdue'],
    [tuesday, dec('03'), 2, 'normal'],
    [tuesday, dec('04'), 1, 'near'],
    [tuesday, tuesday, 0, 'near'],
    [tuesday, dec('08', '16:31:00'), 0, 'overdue'],
  ]) {
    assert.equal(businessDaysLeft(now, due, holidays), days, now);
    assert.equal(slaLevel({ status: 'IN_REVIEW', due_at: due }, now, holidays), level, now);
  }
});

test('Paused and closed cases keep their level after the stored deadline', () => {
  const due = dec('04', '16:30:00');
  const now = dec('05');
  assert.equal(slaLevel({ status: 'NEED_FIX', due_at: due }, now, holidays), 'paused');
  for (const status of ['COMPLETED', 'REJECTED', 'CANCELLED']) {
    assert.equal(slaLevel({ status, due_at: due }, now, holidays), 'closed');
  }
});

test('On-time closure includes the deadline second itself', () => {
  const due = dec('04', '16:30:00');
  assert.equal(isOnTime(dec('04', '16:29:59'), due), true);
  assert.equal(isOnTime(due, due), true);
  assert.equal(isOnTime(dec('04', '16:30:01'), due), false);
  assert.equal(isOnTime(null, due), false);
});

test('The default calendar picks up holiday additions and deletions from SQLite', (context) => {
  const db = new Database(':memory:');
  context.after(() => db.close());
  context.mock.getter(database, 'db', () => db);
  db.exec('CREATE TABLE holidays (date TEXT PRIMARY KEY)');
  const addHoliday = db.prepare('INSERT INTO holidays (date) VALUES (?)');
  for (const day of holidays) addHoliday.run(day);

  const deadline = dueAt(dec('01'), 3);
  assert.equal(isBusinessDay('2026-12-05'), false);
  assert.equal(isBusinessDay('2026-12-07'), false);
  assert.equal(nextBusinessDay('2026-12-04'), '2026-12-08');
  assert.equal(deadline, dec('04', '16:30:00'));

  addHoliday.run('2026-12-02');
  addHoliday.run('2026-12-03');
  assert.equal(dueAt(dec('01'), 3), dec('09', '16:30:00'));
  assert.equal(extendDue(deadline, dec('02'), dec('03')), deadline);
  assert.equal(businessDaysLeft(dec('01'), deadline), 1);

  db.prepare('DELETE FROM holidays WHERE date IN (?, ?)').run('2026-12-02', '2026-12-03');
  assert.equal(dueAt(dec('01'), 3), deadline);
  assert.equal(extendDue(deadline, dec('02'), dec('03')), dec('08', '16:30:00'));
});

const bugProbe = `
    const rules = require('.');
    const holidays = new Set(['2026-12-07']);
    const service = { fee: 1000, fee_per_sqm: 10 };
    const deadline = '2026-12-04T16:30:00+07:00';
    const tuesday = '2026-12-08T16:30:00+07:00';
    console.log(JSON.stringify({
      fee101: rules.fee('SV-03', 101, service),
      fee102: rules.fee('SV-03', 102, service),
      due: rules.dueAt('2026-12-01T16:30:00+07:00', 3, holidays),
      days: rules.businessDaysLeft(deadline, tuesday, holidays),
      extended: rules.extendDue(deadline, '2026-12-02', '2026-12-03', holidays),
      level: rules.slaLevel({ status: 'NEED_FIX', due_at: deadline }, tuesday, holidays),
    }));
`;
const correctValues = {
  fee101: 1010,
  fee102: 1020,
  due: dec('08', '16:30:00'),
  days: 1,
  extended: dec('08', '16:30:00'),
  level: 'paused',
};

for (const [mode, changes] of [
  ['B01', { fee101: 1000 }],
  // B03 changes deadlines only; businessDaysLeft (days left → slaLevel / notifications) stays correct (B13)
  ['B03', { due: dec('07', '16:30:00'), extended: dec('07', '16:30:00') }],
  ['B04', { extended: dec('04', '16:30:00') }],
  ['B01,B03,B04', { fee101: 1000, due: dec('07', '16:30:00'), extended: dec('04', '16:30:00') }],
]) {
  test(`BUG_MODE=${mode} changes the expected calculations`, () => {
    const output = execFileSync(process.execPath, ['-e', bugProbe], {
      cwd: __dirname, encoding: 'utf8', env: { ...process.env, BUG_MODE: mode },
    });
    assert.deepEqual(JSON.parse(output), { ...correctValues, ...changes });
  });
}
