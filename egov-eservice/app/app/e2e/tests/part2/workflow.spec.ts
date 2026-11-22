import type { Page } from '@playwright/test';
import {
  apiError, auditFilters, caseApi, caseNo, caseStatus, expect, go, http, iso, json, openCase,
  readCase, readDashboard, reason, resetTime, row, somying, staffCaseApi, test,
} from './_helpers';
import type { Session } from './_helpers';

async function buttons(page: Page, present: string[], absent: string[] = []) {
  for (const name of present) await expect(page.getByTestId(`${name}-btn`)).toHaveCount(1);
  for (const name of absent) await expect(page.getByTestId(`${name}-btn`)).toHaveCount(0);
}

async function enterReason(page: Page, action: 'return' | 'reject', text: string) {
  const input = page.getByTestId(`${action}-reason`);
  if (!(await input.isVisible())) await page.getByTestId(`${action}-btn`).click();
  await input.fill(text);
  await page.getByTestId(`${action}-submit`).click();
}

async function issueOnPage(page: Page, docNo?: string): Promise<string> {
  await page.getByTestId('issue-btn').click();
  await caseStatus(page, 'COMPLETED');
  if (docNo) await expect(page.getByTestId('doc-no')).toHaveText(docNo);
  const code = page.getByTestId('verify-code');
  await expect(code).toHaveText(/^[A-Z0-9]{8}$/);
  return (await code.innerText()).trim();
}

async function returnTwice(officer: Session, citizen: Session, n: number, owner: string) {
  for (const count of [1, 2]) {
    await openCase(officer, 'officer', n);
    await expect(officer.page.getByTestId('return-count')).toHaveText(String(count - 1));
    await enterReason(officer.page, 'return', reason);
    await caseStatus(officer.page, 'NEED_FIX');
    await expect(officer.page.getByTestId('return-count')).toHaveText(String(count));
    await openCase(citizen, 'citizen', n);
    await citizen.page.getByTestId('submit-fix-btn').click();
    await caseStatus(citizen.page, 'IN_REVIEW');
    expect(await readCase(officer, n)).toMatchObject({ owner, status: 'IN_REVIEW', returnCount: count });
  }
  await openCase(officer, 'officer', n);
}

test('TC-WORKFLOW-01 SV-01 approval, issue and citizen download', async ({ scenario }) => {
  const holder = await scenario.loginStaff('off.reg2');
  await openCase(holder, 'officer', 25);
  await caseStatus(holder.page, 'IN_REVIEW');
  await buttons(holder.page, ['approve', 'return', 'reject'], ['forward', 'issue']);
  await expect(holder.page.getByTestId('case-fee')).toHaveText('฿60');

  const other = await scenario.loginStaff('off.reg1');
  await apiError(await other.api.post(`${caseApi(26)}/approve`), 403, 'FORBIDDEN');

  await holder.page.getByTestId('approve-btn').click();
  await caseStatus(holder.page, 'APPROVED');
  await buttons(holder.page, ['issue'], ['approve']);
  await issueOnPage(holder.page, 'DOC-2569-000002');
  await iso(holder.page.getByTestId('closed-at'), resetTime);
  await expect(holder.page.getByTestId('sla-level')).toHaveText('ปิดแล้ว');

  const citizen = await scenario.loginCitizen(somying);
  await openCase(citizen, 'citizen', 25);
  await caseStatus(citizen.page, 'COMPLETED');
  await expect(citizen.page.getByTestId('download-doc-btn')).toHaveCount(1);
  const [download] = await Promise.all([
    citizen.page.waitForEvent('download'),
    citizen.page.getByTestId('download-doc-btn').click(),
  ]);
  expect(download.suggestedFilename()).toBe('DOC-2569-000002.pdf');
  expect(await download.failure()).toBeNull();
  const pdf = await citizen.api.get('/api/documents/DOC-2569-000002/pdf');
  await http(pdf, 200);
  expect(pdf.headers()['content-type']).toMatch(/^application\/pdf\b/);
  expect(pdf.headers()['content-disposition']).toContain('DOC-2569-000002.pdf');
  expect((await pdf.body()).toString('latin1')).toContain('docNo=DOC-2569-000002 caseNo=EG-2569-000025');

  expect(await readDashboard(await scenario.loginStaff('exec1')))
    .toMatchObject({ closed: 1, onTime: 1, received: 3, backlog: 20 });
});

test('TC-WORKFLOW-02 SV-02 routes through head and back to the issuer', async ({ scenario }) => {
  test.setTimeout(60_000);
  const holder = await scenario.loginStaff('off.reg2');
  await openCase(holder, 'officer', 13);
  await buttons(holder.page, ['forward'], ['approve']);
  await expect(holder.page.getByTestId('forward-target')).toHaveCount(0);
  await holder.page.getByTestId('forward-btn').click();
  await caseStatus(holder.page, 'PENDING_APPROVAL');
  await go(holder.page, '/officer/queue');
  await expect(holder.page.getByTestId('workload-count')).toHaveText('8');
  await expect(row(holder.page, 'queue-row', 'case-no', caseNo(13))).toHaveCount(0);

  const head = await scenario.loginStaff('head1');
  await go(head.page, '/head/approvals');
  await expect(head.page.getByTestId('approval-row').getByTestId('row-case-no'))
    .toHaveText([caseNo(13), caseNo(14), caseNo(11)]);
  await row(head.page, 'approval-row', 'case-no', caseNo(13)).getByTestId('approval-open').click();
  await buttons(head.page, ['approve', 'reject'], ['issue']);
  await head.page.getByTestId('approve-btn').click();
  await caseStatus(head.page, 'APPROVED');
  await buttons(head.page, [], ['issue']);

  const other = await scenario.loginStaff('off.reg1');
  await openCase(other, 'officer', 13);
  await buttons(other.page, [], ['issue']);
  await apiError(await other.api.post(`${staffCaseApi(13)}/issue`), 403, 'FORBIDDEN');

  await openCase(holder, 'officer', 13);
  let verify = await issueOnPage(holder.page, 'DOC-2569-000002');
  let visitor = await scenario.anonymous();
  await go(visitor.page, `/verify/${verify}`);
  await expect(visitor.page.getByTestId('verify-signer')).toHaveText('หัวหน้าฝ่าย');

  await scenario.reset();
  const issuer = await scenario.loginStaff('off.reg1');
  await openCase(issuer, 'officer', 19);
  await caseStatus(issuer.page, 'APPROVED');
  verify = await issueOnPage(issuer.page, 'DOC-2569-000002');
  visitor = await scenario.anonymous();
  await go(visitor.page, `/verify/${verify}`);
  await expect(visitor.page.getByTestId('verify-signer')).toHaveText('หัวหน้าฝ่าย');
});

test('TC-WORKFLOW-03 SV-03 passes registry, works and head in order', async ({ scenario }) => {
  test.setTimeout(60_000);
  const registry = await scenario.loginStaff('off.reg2');
  await openCase(registry, 'officer', 12);
  await expect(registry.page.getByTestId('case-step')).toHaveText('ขั้นตอน 1/3 · ฝ่ายทะเบียน');
  await expect(registry.page.getByTestId('case-fee')).toHaveText('฿1,010');
  await buttons(registry.page, ['forward']);
  await registry.page.getByTestId('forward-btn').click();
  await caseStatus(registry.page, 'IN_REVIEW');
  await expect(registry.page.getByTestId('case-step')).toHaveText('ขั้นตอน 2/3 · ฝ่ายโยธา');
  await expect(registry.page.getByTestId('case-owner')).toHaveText('ยังไม่มีผู้รับ');
  await go(registry.page, '/officer/queue');
  await expect(registry.page.getByTestId('workload-count')).toHaveText('8');
  await expect(registry.page.getByTestId('queue-row')).toHaveCount(16);
  await expect(row(registry.page, 'queue-row', 'case-no', caseNo(12))).toHaveCount(0);

  const works = await scenario.loginStaff('off.works1');
  await go(works.page, '/officer/queue');
  await expect(works.page.getByTestId('queue-row').getByTestId('row-case-no'))
    .toHaveText([caseNo(10), caseNo(12)]);
  await expect(works.page.getByTestId('claim-btn')).toHaveCount(2);
  const other = await scenario.loginStaff('off.reg1');
  await apiError(await other.api.post(`${staffCaseApi(12)}/claim`), 403, 'FORBIDDEN');

  await row(works.page, 'queue-row', 'case-no', caseNo(12)).getByTestId('claim-btn').click();
  await expect.poll(async () => (await readCase(works, 12)).owner).toBe('off.works1');
  await openCase(works, 'officer', 12);
  await expect(works.page.getByTestId('case-owner')).toHaveText('off.works1');
  await works.page.getByTestId('forward-btn').click();
  await caseStatus(works.page, 'PENDING_APPROVAL');
  await expect(works.page.getByTestId('case-step')).toHaveText('ขั้นตอน 3/3 · หัวหน้าฝ่าย');

  const head = await scenario.loginStaff('head1');
  await go(head.page, '/head/approvals');
  await expect(head.page.getByTestId('approval-row')).toHaveCount(3);
  await row(head.page, 'approval-row', 'case-no', caseNo(12)).getByTestId('approval-open').click();
  await head.page.getByTestId('approve-btn').click();
  await caseStatus(head.page, 'APPROVED');

  await openCase(works, 'officer', 12);
  await buttons(works.page, [], ['issue']);
  await openCase(registry, 'officer', 12);
  await buttons(registry.page, ['issue']);
  const code = await issueOnPage(registry.page);
  const visitor = await scenario.anonymous();
  await go(visitor.page, `/verify/${code}`);
  await expect(visitor.page.getByTestId('verify-signer')).toHaveText('หัวหน้าฝ่าย');
});

test('TC-WORKFLOW-04 two returns and valid decisions after the limit', async ({ scenario }) => {
  test.setTimeout(90_000);
  const assertLimit = async (officer: Session, n: number) => {
    await expect(officer.page.getByTestId('return-count')).toHaveText('2');
    await buttons(officer.page, ['approve', 'reject'], ['return']);
    await apiError(await officer.api.post(`${staffCaseApi(n)}/return`, { data: { reason } }),
      409, 'RETURN_LIMIT', 'ตีกลับได้สูงสุด 2 ครั้ง');
    expect(await readCase(officer, n)).toMatchObject({ status: 'IN_REVIEW', returnCount: 2 });
  };

  let officer = await scenario.loginStaff('off.reg1');
  await returnTwice(officer, await scenario.loginCitizen(), 20, 'off.reg1');
  await assertLimit(officer, 20);

  await scenario.reset();
  officer = await scenario.loginStaff('off.reg1');
  await openCase(officer, 'officer', 23);
  await assertLimit(officer, 23);

  await scenario.reset();
  officer = await scenario.loginStaff('off.reg2');
  await returnTwice(officer, await scenario.loginCitizen(), 13, 'off.reg2');
  await buttons(officer.page, ['forward'], ['return', 'approve', 'reject']);
  await apiError(await officer.api.post(`${caseApi(13)}/reject`, { data: { reason } }), 403, 'FORBIDDEN');
  const note = 'ส่งต่อให้หัวหน้าพิจารณา';
  await officer.page.getByTestId('forward-note').fill(note);
  await officer.page.getByTestId('forward-btn').click();
  await caseStatus(officer.page, 'PENDING_APPROVAL');

  const auditor = await scenario.loginStaff('audit1');
  await go(auditor.page, '/audit');
  await auditFilters(auditor.page, { event: 'FORWARD' });
  await expect(row(auditor.page, 'audit-row', 'case-no', caseNo(13)).getByTestId('audit-detail')).toContainText(note);
  const head = await scenario.loginStaff('head1');
  await openCase(head, 'officer', 13);
  await buttons(head.page, ['reject', 'approve']);
});

test('TC-WORKFLOW-05 return and reject reasons count trimmed characters', async ({ scenario }) => {
  test.setTimeout(60_000);
  const message = 'กรุณากรอกเหตุผลอย่างน้อย 10 ตัวอักษร';
  let officer = await scenario.loginStaff('off.reg1');
  await openCase(officer, 'officer', 20);
  for (const invalid of ['xxxxxxxxx', ' '.repeat(10)]) {
    await enterReason(officer.page, 'return', invalid);
    await expect(officer.page.getByTestId('return-reason-error')).toHaveText(message);
    await apiError(await officer.api.post(`${staffCaseApi(20)}/return`, { data: { reason: invalid } }),
      400, 'REASON_TOO_SHORT', message);
    await caseStatus(officer.page, 'IN_REVIEW');
  }
  await enterReason(officer.page, 'return', reason);
  await caseStatus(officer.page, 'NEED_FIX');
  let citizen = await scenario.loginCitizen();
  await openCase(citizen, 'citizen', 20);
  await expect(citizen.page.getByTestId('return-reason-display')).toHaveText(reason);

  await scenario.reset();
  officer = await scenario.loginStaff('off.reg2');
  await openCase(officer, 'officer', 26);
  await enterReason(officer.page, 'reject', 'xxxxxxxxx');
  await expect(officer.page.getByTestId('reject-reason-error')).toHaveText(message);
  await apiError(await officer.api.post(`${caseApi(26)}/reject`, { data: { reason: 'xxxxxxxxx' } }),
    400, 'REASON_TOO_SHORT', message);
  await enterReason(officer.page, 'reject', reason);
  await caseStatus(officer.page, 'REJECTED');
  await iso(officer.page.getByTestId('closed-at'), resetTime);
  await expect(officer.page.getByTestId('sla-level')).toHaveText('ปิดแล้ว');
  citizen = await scenario.loginCitizen();
  await openCase(citizen, 'citizen', 26);
  await expect(citizen.page.getByTestId('no-refund-note')).toHaveText('ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
  expect(await readDashboard(await scenario.loginStaff('exec1'))).toMatchObject({ closed: 1, onTime: 1 });

  await scenario.reset();
  const head = await scenario.loginStaff('head1');
  const reject = `${caseApi(11)}/reject`;
  await apiError(await head.api.post(reject, { data: { reason: 'xxxxxxxxx' } }), 400, 'REASON_TOO_SHORT', message);
  expect(await json(await head.api.post(reject, { data: { reason } }))).toMatchObject({ status: 'REJECTED' });
  expect((await readCase(head, 11)).status).toBe('REJECTED');
});

test('TC-WORKFLOW-06 correction expires at exactly 168 hours', async ({ scenario }) => {
  let citizen = await scenario.loginCitizen();
  await openCase(citizen, 'citizen', 17);
  await caseStatus(citizen.page, 'NEED_FIX');
  await expect(citizen.page.getByTestId('return-reason-display')).toHaveText('ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข');
  const deadline = '2026-12-04T14:00:00+07:00';
  await expect(citizen.page.getByTestId('fix-deadline')).toHaveText('4 ธ.ค. 2569 14:00');
  await iso(citizen.page.getByTestId('fix-deadline'), deadline);
  await buttons(citizen.page, ['submit-fix']);

  await scenario.reset();
  await scenario.clock('2026-12-04T13:59:00+07:00');
  citizen = await scenario.loginCitizen();
  await openCase(citizen, 'citizen', 17);
  const submit = citizen.page.getByTestId('submit-fix-btn');
  await expect(submit).toBeEnabled();
  await submit.click();
  await caseStatus(citizen.page, 'IN_REVIEW');
  expect((await readCase(citizen, 17)).status).toBe('IN_REVIEW');

  await scenario.reset();
  await scenario.clock('2026-12-04T13:59:00+07:00');
  citizen = await scenario.loginCitizen();
  expect(await json(await citizen.api.post(`${caseApi(17)}/resubmit`))).toMatchObject({ status: 'IN_REVIEW' });

  await scenario.reset();
  await scenario.clock(deadline);
  citizen = await scenario.loginCitizen();
  await openCase(citizen, 'citizen', 17);
  await caseStatus(citizen.page, 'CANCELLED');
  await buttons(citizen.page, [], ['submit-fix']);
  await expect(citizen.page.getByTestId('no-refund-note')).toHaveText('ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
  await http(await citizen.api.post(`${caseApi(17)}/resubmit`), 409);
  await expect(citizen.page.getByTestId('case-timeline').getByTestId('timeline-item')
    .and(citizen.page.locator(`[data-iso="${deadline}"]`))).toHaveCount(1);
  expect(await readDashboard(await scenario.loginStaff('exec1'))).toMatchObject({ backlog: 20 });
});
