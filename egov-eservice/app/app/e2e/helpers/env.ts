/** ค่ากลางจาก TEST-PLAN §0 · TEST-DATA §1 §12 */
export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';

/** นาฬิกาหลัง RESET (อังคาร) */
export const T0 = '2026-12-01T09:00:00+07:00';
export const OTP_OK = '123456';
export const OTP_BAD = '000000';
export const STAFF_PASSWORD = 'Test@1234';

/** เลขบัตรประชาชน (TEST-DATA 1.1) */
export const ID = {
  somchai: '1101700123456', // สมชาย ใจดี
  somying: '3100600987659', // สมหญิง รักไทย
  mana: '5500400111221', // มานะ ตั้งใจ (ยังไม่ลงทะเบียน)
  piti: '1909900555015', // ปิติ มีสุข
} as const;

/** บัญชีเจ้าหน้าที่ (TEST-DATA 1.2) */
export type StaffUser = 'off.reg1' | 'off.reg2' | 'off.works1' | 'head1' | 'exec1' | 'audit1' | 'admin1';
export const STAFF_NAME: Record<StaffUser, string> = {
  'off.reg1': 'เจ้าหน้าที่ทะเบียน 1',
  'off.reg2': 'เจ้าหน้าที่ทะเบียน 2',
  'off.works1': 'เจ้าหน้าที่โยธา 1',
  head1: 'หัวหน้าฝ่าย',
  exec1: 'ผู้บริหาร',
  audit1: 'ผู้ตรวจสอบภายใน',
  admin1: 'ผู้ดูแลระบบ',
};

export type ServiceId = 'SV-01' | 'SV-02' | 'SV-03';

/** เลขคำขอปี 2569 จากท้าย 6 หลัก: CN('000025') = 'EG-2569-000025' */
export const CN = (tail: string | number): string => `EG-2569-${String(tail).padStart(6, '0')}`;

/** ข้อความ error ตรงตัว (CONTRACT §5) */
export const MSG = {
  INVALID_ID: 'เลขบัตรประชาชนไม่ถูกต้อง',
  OTP_INVALID: 'รหัส OTP ไม่ถูกต้อง',
  LOCKED: 'ผิดเกินกำหนด เลขบัตรนี้ถูกล็อก 15 นาที',
  INVALID_CREDENTIALS: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
  INVALID_MOBILE: 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0',
  CONSENT_REQUIRED: 'กรุณายินยอมการประมวลผลข้อมูลส่วนบุคคล (PDPA)',
  INVALID_QTY: 'จำนวนฉบับต้อง 1–5 ฉบับ',
  INVALID_AREA: 'กรุณาระบุพื้นที่ 1–500 ตร.ม.',
  AREA_TOO_LARGE: 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน',
  FILE_TOO_LARGE: 'ไฟล์ใหญ่เกิน 5 MB',
  FILE_TYPE: 'รองรับเฉพาะไฟล์ PDF, JPG, PNG',
  FILE_COUNT: 'แนบได้สูงสุด 5 ไฟล์ต่อคำขอ',
  PLAN_NOT_PDF: 'แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น',
  QR_EXPIRED: 'QR หมดอายุ กรุณาสร้าง QR ใหม่',
  CANNOT_CANCEL: 'ยกเลิกไม่ได้ คำขอมีเจ้าหน้าที่รับเรื่องแล้ว',
  ALREADY_CLAIMED: 'มีเจ้าหน้าที่รับเรื่องนี้แล้ว',
  WORKLOAD_LIMIT: 'รับงานได้สูงสุด 10 เรื่อง',
  NO_REFUND: 'ค่าธรรมเนียมที่ชำระแล้วไม่คืน',
} as const;

/** เหตุผลตีกลับ 10 ตัวอักษรพอดี (TEST-PLAN) */
export const REASON10 = 'xxxxxxxxxx';
