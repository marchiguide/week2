'use strict';
/**
 * API errors: always JSON {"code":"...","message":"..."} (+ extra fields) — CONTRACT §0.6 §5.
 *
 *   const { ApiError, sendError } = require('../../lib/errors');
 *   throw new ApiError('INVALID_QTY');                    // status + Thai message from the table below
 *   throw new ApiError('MISSING_DOCS', { missing: ['แบบแปลน'] }, 'ยังขาดเอกสาร: แบบแปลน');
 *   return sendError(res, 'OTP_INVALID', { attemptsLeft: 2 });
 *
 * Thrown ApiErrors (also from async handlers — express-async-errors is loaded) are rendered by the
 * global error handler in server/index.js.
 */

/** code → [httpStatus, message]  (messages are asserted verbatim by tests) */
const ERRORS = {
  INVALID_ID: [400, 'เลขบัตรประชาชนไม่ถูกต้อง'],
  OTP_INVALID: [401, 'รหัส OTP ไม่ถูกต้อง'],
  LOCKED: [423, 'ผิดเกินกำหนด เลขบัตรนี้ถูกล็อก 15 นาที'],
  INVALID_CREDENTIALS: [401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'],
  INVALID_MOBILE: [400, 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0'],
  CONSENT_REQUIRED: [400, 'กรุณายินยอมการประมวลผลข้อมูลส่วนบุคคล (PDPA)'],
  INVALID_QTY: [400, 'จำนวนฉบับต้อง 1–5 ฉบับ'],
  INVALID_AREA: [400, 'กรุณาระบุพื้นที่ 1–500 ตร.ม.'],
  AREA_TOO_LARGE: [400, 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน'],
  FILE_TOO_LARGE: [400, 'ไฟล์ใหญ่เกิน 5 MB'],
  FILE_TYPE: [400, 'รองรับเฉพาะไฟล์ PDF, JPG, PNG'],
  FILE_COUNT: [400, 'แนบได้สูงสุด 5 ไฟล์ต่อคำขอ'],
  PLAN_NOT_PDF: [400, 'แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น'],
  MISSING_DOCS: [409, 'ยังขาดเอกสาร'], // message should be 'ยังขาดเอกสาร: <ชื่อ, ชื่อ>' — pass it explicitly
  QR_EXPIRED: [410, 'QR หมดอายุ กรุณาสร้าง QR ใหม่'],
  AMOUNT_MISMATCH: [422, 'ยอดเงินไม่ตรงกับค่าธรรมเนียม'],
  NOT_FOUND: [404, 'ไม่พบคำขอ'],
  CANNOT_CANCEL: [409, 'ยกเลิกไม่ได้ คำขอมีเจ้าหน้าที่รับเรื่องแล้ว'],
  FIX_WINDOW_EXPIRED: [409, 'หมดเวลาแก้ไขแล้ว คำขอถูกยกเลิก'],
  ALREADY_CLAIMED: [409, 'มีเจ้าหน้าที่รับเรื่องนี้แล้ว'],
  WORKLOAD_LIMIT: [409, 'รับงานได้สูงสุด 10 เรื่อง'],
  RETURN_LIMIT: [409, 'ตีกลับได้สูงสุด 2 ครั้ง'],
  REASON_TOO_SHORT: [400, 'กรุณากรอกเหตุผลอย่างน้อย 10 ตัวอักษร'],
  REASON_REQUIRED: [400, 'กรุณากรอกเหตุผล'],
  INVALID_STATE: [409, 'สถานะคำขอไม่ถูกต้องสำหรับรายการนี้'],
  FORBIDDEN: [403, 'ไม่มีสิทธิ์ทำรายการนี้'],
  UNAUTHENTICATED: [401, 'กรุณาเข้าสู่ระบบ'],
  INVALID_FEE: [400, 'ค่าธรรมเนียมต้องเป็นจำนวนเต็ม 0–100,000 บาท'],
  INVALID_SLA: [400, 'SLA ต้องเป็นจำนวนเต็ม 1–60 วันทำการ'],
  DUPLICATE_HOLIDAY: [409, 'มีวันหยุดนี้อยู่แล้ว'],
  SELF_ROLE_CHANGE: [409, 'ไม่สามารถเปลี่ยนบทบาทของตัวเองได้'],
  METHOD_NOT_ALLOWED: [405, 'Method Not Allowed'],
  // not in CONTRACT §5 (no test asserts the message)
  INVALID_TIME: [400, 'รูปแบบเวลาไม่ถูกต้อง ต้องเป็น ISO 8601 พร้อม offset เช่น 2026-12-01T09:00:00+07:00'],
  BAD_REQUEST: [400, 'คำขอไม่ถูกต้อง'],
  BAD_JSON: [400, 'รูปแบบ JSON ไม่ถูกต้อง'],
  PAYLOAD_TOO_LARGE: [413, 'ข้อมูลที่ส่งมีขนาดใหญ่เกินไป'],
  ROUTE_NOT_FOUND: [404, 'ไม่พบ API นี้'],
  INTERNAL: [500, 'เกิดข้อผิดพลาดภายในระบบ'],
};

class ApiError extends Error {
  /**
   * @param {string} code   key of ERRORS (unknown codes → 400 unless status given in extra.status)
   * @param {object} [extra] extra JSON fields (e.g. {attemptsLeft:2}); `status` key overrides HTTP status
   * @param {string} [message] override message
   */
  constructor(code, extra = {}, message) {
    const def = ERRORS[code] || [400, code];
    const { status, ...rest } = extra || {};
    super(message || def[1]);
    this.name = 'ApiError';
    this.code = code;
    this.status = status || def[0];
    this.extra = rest;
  }
  toJSON() { return { code: this.code, message: this.message, ...this.extra }; }
}

/** Send a JSON error immediately. Returns res (so `return sendError(...)` works). */
function sendError(res, code, extra = {}, message) {
  const e = new ApiError(code, extra, message);
  return res.status(e.status).json(e.toJSON());
}

/** Message for a code (e.g. to render the same text on a page). */
function messageOf(code) { return (ERRORS[code] || [0, code])[1]; }

module.exports = { ERRORS, ApiError, sendError, messageOf };
