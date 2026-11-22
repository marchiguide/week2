import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gen = require('../fixtures/make-testfiles.cjs') as { TESTFILES_DIR: string; ensureTestFiles: () => string };

/** โฟลเดอร์ไฟล์ทดสอบ (TEST-DATA ข้อ 11) สร้างโดย global-setup */
export const TESTFILES_DIR: string = gen.TESTFILES_DIR;
export const ensureTestFiles = (): string => gen.ensureTestFiles();

export type TestFileName =
  | 'ok-id.pdf' | 'id-card.pdf' | 'map.pdf' | 'plan.pdf' | 'deed.pdf'
  | 'multi-1.pdf' | 'multi-2.pdf' | 'multi-3.pdf' | 'multi-4.pdf' | 'multi-5.pdf' | 'multi-6.pdf'
  | 'real.jpg' | 'real.png' | 'plan-as-jpg.jpg'
  | 'size-5242879.pdf' | 'size-5242880.pdf' | 'size-5242881.pdf'
  | 'fake-text.pdf' | 'fake-text.jpg' | 'exe-as.png' | 'notes.txt';

export function fx(name: TestFileName): string {
  return path.join(TESTFILES_DIR, name);
}

export function fxBuffer(name: TestFileName): Buffer {
  return fs.readFileSync(fx(name));
}

/** mimeType ตามนามสกุล (ตัวตรวจของเว็บต้องดู magic bytes ไม่ใช่ค่านี้) */
export function mimeOf(name: string): string {
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  return 'text/plain';
}
