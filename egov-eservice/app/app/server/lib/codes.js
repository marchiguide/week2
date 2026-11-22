'use strict';
/**
 * Code tables shared by all modules (CONTRACT §1 §2.1 §4 · DECISIONS §3 §4 §13).
 * Text values are asserted verbatim by tests — do not change.
 */

/** data-status → Thai text (CONTRACT §4.1) */
const STATUS = {
  DRAFT: 'ร่าง',
  PENDING_PAYMENT: 'รอชำระเงิน',
  SUBMITTED: 'ส่งคำขอแล้ว',
  IN_REVIEW: 'กำลังตรวจสอบ',
  NEED_FIX: 'รอแก้ไขเอกสาร',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติ',
  COMPLETED: 'เสร็จสิ้น',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

/** data-level → Thai text (CONTRACT §4.2) */
const LEVEL = {
  normal: 'ปกติ',
  near: 'ใกล้ครบกำหนด',
  overdue: 'เกินกำหนด',
  paused: 'หยุดนับ',
  closed: 'ปิดแล้ว',
};

/** data-role → Thai text (CONTRACT §2.1) */
const ROLE = {
  citizen: 'ประชาชน',
  officer: 'เจ้าหน้าที่',
  head: 'หัวหน้าฝ่าย',
  executive: 'ผู้บริหาร',
  auditor: 'ผู้ตรวจสอบภายใน',
  admin: 'ผู้ดูแลระบบ',
};

const DEPT = { registry: 'ทะเบียน', works: 'โยธา' };

/** Landing page after login (CONTRACT §1) */
const LANDING = {
  citizen: '/citizen',
  officer: '/officer/queue',
  head: '/head/approvals',
  executive: '/dashboard',
  auditor: '/audit',
  admin: '/admin/services',
};

/** Static part of the service catalogue (CONTRACT §4.3 · DECISIONS §3). Fee/SLA live in DB table `services`. */
const SERVICES = {
  'SV-01': {
    id: 'SV-01', name: 'ขอหนังสือรับรอง', feeType: 'per_copy',
    docs: [{ key: 'id-card', name: 'บัตรประชาชน', required: true }],
    route: ['registry'], approver: 'officer', steps: null,
  },
  'SV-02': {
    id: 'SV-02', name: 'ขออนุญาตประกอบกิจการ', feeType: 'flat',
    docs: [
      { key: 'id-card', name: 'บัตรประชาชน', required: true },
      { key: 'map', name: 'แผนที่ตั้ง', required: true },
      { key: 'site-photo', name: 'ภาพสถานที่', required: false },
    ],
    route: ['registry', 'head'], approver: 'head', steps: null,
  },
  'SV-03': {
    id: 'SV-03', name: 'ขออนุญาตก่อสร้าง/ต่อเติมอาคาร', feeType: 'area',
    docs: [
      { key: 'id-card', name: 'บัตรประชาชน', required: true },
      { key: 'plan', name: 'แบบแปลน', required: true, pdfOnly: true },
      { key: 'deed', name: 'โฉนด', required: true },
    ],
    route: ['registry', 'works', 'head'], approver: 'head', steps: 3,
  },
};
const SERVICE_IDS = Object.keys(SERVICES);

/** docKey → Thai name */
const DOC_NAME = { 'id-card': 'บัตรประชาชน', map: 'แผนที่ตั้ง', 'site-photo': 'ภาพสถานที่', plan: 'แบบแปลน', deed: 'โฉนด' };

/** Upload limits (DECISIONS §4 · A-10) */
const MAX_FILE_BYTES = 5242880; // 5 MB inclusive
const MAX_FILES_PER_CASE = 5;

/** Audit events (DECISIONS §13) */
const AUDIT_EVENTS = ['STAFF_LOGIN', 'CLAIM', 'RETURN', 'FORWARD', 'APPROVE', 'REJECT', 'ISSUE', 'UNMASK', 'EXPORT', 'ADMIN_CHANGE'];

/** Backlog statuses (DECISIONS §12) */
const BACKLOG_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'NEED_FIX', 'PENDING_APPROVAL', 'APPROVED'];
const CLOSED_STATUSES = ['COMPLETED', 'REJECTED', 'CANCELLED'];

module.exports = {
  STATUS, LEVEL, ROLE, DEPT, LANDING, SERVICES, SERVICE_IDS, DOC_NAME,
  MAX_FILE_BYTES, MAX_FILES_PER_CASE, AUDIT_EVENTS, BACKLOG_STATUSES, CLOSED_STATUSES,
};
