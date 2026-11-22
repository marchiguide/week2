'use strict';

// TEST-DATA §4.1 and §4.3. For SV-01 input is copies, for SV-03 it is square metres.
// No., label, applicant, service, input, fee, status, paid at, due at, details.
const cases = [
  [1, 'H01', 'somying', 'SV-01', 1, 20, 'COMPLETED', '2026-10-14 10:00', '2026-10-19 16:30', { closedAt: '2026-10-16 14:00' }],
  [2, 'H05', 'piti', 'SV-03', 120, 1200, 'COMPLETED', '2026-11-02 09:00', '2026-11-23 16:30', { step: 3, closedAt: '2026-11-20 11:00' }],
  [3, 'H02', 'piti', 'SV-01', 2, 40, 'COMPLETED', '2026-11-02 09:30', '2026-11-05 16:30', { closedAt: '2026-11-04 15:00' }],
  [4, 'H06', 'somchai', 'SV-02', null, 500, 'COMPLETED', '2026-11-02 14:00', '2026-11-16 16:30', { closedAt: '2026-11-13 15:00' }],
  [5, 'H03', 'somchai', 'SV-01', 1, 20, 'COMPLETED', '2026-11-03 11:00', '2026-11-06 16:30', {
    closedAt: '2026-11-05 10:00', issuer: 'off.reg1', approver: 'off.reg1',
  }],
  [6, 'H08', 'piti', 'SV-02', null, 500, 'COMPLETED', '2026-11-03 15:00', '2026-11-17 16:30', { closedAt: '2026-11-19 10:00' }],
  [7, 'H07', 'somying', 'SV-02', null, 500, 'COMPLETED', '2026-11-04 10:00', '2026-11-18 16:30', { closedAt: '2026-11-18 16:00' }],
  [8, 'H04', 'somying', 'SV-01', 1, 20, 'REJECTED', '2026-11-09 10:00', '2026-11-12 16:30', { closedAt: '2026-11-11 09:00' }],
  [9, 'X01', 'somchai', 'SV-01', 1, 20, 'CANCELLED', '2026-11-09 14:30', '2026-11-12 16:30', { cancelledAt: '2026-11-09 15:00' }],
  [10, 'W01', 'somying', 'SV-03', 80, 1000, 'IN_REVIEW', '2026-11-12 10:00', '2026-12-03 16:30', {
    dept: 'works', step: 2, issuer: 'off.reg1',
  }],
  [11, 'P02', 'somchai', 'SV-03', 150, 1500, 'PENDING_APPROVAL', '2026-11-16 10:00', '2026-12-08 16:30', {
    owner: 'head1', step: 3, issuer: 'off.reg1', worksReviewer: 'off.works1',
  }],
  [12, 'R09', 'piti', 'SV-03', 101, 1010, 'IN_REVIEW', '2026-11-18 10:00', '2026-12-11 16:30', { owner: 'off.reg2', step: 1 }],
  [13, 'R01', 'somchai', 'SV-02', null, 500, 'IN_REVIEW', '2026-11-20 10:00', '2026-12-04 16:30', { owner: 'off.reg2' }],
  [14, 'P01', 'piti', 'SV-02', null, 500, 'PENDING_APPROVAL', '2026-11-20 11:00', '2026-12-04 16:30', { owner: 'head1', issuer: 'off.reg1' }],
  [15, 'R02', 'somying', 'SV-02', null, 500, 'IN_REVIEW', '2026-11-20 15:00', '2026-12-04 16:30', { owner: 'off.reg2' }],
  [16, 'R03', 'piti', 'SV-02', null, 500, 'IN_REVIEW', '2026-11-23 09:00', '2026-12-08 16:30', { owner: 'off.reg2' }],
  [17, 'F01', 'somchai', 'SV-01', 1, 20, 'NEED_FIX', '2026-11-23 10:00', '2026-11-27 16:30', {
    owner: 'off.reg1', returnCount: 2, returnedAt: '2026-11-27 14:00', fixDeadline: '2026-12-04 14:00',
  }],
  [18, 'R04', 'somchai', 'SV-02', null, 500, 'IN_REVIEW', '2026-11-24 10:00', '2026-12-09 16:30', { owner: 'off.reg2' }],
  [19, 'A01', 'somying', 'SV-02', null, 500, 'APPROVED', '2026-11-24 14:00', '2026-12-09 16:30', {
    issuer: 'off.reg1', approver: 'head1', approvedAt: '2026-11-30 15:00',
  }],
  [20, 'O01', 'somchai', 'SV-01', 1, 20, 'IN_REVIEW', '2026-11-25 10:00', '2026-11-30 16:30', { owner: 'off.reg1' }],
  [21, 'R08', 'somying', 'SV-02', null, 500, 'IN_REVIEW', '2026-11-25 12:00', '2026-12-11 16:30', { owner: 'off.reg2' }],
  [22, 'N02', 'somying', 'SV-01', 2, 40, 'IN_REVIEW', '2026-11-26 10:00', '2026-12-01 16:30', { owner: 'off.reg1' }],
  [23, 'F02', 'somying', 'SV-01', 1, 20, 'IN_REVIEW', '2026-11-26 10:30', '2026-12-03 16:30', { owner: 'off.reg1', returnCount: 2 }],
  [24, 'N01', 'piti', 'SV-01', 1, 20, 'SUBMITTED', '2026-11-27 11:00', '2026-12-02 16:30'],
  [25, 'R05', 'somying', 'SV-01', 3, 60, 'IN_REVIEW', '2026-11-30 10:00', '2026-12-03 16:30', { owner: 'off.reg2' }],
  [26, 'R07', 'somchai', 'SV-01', 5, 100, 'IN_REVIEW', '2026-11-30 16:29', '2026-12-03 16:30', { owner: 'off.reg2' }],
  [27, 'R06', 'piti', 'SV-01', 1, 20, 'IN_REVIEW', '2026-11-30 16:30', '2026-12-04 16:30', { owner: 'off.reg2' }],
  [28, 'S01', 'somying', 'SV-01', 1, 20, 'SUBMITTED', '2026-12-01 08:10', '2026-12-04 16:30'],
  [29, 'S02', 'piti', 'SV-01', 1, 20, 'SUBMITTED', '2026-12-01 08:20', '2026-12-04 16:30'],
  [30, 'S03', 'somchai', 'SV-01', 1, 20, 'SUBMITTED', '2026-12-01 08:30', '2026-12-04 16:30'],
];

// TEST-DATA §4.4. Returned at, resubmitted at, working days paused, reason.
const returns = {
  F01: [
    ['2026-11-24 11:00', '2026-11-25 10:00', 1, 'ภาพบัตรประชาชนไม่ชัด กรุณาถ่ายใหม่'],
    ['2026-11-27 14:00', null, null, 'ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข'],
  ],
  F02: [
    ['2026-11-27 10:00', '2026-11-30 10:00', 1, 'ภาพเอกสารเบลอ อ่านเลขไม่ได้'],
    ['2026-11-30 14:00', '2026-12-01 08:30', 1, 'ข้อมูลในแบบฟอร์มไม่ครบถ้วน'],
  ],
};

module.exports = { cases, returns };
