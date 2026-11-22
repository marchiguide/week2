import { expect, request, test as base } from '@playwright/test';
import type {
  APIRequestContext, APIResponse, Browser, BrowserContext, BrowserContextOptions, Locator, Page,
} from '@playwright/test';

export { expect };

export const resetTime = '2026-12-01T09:00:00+07:00';
export const somchai = '1101700123456';
export const somying = '3100600987659';
export const piti = '1909900555015';
export const mana = '5500400111221';
export const reason = 'xxxxxxxxxx';
export const idMask = /^X-XXXX-XXXXX-\d{2}-\d$/;

export const statuses = {
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

export const slaLevels = {
  normal: 'ปกติ',
  near: 'ใกล้ครบกำหนด',
  overdue: 'เกินกำหนด',
  paused: 'หยุดนับ',
  closed: 'ปิดแล้ว',
};

export interface Session {
  page: Page;
  api: APIRequestContext;
}

type Staff = 'off.reg1' | 'off.reg2' | 'off.works1' | 'head1' | 'exec1' | 'audit1' | 'admin1';
type Draft =
  | { serviceId: 'SV-01'; qty: number }
  | { serviceId: 'SV-02' }
  | { serviceId: 'SV-03'; areaSqm: number };

export interface CaseData {
  caseNo: string;
  status: keyof typeof statuses;
  owner: string | null;
  returnCount: number;
  dueAt: string;
  idMasked?: string;
  idNo?: string;
}

export interface AuditEntry {
  id: number;
  time: string;
  username: string;
  role: string;
  event: string;
  caseNo: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  detail: string;
}

export interface Dashboard {
  received: number;
  closed: number;
  onTime: number;
  ontimePct: number | null;
  backlog: number;
  overdue: number;
  workload: { username: string; count: number }[];
}

export function caseNo(n: number): string {
  return `EG-2569-${String(n).padStart(6, '0')}`;
}

export function caseApi(n: number): string {
  return `/api/cases/${caseNo(n)}`;
}

export function staffCaseApi(n: number): string {
  return `/api/officer/cases/${caseNo(n)}`;
}

export async function http(response: APIResponse, status: number): Promise<void> {
  expect(response.status(), `${response.url()} HTTP status`).toBe(status);
}

export async function json<T = unknown>(response: APIResponse, status = 200): Promise<T> {
  await http(response, status);
  return response.json();
}

export async function apiError(
  response: APIResponse,
  status: number,
  code: string,
  message?: string,
): Promise<void> {
  const data = await json(response, status);
  expect(data).toMatchObject(message === undefined ? { code } : { code, message });
}

export async function go(page: Page, path: string, status = 200): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), `${path} HTTP status`).toBe(status);
}

export function openCase(session: Session, area: 'officer' | 'citizen', n: number): Promise<void> {
  return go(session.page, `/${area}/cases/${caseNo(n)}`);
}

export function readCase(session: Session, n: number): Promise<CaseData> {
  return session.api.get(caseApi(n)).then(response => json<CaseData>(response));
}

export async function caseStatus(page: Page, status: keyof typeof statuses): Promise<void> {
  const element = page.getByTestId('case-status');
  await expect(element).toHaveText(statuses[status]);
  await expect(element).toHaveAttribute('data-status', status);
}

export function iso(element: Locator, dateTime: string): Promise<void> {
  return expect(element).toHaveAttribute('data-iso', dateTime);
}

export function row(page: Page, testId: string, attr: string, value: string): Locator {
  return page.getByTestId(testId).and(page.locator(`[data-${attr}="${value}"]`));
}

export function readDashboard(session: Session, period = '2026-12', service = 'ALL'): Promise<Dashboard> {
  return session.api.get('/api/dashboard', { params: { period, service } })
    .then(response => json<Dashboard>(response));
}

export async function auditFilters(
  page: Page,
  filters: { actor?: string; event?: string; from?: string; to?: string } = {},
): Promise<void> {
  const actor = page.getByTestId('audit-filter-actor');
  if (await actor.evaluate(element => element.tagName === 'SELECT')) {
    await actor.selectOption(filters.actor ?? '');
  } else {
    await actor.fill(filters.actor ?? '');
  }
  await page.getByTestId('audit-filter-event').selectOption(filters.event ?? '');
  await page.getByTestId('audit-filter-from').fill(filters.from ?? '');
  await page.getByTestId('audit-filter-to').fill(filters.to ?? '');
  await page.getByTestId('audit-apply-btn').click();
}

export function readAudit(
  session: Session,
  params: Record<string, string> = {},
): Promise<{ count: number; items: AuditEntry[] }> {
  return session.api.get('/api/audit', { params })
    .then(response => json<{ count: number; items: AuditEntry[] }>(response));
}

export function pdfFile(name = 'id-card.pdf') {
  const header = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n';
  const trailer = '\ntrailer<</Root 1 0 R>>\n%%EOF\n';
  return {
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(header + ' '.repeat(1024 - header.length - trailer.length) + trailer),
  };
}

export async function approve(session: Session, n: number): Promise<void> {
  expect(await json(await session.api.post(`${caseApi(n)}/approve`)))
    .toMatchObject({ status: 'APPROVED' });
}

export async function issue(session: Session, n: number): Promise<{ docNo: string; verifyCode: string }> {
  const data = await json<{ docNo: string; verifyCode: string; status: string }>(
    await session.api.post(`${staffCaseApi(n)}/issue`),
  );
  expect(data.status).toBe('COMPLETED');
  expect(data.verifyCode).toMatch(/^[A-Z0-9]{8}$/);
  return data;
}

class Scenario {
  private readonly contexts: BrowserContext[] = [];

  constructor(
    private readonly browser: Browser,
    private readonly hooks: APIRequestContext,
    readonly baseURL: string,
    private readonly contextOptions: BrowserContextOptions,
  ) {}

  async closeSessions(): Promise<void> {
    await Promise.all(this.contexts.splice(0).map(context => context.close()));
  }

  async reset(): Promise<void> {
    await this.closeSessions();
    expect(await json(await this.hooks.post('/api/test/reset')))
      .toMatchObject({ ok: true, now: resetTime });
  }

  async clock(now: string): Promise<void> {
    expect(await json(await this.hooks.put('/api/test/clock', { data: { now } }))).toEqual({ now });
  }

  async anonymous(): Promise<Session> {
    const context = await this.browser.newContext({
      ...this.contextOptions, baseURL: this.baseURL, acceptDownloads: true,
    });
    this.contexts.push(context);
    return { page: await context.newPage(), api: context.request };
  }

  async loginCitizen(idNo = somchai): Promise<Session> {
    const session = await this.anonymous();
    expect(await json(await session.api.post('/api/auth/thaid/start', { data: { idNo } })))
      .toMatchObject({ status: 'OTP_SENT' });
    expect(await json(await session.api.post('/api/auth/thaid/verify', { data: { idNo, otp: '123456' } })))
      .toMatchObject({ registered: idNo !== mana });
    return session;
  }

  async loginStaff(username: Staff): Promise<Session> {
    const session = await this.anonymous();
    await http(await session.api.post('/api/auth/staff/login', {
      data: { username, password: 'Test@1234' },
    }), 200);
    return session;
  }

  async pay(ref: string, amount: number): Promise<APIResponse> {
    return this.hooks.post(`/api/test/payments/${ref}/pay`, { data: { amount } });
  }

  async newPaid(
    now: string,
    draft: Draft,
    expectedFee: number,
    idNo = somchai,
  ): Promise<{ caseNo: string; citizen: Session }> {
    await this.clock(now);
    const citizen = await this.loginCitizen(idNo);
    const { draftId, fee } = await json<{ draftId: string; fee: number }>(
      await citizen.api.post('/api/drafts', { data: draft }), 201,
    );
    expect(fee).toBe(expectedFee);
    const required = { 'SV-01': ['id-card'], 'SV-02': ['id-card', 'map'], 'SV-03': ['id-card', 'plan', 'deed'] };
    for (const docKey of required[draft.serviceId]) {
      await http(await citizen.api.post(`/api/drafts/${draftId}/files`, {
        multipart: { docKey, file: pdfFile(`${docKey}.pdf`) },
      }), 201);
    }
    const { ref, amount } = await json<{ ref: string; amount: number }>(
      await citizen.api.post(`/api/drafts/${draftId}/payment`), 201,
    );
    expect(amount).toBe(expectedFee);
    const paid = await json<{ caseNo: string; status: string }>(await this.pay(ref, expectedFee));
    expect(paid.status).toBe('PAID');
    const payment = await json<{ caseNo: string; status: string }>(await citizen.api.get(`/api/payments/${ref}`));
    expect(payment).toMatchObject({ status: 'PAID', caseNo: paid.caseNo });
    expect(payment.caseNo).toMatch(/^EG-\d{4}-\d{6}$/);
    return { caseNo: payment.caseNo, citizen };
  }
}

// TEST-PLAN §0: reset the shared seed before each test and rebuild sessions after repeated resets.
export const test = base.extend<{ scenario: Scenario }>({
  scenario: async ({ browser, baseURL, contextOptions, locale, timezoneId, viewport }, use) => {
    const url = process.env.BASE_URL || baseURL;
    if (!url) throw new Error('Set BASE_URL or Playwright use.baseURL');
    const hooks = await request.newContext({ baseURL: url });
    const scenario = new Scenario(browser, hooks, url, { ...contextOptions, locale, timezoneId, viewport });
    try {
      await scenario.reset();
      await use(scenario);
    } finally {
      await scenario.closeSessions();
      await hooks.dispose();
    }
  },
});
