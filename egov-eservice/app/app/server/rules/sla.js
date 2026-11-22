'use strict';

const { bug } = require('../lib/bugs');
const clock = require('../lib/clock');
const { CLOSED_STATUSES } = require('../lib/codes');
const database = require('../lib/db');
const { ApiError } = require('../lib/errors');

const CUTOFF = '16:30:00';

// Read one snapshot per calculation so admin edits take effect on the next call.
function loadHolidays() {
  return new Set(database.db.prepare('SELECT date FROM holidays').pluck().all());
}

function timestamp(value) {
  const ms = clock.toMs(value);
  if (!Number.isFinite(ms)) throw new TypeError('Expected a valid date or timestamp');
  return ms;
}

/** Calendar helpers use Bangkok date keys (YYYY-MM-DD). */
function isBusinessDay(day, holidays = loadHolidays()) {
  const weekday = clock.weekdayOfKey(day);
  return weekday >= 1 && weekday <= 5 && !holidays.has(day);
}

/** BUG_MODE B03 (BUGS.md §2): the *deadline* calendar skips weekends only (holiday table ignored).
 *  Scoped to dueAt/extendDue (B13): the "days left" count behind slaLevel / notifications stays correct,
 *  so B03 changes only the deadlines it names (BUGS.md §1 rule 1). */
function deadlineHolidays(holidays) {
  return bug('B03') ? new Set() : holidays;
}

function nextBusinessDay(day, holidays = loadHolidays()) {
  let next = clock.addDaysKey(clock.dateKey(timestamp(day)), 1);
  while (!isBusinessDay(next, holidays)) {
    next = clock.addDaysKey(next, 1);
  }
  return next;
}

function advanceBusinessDays(day, days, holidays) {
  for (let elapsed = 0; elapsed < days; elapsed++) {
    day = nextBusinessDay(day, holidays);
  }
  return day;
}

/** Bangkok date key for the day from which the SLA starts. */
function d0(paidAt, holidays = loadHolidays()) {
  const paid = timestamp(paidAt);
  const day = clock.dateKey(paid);
  if (paid < clock.fromDateKey(day, CUTOFF).getTime() && isBusinessDay(day, holidays)) {
    return day;
  }
  return nextBusinessDay(day, holidays);
}

/** Initial due time in the storage format (ISO with Bangkok's +07:00 offset). */
function dueAt(paidAt, sla, holidays = loadHolidays()) {
  if (!Number.isInteger(sla) || sla < 1 || sla > 60) throw new ApiError('INVALID_SLA');

  const calendar = deadlineHolidays(holidays);
  const day = advanceBusinessDays(d0(paidAt, calendar), sla, calendar);
  return clock.toIso(clock.fromDateKey(day, CUTOFF));
}

/** Count business dates after the first instant's date through the second's date. */
function businessDaysLeft(now, due, holidays = loadHolidays()) {
  const today = clock.dateKey(timestamp(now));
  const lastDay = clock.dateKey(timestamp(due));
  let days = 0;
  for (let day = clock.addDaysKey(today, 1); day <= lastDay; day = clock.addDaysKey(day, 1)) {
    if (isBusinessDay(day, holidays)) days++;
  }
  return days;
}

/** Extend the stored due time by the business dates in (return, resubmission]. */
function extendDue(due, returnedAt, resubmittedAt, holidays = loadHolidays()) {
  const deadline = clock.toIso(timestamp(due));
  if (bug('B04')) return deadline;

  const calendar = deadlineHolidays(holidays);
  const days = businessDaysLeft(returnedAt, resubmittedAt, calendar);
  const newDay = advanceBusinessDays(deadline.slice(0, 10), days, calendar);
  return newDay + deadline.slice(10);
}

function slaLevel(caseRow, now, holidays) {
  if (CLOSED_STATUSES.includes(caseRow.status)) return 'closed';
  if (caseRow.status === 'NEED_FIX') return 'paused';

  const current = timestamp(now);
  const due = timestamp(caseRow.due_at ?? caseRow.dueAt);
  if (current > due) return 'overdue';

  return businessDaysLeft(current, due, holidays) <= 1 ? 'near' : 'normal';
}

function isOnTime(closedAt, due) {
  return closedAt != null && due != null && timestamp(closedAt) <= timestamp(due);
}

module.exports = {
  isBusinessDay, nextBusinessDay, d0, dueAt, extendDue, businessDaysLeft, slaLevel, isOnTime,
};
