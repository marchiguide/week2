import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { Workbook } from 'exceljs';
import { PDFParse } from 'pdf-parse';
import {
  approve, auditFilters, caseApi, caseStatus, expect, go, iso, issue, json, openCase,
  readDashboard, reason, row, test,
} from './_helpers';
import type { Session } from './_helpers';

const backlog = {
  ALL: [21, 1],
  'SV-01': [11, 1],
  'SV-02': [7, 0],
  'SV-03': [3, 0],
} as const;
type Service = keyof typeof backlog;

const kpis = [
  ['kpi-received', 'รับเรื่อง'],
  ['kpi-closed', 'ปิดงาน'],
  ['kpi-ontime-pct', 'ทันกำหนด %'],
  ['kpi-backlog', 'งานคงค้าง'],
  ['kpi-overdue', 'เกินกำหนดคงค้าง'],
] as const;

async function assertKpis(page: Page, values: readonly string[]) {
  for (const [index, [testId]] of kpis.entries()) {
    await expect(page.getByTestId(testId)).toHaveText(values[index]);
  }
}

async function assertDashboard(
  executive: Session, period: string, service: Service, received: number, closed: number, onTime: number,
  ontimePct: number | null,
) {
  const [backlogCount, overdue] = backlog[service];
  const percent = ontimePct === null ? '–' : `${ontimePct.toFixed(1)}%`;
  await assertKpis(executive.page, [String(received), String(closed), percent, String(backlogCount), String(overdue)]);
  expect(await readDashboard(executive, period, service))
    .toMatchObject({ received, closed, onTime, ontimePct, backlog: backlogCount, overdue });
}

function assertNoPersonalData(text: string) {
  expect(text).not.toMatch(/\d{13}|0\d{9}|สมชาย|สมหญิง|ปิติ|มานะ/);
}

async function download(page: Page, format: 'xlsx' | 'pdf'): Promise<string> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(`export-${format}-btn`).click(),
  ]);
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`, 'i'));
  expect(await file.failure()).toBeNull();
  return file.path();
}

async function assertWorkbook(executive: Session, values: readonly string[]) {
  await assertKpis(executive.page, values);
  const book = new Workbook();
  await book.xlsx.readFile(await download(executive.page, 'xlsx'));
  const sheet = book.worksheets[0];
  expect([sheet.getCell('A1').value, sheet.getCell('B1').value]).toEqual(['ตัวชี้วัด', 'ค่า']);
  for (const [index, [, label]] of kpis.entries()) {
    expect(sheet.getCell(`A${index + 2}`).value).toBe(label);
    expect(sheet.getCell(`B${index + 2}`).value).toBe(values[index]);
  }
  const cells: string[] = [];
  for (const worksheet of book.worksheets) {
    worksheet.eachRow(sheetRow => sheetRow.eachCell(cell => cells.push(cell.text)));
  }
  assertNoPersonalData(cells.join('\n'));
}

test('TC-DASH-01 December dashboard, workload, privacy and service filters', async ({ scenario }) => {
  const executive = await scenario.loginStaff('exec1');
  const page = executive.page;
  await go(page, '/dashboard');
  await expect(page.getByTestId('period-select')).toHaveValue('2026-12');
  await expect(page.getByTestId('service-select')).toHaveValue('ALL');
  await assertDashboard(executive, '2026-12', 'ALL', 3, 0, 0, null);

  await expect(page.getByTestId('workload-row')).toHaveCount(3);
  const expectedWorkload = [
    { username: 'off.reg1', count: 3 },
    { username: 'off.reg2', count: 9 },
    { username: 'off.works1', count: 0 },
  ];
  for (const { username, count } of expectedWorkload) {
    await expect(row(page, 'workload-row', 'username', username).getByTestId('workload-value'))
      .toHaveText(String(count));
  }
  const { workload } = await readDashboard(executive);
  expect(workload).toEqual(expect.arrayContaining(expectedWorkload));
  expect(workload).toHaveLength(3);
  assertNoPersonalData(await page.locator('body').innerText());

  for (const [service, received] of [['SV-01', 3], ['SV-02', 0], ['SV-03', 0]] as const) {
    await page.getByTestId('service-select').selectOption(service);
    await assertDashboard(executive, '2026-12', service, received, 0, 0, null);
  }
});

test('TC-DASH-02 historical monthly and yearly rates use closed cases', async ({ scenario }) => {
  test.setTimeout(60_000);
  const executive = await scenario.loginStaff('exec1');
  await go(executive.page, '/dashboard');
  const examples = [
    ['2026-10', 'ALL', 1, 1, 1, 100.0],
    ['2026-11', 'ALL', 26, 7, 6, 85.7],
    ['2026-11', 'SV-01', 12, 3, 3, 100.0],
    ['2026-11', 'SV-02', 10, 3, 2, 66.7],
    ['2026-11', 'SV-03', 4, 1, 1, 100.0],
    ['2026', 'ALL', 30, 8, 7, 87.5],
    ['2026', 'SV-01', 16, 4, 4, 100.0],
    ['2026', 'SV-02', 10, 3, 2, 66.7],
    ['2026', 'SV-03', 4, 1, 1, 100.0],
  ] as const;
  for (const [period, service, received, closed, onTime, percent] of examples) {
    await test.step(`${period} ${service}`, async () => {
      await executive.page.getByTestId('period-select').selectOption(period);
      await executive.page.getByTestId('service-select').selectOption(service);
      await assertDashboard(executive, period, service, received, closed, onTime, percent);
    });
  }
});

test('TC-DASH-03 Excel and PDF exports match the KPIs and leave audit entries', async ({ scenario }) => {
  test.setTimeout(60_000);
  const executive = await scenario.loginStaff('exec1');
  const page = executive.page;
  await go(page, '/dashboard');
  await page.getByTestId('service-select').selectOption('ALL');
  await page.getByTestId('period-select').selectOption('2026-11');
  await assertWorkbook(executive, ['26', '7', '85.7%', '21', '1']);

  // Inspect the response used by the download so there is a single audited export.
  const pdfTypes: string[] = [];
  await page.route('**/api/dashboard/export?*', async route => {
    if (new URL(route.request().url()).searchParams.get('format') !== 'pdf') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    pdfTypes.push(response.headers()['content-type']);
    await route.fulfill({ response });
  });
  const pdf = new PDFParse({ data: await readFile(await download(page, 'pdf')) });
  try {
    expect(pdfTypes).toHaveLength(1);
    expect(pdfTypes[0]).toMatch(/^application\/pdf\b/);
    const { text } = await pdf.getText();
    expect(text).toContain('kpi received=26 closed=7 ontime=85.7% backlog=21 overdue=1');
    assertNoPersonalData(text);
  } finally {
    await pdf.destroy();
  }

  await page.getByTestId('period-select').selectOption('2026-12');
  await assertWorkbook(executive, ['3', '0', '–', '21', '1']);

  const auditor = await scenario.loginStaff('audit1');
  await go(auditor.page, '/audit');
  await auditFilters(auditor.page, { event: 'EXPORT' });
  await expect(auditor.page.getByTestId('audit-count')).toHaveText('3');
  const events = auditor.page.getByTestId('audit-row');
  await expect(events).toHaveCount(3);
  const expectedDetails = ['xlsx 2026-12 ALL', 'pdf 2026-11 ALL', 'xlsx 2026-11 ALL'];
  for (const [index, detail] of expectedDetails.entries()) {
    const event = events.nth(index);
    await expect(event).toHaveAttribute('data-actor', 'exec1');
    await expect(event.getByTestId('audit-role')).toHaveText('executive');
    await expect(event.getByTestId('audit-detail')).toContainText(detail);
  }
});

test('TC-DASH-04 closure by 16:30:00 is on time including rejection', async ({ scenario }) => {
  await scenario.clock('2026-12-03T16:00:00+07:00');
  const registry1 = await scenario.loginStaff('off.reg1');
  const registry2 = await scenario.loginStaff('off.reg2');
  const executive = await scenario.loginStaff('exec1');
  await approve(registry2, 25);
  await approve(registry1, 23);

  const steps = [
    { n: 25, time: '16:29:59', holder: registry2, status: 'COMPLETED', closed: 1, onTime: 1 },
    { n: 26, time: '16:30:00', holder: registry2, status: 'REJECTED', closed: 2, onTime: 2 },
    { n: 23, time: '16:30:01', holder: registry1, status: 'COMPLETED', closed: 3, onTime: 2 },
  ] as const;

  for (const { n, time, holder, status, closed, onTime } of steps) {
    const now = `2026-12-03T${time}+07:00`;
    await scenario.clock(now);
    if (status === 'REJECTED') {
      const response = await holder.api.post(`${caseApi(n)}/reject`, { data: { reason } });
      expect(await json(response)).toMatchObject({ status, closedAt: now });
    } else {
      await issue(holder, n);
    }
    await openCase(holder, 'officer', n);
    await caseStatus(holder.page, status);
    await iso(holder.page.getByTestId('closed-at'), now);
    const stats = await readDashboard(executive);
    expect(stats).toMatchObject({ closed, onTime });
    await go(executive.page, '/dashboard');
    await expect(executive.page.getByTestId('kpi-closed')).toHaveText(String(closed));
    if (closed === 3) expect(stats.backlog).toBe(18);
  }
  await expect(executive.page.getByTestId('kpi-backlog')).toHaveText('18');
});
