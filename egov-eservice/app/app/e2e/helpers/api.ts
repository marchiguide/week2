import { request, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { BASE_URL, OTP_OK, STAFF_PASSWORD, T0, ID, type StaffUser } from './env';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export async function newApi(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE_URL });
}

export async function body(r: APIResponse): Promise<Json> {
  const text = await r.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { _raw: text };
  }
}

/** ตรวจ HTTP status + code (+ message) ของ error รูปแบบ {"code","message"} (CONTRACT 0.6) */
export async function expectError(r: APIResponse, status: number, code?: string, message?: string): Promise<Json> {
  const b = await body(r);
  expect(r.status(), `${r.url()} → ${JSON.stringify(b)}`).toBe(status);
  if (code !== undefined) expect(b?.code, `${r.url()} code`).toBe(code);
  if (message !== undefined) expect(b?.message, `${r.url()} message`).toBe(message);
  return b;
}

export async function expectStatus(r: APIResponse, status: number): Promise<Json> {
  const b = await body(r);
  expect(r.status(), `${r.url()} → ${JSON.stringify(b)}`).toBe(status);
  return b;
}

/** RESET: POST /api/test/reset → 200, now = 2026-12-01T09:00:00+07:00 · ล้าง session ทุกคน */
export async function RESET(): Promise<void> {
  const api = await newApi();
  try {
    const r = await api.post('/api/test/reset');
    const b = await expectStatus(r, 200);
    expect(b.now, 'RESET now').toBe(T0);
  } finally {
    await api.dispose();
  }
}

/** CLOCK(t): PUT /api/test/clock {"now":t} (นาฬิกาแช่แข็ง) */
export async function CLOCK(now: string): Promise<void> {
  const api = await newApi();
  try {
    const r = await api.put('/api/test/clock', { data: { now } });
    await expectStatus(r, 200);
  } finally {
    await api.dispose();
  }
}

export async function thaidStart(api: APIRequestContext, idNo: string): Promise<APIResponse> {
  return api.post('/api/auth/thaid/start', { data: { idNo } });
}

export async function thaidVerify(api: APIRequestContext, idNo: string, otp: string): Promise<APIResponse> {
  return api.post('/api/auth/thaid/verify', { data: { idNo, otp } });
}

/** ล็อกอินประชาชนใน request context ที่ให้มา (start + verify OTP 123456) */
export async function loginCitizen(api: APIRequestContext, idNo: string = ID.somchai): Promise<Json> {
  await expectStatus(await thaidStart(api, idNo), 200);
  return expectStatus(await thaidVerify(api, idNo, OTP_OK), 200);
}

/** ล็อกอินเจ้าหน้าที่ใน request context ที่ให้มา */
export async function loginStaff(api: APIRequestContext, username: StaffUser | string, password = STAFF_PASSWORD): Promise<Json> {
  const r = await api.post('/api/auth/staff/login', { data: { username, password } });
  return expectStatus(r, 200);
}

/** LOGIN_C(เลขบัตร): request context ใหม่ที่ล็อกอินแล้ว (ผู้เรียก dispose เอง หรือใช้ app.citizen()) */
export async function LOGIN_C(idNo: string = ID.somchai): Promise<APIRequestContext> {
  const api = await newApi();
  await loginCitizen(api, idNo);
  return api;
}

/** LOGIN_S(user): request context ใหม่ที่ล็อกอินแล้ว */
export async function LOGIN_S(username: StaffUser): Promise<APIRequestContext> {
  const api = await newApi();
  await loginStaff(api, username);
  return api;
}
