import { expect, type APIRequestContext, type APIResponse, type Locator, type Page, type Response } from '@playwright/test';
import { body, expectStatus, type Json } from './api';
import type { Actor, App } from './app';
import { ID, OTP_OK, STAFF_PASSWORD, type ServiceId } from './env';
import { fx as fxPath, fxBuffer, mimeOf, type TestFileName } from './files';

// ───────────────────────── API: ร่าง ไฟล์ ชำระ ─────────────────────────

/** ไฟล์บังคับต่อบริการ (TEST-PLAN §0 NEW_PAID · TEST-DATA ข้อ 11) */
export const REQUIRED_FILES: Record<ServiceId, Array<[docKey: string, file: TestFileName]>> = {
  'SV-01': [['id-card', 'id-card.pdf']],
  'SV-02': [['id-card', 'id-card.pdf'], ['map', 'map.pdf']],
  'SV-03': [['id-card', 'id-card.pdf'], ['plan', 'plan.pdf'], ['deed', 'deed.pdf']],
};

export function draftBody(serviceId: ServiceId, opts: { qty?: number; areaSqm?: number } = {}): Json {
  if (serviceId === 'SV-01') return { serviceId, qty: opts.qty ?? 1 };
  if (serviceId === 'SV-03') return { serviceId, areaSqm: opts.areaSqm ?? 100 };
  return { serviceId };
}

/** POST /api/drafts → 201 {draftId, fee} */
export async function createDraft(api: APIRequestContext, data: Json): Promise<{ draftId: string; fee: number }> {
  const b = await expectStatus(await api.post('/api/drafts', { data }), 201);
  expect(b.draftId, 'draftId').toMatch(/^DR-\d{4}$/);
  return b;
}

/** POST /api/drafts/:id/files (multipart: file, docKey) */
export async function uploadFile(
  api: APIRequestContext,
  draftId: string,
  docKey: string,
  file: TestFileName,
  opts: { mimeType?: string } = {},
): Promise<APIResponse> {
  return api.post(`/api/drafts/${draftId}/files`, {
    multipart: { file: { name: file, mimeType: opts.mimeType ?? mimeOf(file), buffer: fxBuffer(file) }, docKey },
  });
}

export async function uploadRequired(api: APIRequestContext, draftId: string, serviceId: ServiceId): Promise<void> {
  for (const [docKey, file] of REQUIRED_FILES[serviceId]) {
    await expectStatus(await uploadFile(api, draftId, docKey, file), 201);
  }
}

/** POST /api/drafts/:id/payment → 201 {ref, amount, qrCreatedAt, qrExpiresAt} */
export async function createPayment(api: APIRequestContext, draftId: string): Promise<{ ref: string; amount: number; qrExpiresAt: string }> {
  return expectStatus(await api.post(`/api/drafts/${draftId}/payment`), 201);
}

/** POST /api/test/payments/<ref>/pay {"amount"} */
export async function testPay(api: APIRequestContext, ref: string, amount: number): Promise<APIResponse> {
  return api.post(`/api/test/payments/${ref}/pay`, { data: { amount } });
}

export async function getPayment(api: APIRequestContext, ref: string): Promise<APIResponse> {
  return api.get(`/api/payments/${ref}`);
}

export async function getCase(api: APIRequestContext, caseNo: string): Promise<Json> {
  return expectStatus(await api.get(`/api/cases/${caseNo}`), 200);
}

export async function myCases(api: APIRequestContext): Promise<Json[]> {
  const b = await expectStatus(await api.get('/api/cases'), 200);
  return b.items;
}

/** ร่าง + ไฟล์บังคับ + QR (ยังไม่ชำระ) */
export async function NEW_UNPAID(
  api: APIRequestContext,
  serviceId: ServiceId = 'SV-01',
  opts: { qty?: number; areaSqm?: number } = {},
): Promise<{ draftId: string; fee: number; ref: string; amount: number }> {
  const d = await createDraft(api, draftBody(serviceId, opts));
  await uploadRequired(api, d.draftId, serviceId);
  const p = await createPayment(api, d.draftId);
  return { draftId: d.draftId, fee: d.fee, ref: p.ref, amount: p.amount };
}

export interface NewPaidOpts {
  service?: ServiceId;
  /** เวลา CLOCK ก่อนเริ่ม (ไม่ระบุ = ไม่ตั้งนาฬิกา) */
  at?: string;
  /** ผู้ยื่น (ค่าเริ่มต้นสมชาย) — ใช้เมื่อไม่ส่ง actor */
  idNo?: string;
  /** ผู้ยื่นที่ล็อกอินแล้ว (ไม่ต้องล็อกอินใหม่) */
  actor?: Actor;
  qty?: number;
  areaSqm?: number;
}

export interface Paid {
  actor: Actor;
  draftId: string;
  ref: string;
  fee: number;
  caseNo: string;
  receiptNo: string;
}

/**
 * NEW_PAID (TEST-PLAN §0): CLOCK(เวลา) → LOGIN_C → POST /api/drafts → ไฟล์บังคับ → payment → test pay → GET payment ได้ caseNo
 * ชำระด้วยยอดที่เว็บออก QR ให้ (เพื่อไม่ให้ TC อื่นล้มเพราะบั๊กค่าธรรมเนียม · ค่าธรรมเนียมตรวจใน TC-FEE-01)
 */
export async function NEW_PAID(app: App, opts: NewPaidOpts = {}): Promise<Paid> {
  const service = opts.service ?? 'SV-01';
  if (opts.at) await app.clock(opts.at);
  const actor = opts.actor ?? (await app.citizen(opts.idNo ?? ID.somchai));
  const u = await NEW_UNPAID(actor.api, service, opts);
  const paid = await expectStatus(await testPay(actor.api, u.ref, u.amount), 200);
  expect(paid.status).toBe('PAID');
  const pay = await expectStatus(await getPayment(actor.api, u.ref), 200);
  expect(pay.caseNo, 'GET /api/payments/<ref> caseNo').toBe(paid.caseNo);
  return { actor, draftId: u.draftId, ref: u.ref, fee: u.fee, caseNo: pay.caseNo, receiptNo: paid.receiptNo };
}

// ───────────────────────── API: เจ้าหน้าที่ ─────────────────────────

export async function claim(api: APIRequestContext, caseNo: string): Promise<APIResponse> {
  return api.post(`/api/officer/cases/${caseNo}/claim`);
}

export async function returnCase(api: APIRequestContext, caseNo: string, reason: string): Promise<APIResponse> {
  return api.post(`/api/officer/cases/${caseNo}/return`, { data: { reason } });
}

export async function resubmit(api: APIRequestContext, caseNo: string): Promise<APIResponse> {
  return api.post(`/api/cases/${caseNo}/resubmit`);
}

/** งานในมือ = IN_REVIEW ที่ฉันถือ (queue filter=mine) */
export async function mineCount(api: APIRequestContext): Promise<number> {
  const b = await expectStatus(await api.get('/api/officer/queue?filter=mine'), 200);
  return b.items.length;
}

/** แถว Audit ของเหตุการณ์/คำขอ (ผ่าน audit1) */
export async function auditRows(api: APIRequestContext, event: string, caseNo?: string): Promise<Json[]> {
  const b = await expectStatus(await api.get(`/api/audit?event=${encodeURIComponent(event)}`), 200);
  return (b.items as Json[]).filter((i) => caseNo === undefined || i.caseNo === caseNo);
}

/** รายการแจ้งเตือนเป็น "caseNo:level" เรียงแล้ว */
export async function apiNoti(api: APIRequestContext): Promise<string[]> {
  const b = await expectStatus(await api.get('/api/notifications'), 200);
  return (b.items as Json[]).map((i) => `${i.caseNo}:${i.level}`).sort();
}

// ───────────────────────── UI ─────────────────────────

/** ตรวจ pathname ของหน้า (ไม่สน query) */
export async function expectPath(page: Page, pathname: string): Promise<void> {
  await expect(page).toHaveURL((u) => u.pathname === pathname);
}

export const byTid = (page: Page | Locator, id: string): Locator => page.getByTestId(id);

/** element ที่ testid ตรงและแอตทริบิวต์ data-* ตรง */
export function tidWith(page: Page | Locator, id: string, attrs: Record<string, string>): Locator {
  const sel = Object.entries(attrs)
    .map(([k, v]) => `[data-${k}="${v}"]`)
    .join('');
  return page.locator(`[data-testid="${id}"]${sel}`);
}

export async function attrList(loc: Locator, attr: string): Promise<string[]> {
  return loc.evaluateAll((els, a) => els.map((e) => e.getAttribute(a) ?? ''), attr);
}

/** คลิกแล้วรอ response ของ API ที่ pathname ตรง */
export async function clickAndWait(page: Page, target: Locator, pathRe: RegExp, method = 'POST'): Promise<Response> {
  const wait = page.waitForResponse((r) => r.request().method() === method && pathRe.test(new URL(r.url()).pathname));
  await target.click();
  return wait;
}

export async function openLogin(page: Page, tab: 'citizen' | 'staff'): Promise<void> {
  await page.goto('/login');
  await page.getByTestId(tab === 'citizen' ? 'login-tab-citizen' : 'login-tab-staff').click();
}

/** ล็อกอินประชาชนผ่านหน้า /login (ไม่ตรวจหน้าที่ไป) */
export async function uiLoginCitizen(page: Page, idNo: string, otp = OTP_OK): Promise<void> {
  await openLogin(page, 'citizen');
  await page.getByTestId('thaid-id-input').fill(idNo);
  await page.getByTestId('thaid-submit').click();
  await expect(page.getByTestId('otp-step')).toBeVisible();
  await page.getByTestId('otp-input').fill(otp);
  await page.getByTestId('otp-submit').click();
}

export async function uiLoginStaff(page: Page, username: string, password = STAFF_PASSWORD): Promise<void> {
  await openLogin(page, 'staff');
  await page.getByTestId('staff-username').fill(username);
  await page.getByTestId('staff-password').fill(password);
  await page.getByTestId('staff-submit').click();
}

/** เปิดคิว (filter ถ้าระบุ) */
export async function openQueue(page: Page, filter?: 'all' | 'unclaimed' | 'mine'): Promise<void> {
  await page.goto('/officer/queue');
  await expect(page.getByTestId('queue-filter')).toBeVisible();
  if (filter) await page.getByTestId('queue-filter').selectOption(filter);
}

export function queueRow(page: Page, caseNo: string): Locator {
  return tidWith(page, 'queue-row', { 'case-no': caseNo });
}

/** ลำดับ data-case-no ของ queue-row ต้องเท่ากับที่คาด (poll จนหน้าโหลดเสร็จ) */
export async function expectQueueOrder(page: Page, expected: string[]): Promise<void> {
  await expect
    .poll(() => attrList(page.getByTestId('queue-row'), 'data-case-no'), { message: 'ลำดับ queue-row' })
    .toEqual(expected);
}

export async function expectWorkload(page: Page, n: number): Promise<void> {
  await openQueue(page);
  await expect(page.getByTestId('workload-count')).toHaveText(String(n));
}

/** เปิด /notifications แล้วคืนรายการ "caseNo:level" เรียงแล้ว */
export async function uiNoti(page: Page): Promise<string[]> {
  await page.goto('/notifications');
  await expect(page.getByTestId('noti-item').or(page.getByTestId('noti-empty')).first()).toBeVisible();
  const items = page.getByTestId('noti-item');
  const cases = await attrList(items, 'data-case-no');
  const levels = await attrList(items, 'data-level');
  return cases.map((c, i) => `${c}:${levels[i]}`).sort();
}

/** SV-01 ผ่านหน้าจอจาก /citizen/new/SV-01 จนถึงขั้น 3/3 (แนบ id-card.pdf) */
export async function wizardSV01ToPayment(page: Page, qty: number): Promise<void> {
  await page.goto('/citizen/new/SV-01');
  await expect(page.getByTestId('wizard-step')).toHaveText('1/3 กรอกข้อมูล');
  await page.getByTestId('qty-input').fill(String(qty));
  await page.getByTestId('to-upload-btn').click();
  await expect(page.getByTestId('wizard-step')).toHaveText('2/3 แนบเอกสาร');
  await page.getByTestId('upload-input-id-card').setInputFiles(fxPath('id-card.pdf'));
  await expect(tidWith(page, 'file-item', { 'doc-key': 'id-card' })).toHaveCount(1);
  await page.getByTestId('to-payment-btn').click();
  await expect(page.getByTestId('wizard-step')).toHaveText('3/3 ชำระเงิน');
}

/** ไปขั้นแนบเอกสารของบริการ (SV-01 qty · SV-03 area) */
export async function wizardToUpload(page: Page, service: ServiceId, opts: { qty?: number; area?: number } = {}): Promise<void> {
  await page.goto(`/citizen/new/${service}`);
  await expect(page.getByTestId('wizard-step')).toHaveText('1/3 กรอกข้อมูล');
  if (service === 'SV-01') await page.getByTestId('qty-input').fill(String(opts.qty ?? 1));
  if (service === 'SV-03') await page.getByTestId('area-input').fill(String(opts.area ?? 100));
  await page.getByTestId('to-upload-btn').click();
  await expect(page.getByTestId('wizard-step')).toHaveText('2/3 แนบเอกสาร');
}

/** ลบ file-item ทั้งหมดบนหน้าจอ */
export async function removeAllFiles(page: Page): Promise<void> {
  const items = page.getByTestId('file-item');
  for (let n = await items.count(); n > 0; n--) {
    await items.first().getByTestId('file-remove-btn').click();
    await expect(items).toHaveCount(n - 1);
  }
}

export { fxPath, body };
