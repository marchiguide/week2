import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import AxeBuilder from '@axe-core/playwright';
import { request } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  apiError, caseApi, caseNo, expect, go, http, json, mana, pdfFile, piti, readDashboard,
  resetTime, slaLevels, somchai, somying, staffCaseApi, statuses, test,
} from './_helpers';
import type { CaseData, Session } from './_helpers';

async function citizenLoginOnPage(page: Page) {
  await go(page, '/login');
  await page.getByTestId('thaid-id-input').fill(somchai);
  await page.getByTestId('thaid-submit').click();
  await page.getByTestId('otp-input').fill('123456');
  await page.getByTestId('otp-submit').click();
  await expect(page).toHaveURL(/\/citizen$/);
}

test('TC-NFR-01 eleven routes fit desktop, tablet and mobile viewports', async ({ scenario }) => {
  test.setTimeout(120_000);
  const visitor = await scenario.anonymous();
  const citizen = await scenario.loginCitizen();
  const officer = await scenario.loginStaff('off.reg1');
  const head = await scenario.loginStaff('head1');
  const executive = await scenario.loginStaff('exec1');
  const auditor = await scenario.loginStaff('audit1');
  const admin = await scenario.loginStaff('admin1');
  const routes: [Session, string][] = [
    [visitor, '/login'],
    [citizen, '/citizen'], [citizen, '/citizen/new/SV-03'], [citizen, `/citizen/cases/${caseNo(13)}`],
    [officer, '/officer/queue'], [officer, `/officer/cases/${caseNo(20)}`],
    [head, '/head/approvals'], [executive, '/dashboard'], [auditor, '/audit'], [admin, '/admin/services'],
    [visitor, '/verify/K7M2Q9XA'],
  ];
  for (const [width, height] of [[375, 812], [768, 1024], [1280, 800]]) {
    for (const [session, path] of routes) {
      await test.step(`${width}×${height} ${path}`, async () => {
        await session.page.setViewportSize({ width, height });
        await go(session.page, path);
        await session.page.evaluate(() => document.fonts.ready.then(() => undefined));
        const viewport = await session.page.evaluate(() => ({
          document: document.documentElement.scrollWidth,
          window: window.innerWidth,
        }));
        expect(viewport.document, `horizontal overflow at ${path}`).toBeLessThanOrEqual(viewport.window);
      });
    }
  }

  const mobile = (await scenario.anonymous()).page;
  await mobile.setViewportSize({ width: 375, height: 812 });
  await citizenLoginOnPage(mobile);
  await mobile.getByTestId('start-service-SV-01').click();
  await mobile.getByTestId('qty-input').fill('1');
  await expect(mobile.getByTestId('fee-total')).toHaveText('฿20');
  await mobile.getByTestId('to-upload-btn').click();
  await mobile.getByTestId('upload-input-id-card').setInputFiles(pdfFile());
  const pay = mobile.getByTestId('to-payment-btn');
  await expect(pay).toBeEnabled();
  await pay.click();
  const qr = mobile.getByTestId('create-qr-btn');
  await expect(qr).toBeVisible();
  const bounds = await qr.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
});

async function assertVisibleFocus(page: Page) {
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    const visible = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0)
      || style.boxShadow !== 'none';
    return { name: element.getAttribute('data-testid') ?? element.outerHTML.split('>')[0], visible };
  });
  if (focus) expect(focus.visible, `visible focus indicator for ${focus.name}`).toBe(true);
}

async function tabTo(page: Page, testId: string) {
  const target = page.getByTestId(testId);
  await expect(target).toBeVisible();
  const isFocused = () => target.evaluate(element => element === document.activeElement);
  for (let presses = 0; presses < 80 && !(await isFocused()); presses++) {
    await page.keyboard.press('Tab');
    await assertVisibleFocus(page);
  }
  await expect(target).toBeFocused();
  await assertVisibleFocus(page);
}

async function statusText(page: Page): Promise<string[]> {
  const text: string[] = [];
  for (const [testId, attr, labels] of [
    ['case-status', 'data-status', statuses], ['row-status', 'data-status', statuses],
    ['sla-level', 'data-level', slaLevels], ['row-sla-level', 'data-level', slaLevels],
  ] as const) {
    const elements = page.getByTestId(testId);
    for (const element of await elements.all()) {
      await expect(element).toBeVisible();
      const code = await element.evaluate((node, { testId, attr }) => {
        const ownCode = node.getAttribute(attr);
        if (ownCode !== null || !testId.startsWith('row-')) return ownCode;
        const rowAttr = testId === 'row-sla-level' ? 'data-sla-level' : attr;
        return node.closest(`[${rowAttr}]`)?.getAttribute(rowAttr) ?? null;
      }, { testId, attr });
      const expected = Object.entries(labels).find(([key]) => key === code)?.[1];
      expect(expected, `${testId} has a recognized ${attr} (${code})`).toBeDefined();
      await expect(element).toHaveText(expected!);
      text.push((await element.innerText()).trim());
    }
  }
  return text;
}

test('TC-NFR-02 WCAG scans, labeled controls, keyboard flow and status text', async ({ scenario }) => {
  test.setTimeout(180_000);
  const visitor = await scenario.anonymous();
  const firstTimeCitizen = await scenario.loginCitizen(mana);
  const citizen = await scenario.loginCitizen();
  const officer = await scenario.loginStaff('off.reg1');
  const head = await scenario.loginStaff('head1');
  const executive = await scenario.loginStaff('exec1');
  const auditor = await scenario.loginStaff('audit1');
  const admin = await scenario.loginStaff('admin1');
  const routes: [Session, string, boolean?][] = [
    [visitor, '/login'],
    [firstTimeCitizen, '/register'],
    [citizen, '/citizen', true], [citizen, '/citizen/new/SV-01'], [citizen, `/citizen/cases/${caseNo(17)}`, true],
    [officer, '/officer/queue', true], [officer, `/officer/cases/${caseNo(20)}`, true],
    [head, '/head/approvals'], [executive, '/dashboard'], [auditor, '/audit'], [admin, '/admin/services'],
    [officer, '/notifications'], [visitor, '/verify/K7M2Q9XA'],
  ];
  for (const [{ page }, path, hasStatuses] of routes) {
    await test.step(`accessibility of ${path}`, async () => {
      await go(page, path);
      const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
      const result = await new AxeBuilder({ page }).withTags(tags).analyze();
      const severe = result.violations.filter(violation =>
        violation.impact === 'serious' || violation.impact === 'critical');
      expect(severe.map(({ id, impact, nodes }) => ({
        id, impact, targets: nodes.map(node => node.target),
      }))).toEqual([]);

      for (const control of await page.locator('input:visible, select:visible, textarea:visible').all()) {
        await expect(control).toHaveAccessibleName(/\S/);
      }

      const defaultText = await statusText(page);
      if (hasStatuses) expect(defaultText.length).toBeGreaterThan(0);
      if (defaultText.length) {
        await page.emulateMedia({ forcedColors: 'active' });
        try {
          expect(await statusText(page)).toEqual(defaultText);
        } finally {
          await page.emulateMedia({ forcedColors: 'none' });
        }
      }
    });
  }

  const page = (await scenario.anonymous()).page;
  await go(page, '/login');
  await tabTo(page, 'thaid-id-input');
  await page.keyboard.type(somchai);
  await page.keyboard.press('Enter');
  await tabTo(page, 'otp-input');
  await page.keyboard.type('123456');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/citizen$/);

  await tabTo(page, 'start-service-SV-01');
  await page.keyboard.press('Enter');
  await tabTo(page, 'qty-input');
  await expect(page.getByTestId('qty-input')).toHaveValue('1');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('1');
  await tabTo(page, 'to-upload-btn');
  await page.keyboard.press('Enter');

  await tabTo(page, 'upload-input-id-card');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const chooser = await chooserPromise;
  await chooser.setFiles(pdfFile());
  await tabTo(page, 'to-payment-btn');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('create-qr-btn')).toBeVisible();
});

test('TC-NFR-03 health, warm page loads, deterministic reset and hook validation', async ({ scenario }) => {
  test.setTimeout(90_000);
  const visitor = await scenario.anonymous();
  expect(await json(await visitor.api.get('/api/health'))).toEqual({ status: 'ok' });

  const citizen = await scenario.loginCitizen();
  const officer = await scenario.loginStaff('off.reg1');
  const executive = await scenario.loginStaff('exec1');
  const auditor = await scenario.loginStaff('audit1');
  for (const [{ page }, path] of [
    [visitor, '/login'], [citizen, '/citizen'], [officer, '/officer/queue'],
    [executive, '/dashboard'], [auditor, '/audit'],
  ] as const) {
    await go(page, path);
    const start = performance.now();
    const navigation = await page.goto(path, { waitUntil: 'load' });
    const elapsed = performance.now() - start;
    expect(navigation?.status()).toBe(200);
    expect(elapsed, `warm load of ${path} in milliseconds`).toBeLessThanOrEqual(3000);
  }

  async function snapshot() {
    const anon = await scenario.anonymous();
    const registry = await scenario.loginStaff('off.reg1');
    const executive = await scenario.loginStaff('exec1');
    const clock = await json(await anon.api.get('/api/test/clock'));
    const queue = await json<{ items: Pick<CaseData, 'caseNo' | 'dueAt' | 'status' | 'owner'>[] }>(
      await registry.api.get('/api/officer/queue'),
    );
    expect(queue.items).toHaveLength(17);
    return {
      clock,
      queue: queue.items.map(({ caseNo, dueAt, status, owner }) => ({ caseNo, dueAt, status, owner })),
      dashboard: await readDashboard(executive),
    };
  }

  await scenario.reset();
  const initial = await snapshot();
  expect(initial.clock).toEqual({ now: resetTime });
  const changedTime = '2026-12-10T12:00:00+07:00';
  await scenario.clock(changedTime);
  const registry = await scenario.loginStaff('off.reg1');
  expect(await json(await registry.api.post(`${staffCaseApi(28)}/claim`))).toMatchObject({ owner: 'off.reg1' });
  expect((await scenario.newPaid(changedTime, { serviceId: 'SV-01', qty: 1 }, 20)).caseNo).toBe(caseNo(31));

  await scenario.reset();
  expect(await snapshot()).toEqual(initial);
  const fresh = await scenario.anonymous();
  await apiError(await fresh.api.put('/api/test/clock', { data: { now: '2026-12-01 09:00' } }),
    400, 'INVALID_TIME');

  if (process.env.NO_TEST_BASE_URL) {
    const production = await request.newContext({ baseURL: process.env.NO_TEST_BASE_URL });
    try {
      await http(await production.post('/api/test/reset'), 404);
    } finally {
      await production.dispose();
    }
  }
});

test('TC-NFR-04 stored citizen IDs and phone numbers are absent in plaintext', async ({ scenario }) => {
  const dbPath = process.env.DB_PATH;
  expect(dbPath, 'DB_PATH must point to the running app database file').toBeTruthy();
  const newCitizen = await scenario.loginCitizen(mana);
  await go(newCitizen.page, '/register');
  await newCitizen.page.getByTestId('reg-mobile').fill('0845678901');
  await newCitizen.page.getByTestId('reg-email').fill('');
  await newCitizen.page.getByTestId('reg-consent').check();
  await newCitizen.page.getByTestId('reg-submit').click();
  await expect(newCitizen.page.getByTestId('citizen-welcome')).toHaveText('สวัสดี มานะ ตั้งใจ');

  const owner = await scenario.loginCitizen();
  expect(await json(await owner.api.get(caseApi(5)))).toMatchObject({ idNo: somchai });

  const sensitiveValues = [
    somchai, somying, piti, mana, '0812345678', '0823456789', '0834567890', '0845678901',
    '1-1017-00123-45-6', '3-1006-00987-65-9', '1-9099-00555-01-5', '5-5004-00111-22-1',
  ];
  const files = [
    { path: dbPath!, optional: false },
    { path: `${dbPath}-wal`, optional: true },
    { path: `${dbPath}-journal`, optional: true },
    ...[process.env.DB_DUMP_PATH, process.env.WEB_LOG_PATH]
      .filter((path): path is string => Boolean(path))
      .map(path => ({ path, optional: false })),
  ];
  for (const { path, optional } of files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!optional && path === dbPath) expect(bytes.length, 'size of active database').toBeGreaterThan(0);
    for (const [index, value] of sensitiveValues.entries()) {
      for (const encoding of ['utf8', 'utf16le'] as const) {
        expect(bytes.includes(Buffer.from(value, encoding)), `${path}: plaintext fixture ${index + 1} (${encoding})`)
          .toBe(false);
      }
    }
  }
  if (process.env.DB_ENCRYPTION_METHOD) {
    test.info().annotations.push({ type: 'database encryption', description: process.env.DB_ENCRYPTION_METHOD });
  }
});
