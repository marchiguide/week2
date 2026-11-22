import { test as base, expect, type Browser, type BrowserContext, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { BASE_URL, ID, type StaffUser } from './env';
import { CLOCK, RESET, loginCitizen, loginStaff, newApi } from './api';

/** ผู้ใช้หนึ่งคน = browser context ของตัวเอง (cookie แยก) · api ใช้ cookie ร่วมกับ page */
export interface Actor {
  who: string;
  ctx: BrowserContext;
  page: Page;
  api: APIRequestContext;
}

/**
 * ตัวช่วยต่อ test: สร้าง context ใหม่ทุกครั้งที่ล็อกอิน (หลัง RESET ห้ามใช้ cookie เก่า · CONTRACT 0.9)
 * และปิดทุก context ตอนจบ test
 */
export class App {
  private contexts: BrowserContext[] = [];
  private apis: APIRequestContext[] = [];

  constructor(private readonly browser: Browser, private readonly info: TestInfo) {}

  /** RESET (TEST-PLAN §0) · actor ที่สร้างก่อนหน้านี้ใช้ต่อไม่ได้ */
  async reset(): Promise<void> {
    await RESET();
  }

  async clock(now: string): Promise<void> {
    await CLOCK(now);
  }

  private async newActor(who: string): Promise<Actor> {
    const ctx = await this.browser.newContext({
      baseURL: BASE_URL,
      locale: 'th-TH',
      timezoneId: 'Asia/Bangkok',
      viewport: { width: 1280, height: 900 },
      ...(process.env.PW_VIDEO === '1' ? { recordVideo: { dir: this.info.outputPath('videos') } } : {}),
    });
    this.contexts.push(ctx);
    const page = await ctx.newPage();
    return { who, ctx, page, api: ctx.request };
  }

  /** browser context ที่ยังไม่ล็อกอิน */
  async anon(): Promise<Actor> {
    return this.newActor('anon');
  }

  /** LOGIN_C(เลขบัตร) ผ่าน API ใน context ใหม่ (cookie ใช้ได้ทั้ง page และ api) */
  async citizen(idNo: string = ID.somchai): Promise<Actor> {
    const a = await this.newActor(idNo);
    await loginCitizen(a.api, idNo);
    return a;
  }

  /** LOGIN_S(user) ผ่าน API ใน context ใหม่ */
  async staff(username: StaffUser): Promise<Actor> {
    const a = await this.newActor(username);
    await loginStaff(a.api, username);
    return a;
  }

  /** request context เปล่า (ไม่มี cookie) */
  async rawApi(): Promise<APIRequestContext> {
    const api = await newApi();
    this.apis.push(api);
    return api;
  }

  async dispose(): Promise<void> {
    for (const c of this.contexts) await c.close().catch(() => undefined);
    for (const a of this.apis) await a.dispose().catch(() => undefined);
  }
}

export const test = base.extend<{ app: App }>({
  app: async ({ browser }, use, testInfo) => {
    const app = new App(browser, testInfo);
    await use(app);
    await app.dispose();
  },
});

export { expect };
