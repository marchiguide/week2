import {
  apiError, auditFilters, caseApi, caseNo, expect, go, idMask, iso, json, openCase, piti, resetTime,
  row, somchai, somying, staffCaseApi, test,
} from './_helpers';

const somyingFull = '3-1006-00987-65-9';
const somyingMasked = 'X-XXXX-XXXXX-65-9';

test('TC-PDPA-01 ID masking on officer pages and full ID for the owner', async ({ scenario }) => {
  const holder = await scenario.loginStaff('off.reg2');
  await go(holder.page, '/officer/queue');
  const masks = holder.page.getByTestId('row-id-masked');
  await expect(masks).toHaveCount(17);
  for (const mask of await masks.all()) await expect(mask).toHaveText(idMask);
  await expect(row(holder.page, 'queue-row', 'case-no', caseNo(25)).getByTestId('row-id-masked'))
    .toHaveText(somyingMasked);
  await expect(row(holder.page, 'queue-row', 'case-no', caseNo(26)).getByTestId('row-id-masked'))
    .toHaveText('X-XXXX-XXXXX-45-6');

  await openCase(holder, 'officer', 25);
  await expect(holder.page.getByTestId('applicant-id')).toHaveText(somyingMasked);
  const html = await holder.page.content();
  expect(html).not.toContain(somying);
  expect(html).not.toContain(somyingFull);

  const head = await scenario.loginStaff('head1');
  await openCase(head, 'officer', 25);
  await expect(head.page.getByTestId('applicant-id')).toHaveText(somyingMasked);

  const owner = await scenario.loginCitizen(somying);
  await openCase(owner, 'citizen', 25);
  await expect(owner.page.getByTestId('case-id-full')).toHaveText(somyingFull);
  const otherOwner = await scenario.loginCitizen();
  await openCase(otherOwner, 'citizen', 20);
  await expect(otherOwner.page.getByTestId('case-id-full')).toHaveText('1-1017-00123-45-6');
});

test('TC-PDPA-02 staff JSON masks IDs and omits full IDs at every depth', async ({ scenario }) => {
  const endpoints = [
    '/api/officer/queue?filter=all', caseApi(25), caseApi(26), caseApi(20),
    '/api/notifications', `${caseApi(25)}/files`,
  ];

  for (const username of ['off.reg1', 'head1'] as const) {
    const staff = await scenario.loginStaff(username);
    for (const path of endpoints) {
      await test.step(`${username} GET ${path}`, async () => {
        const response = await staff.api.get(path);
        expect(response.headers()['content-type']).toMatch(/^application\/json\b/);
        const data = await json<{ idMasked?: string; items?: { idMasked?: string }[] }>(response);
        const entireJson = JSON.stringify(data);
        expect(entireJson).not.toMatch(/\d{13}|\d-\d{4}-\d{5}-\d{2}-\d/);
        expect(entireJson).not.toMatch(/"idNo"\s*:/);
        for (const id of [somying, somchai, piti]) expect(entireJson).not.toContain(id);

        if (path.startsWith('/api/officer/queue')) {
          expect(data.items?.length).toBeGreaterThan(0);
          for (const item of data.items ?? []) expect(item.idMasked).toMatch(idMask);
        } else if ([caseApi(25), caseApi(26), caseApi(20)].includes(path)) {
          expect(data.idMasked).toMatch(idMask);
        }
      });
    }
  }
});

test('TC-PDPA-03 unmask requires a reason, expires on reload and leaves an audit entry', async ({ scenario }) => {
  const holder = await scenario.loginStaff('off.reg2');
  await openCase(holder, 'officer', 25);
  const page = holder.page;
  const endpoint = `${staffCaseApi(25)}/unmask`;
  const message = 'กรุณากรอกเหตุผล';
  const reason = 'ตรวจสอบตัวตนซ้ำ';
  const input = page.getByTestId('unmask-reason');

  for (const invalid of ['', '   ']) {
    if (!(await input.isVisible())) await page.getByTestId('show-full-id-btn').click();
    await input.fill(invalid);
    await page.getByTestId('unmask-submit').click();
    await expect(page.getByTestId('unmask-error')).toHaveText(message);
    await expect(page.getByTestId('full-id')).toHaveCount(0);
    await apiError(await holder.api.post(endpoint, { data: { reason: invalid } }), 400, 'REASON_REQUIRED', message);
  }
  if (!(await input.isVisible())) await page.getByTestId('show-full-id-btn').click();
  await input.fill(reason);
  await page.getByTestId('unmask-submit').click();
  await expect(page.getByTestId('full-id')).toHaveText(somyingFull);
  await page.reload();
  await expect(page.getByTestId('applicant-id')).toHaveText(somyingMasked);
  await expect(page.getByTestId('full-id')).toHaveCount(0);

  const auditor = await scenario.loginStaff('audit1');
  await go(auditor.page, '/audit');
  await auditFilters(auditor.page, { event: 'UNMASK' });
  await expect(auditor.page.getByTestId('audit-count')).toHaveText('1');
  const event = auditor.page.getByTestId('audit-row');
  await expect(event).toHaveCount(1);
  await expect(event).toHaveAttribute('data-actor', 'off.reg2');
  await expect(event.getByTestId('audit-role')).toHaveText('officer');
  await expect(event.getByTestId('audit-case-no')).toHaveText(caseNo(25));
  await expect(event.getByTestId('audit-event')).toHaveText('UNMASK');
  await expect(event.getByTestId('audit-detail')).toContainText(reason);
  await iso(event.getByTestId('audit-time'), resetTime);

  for (const session of [await scenario.loginStaff('exec1'), auditor, await scenario.loginCitizen(somying)]) {
    await apiError(await session.api.post(endpoint, { data: { reason: 'x' } }), 403, 'FORBIDDEN');
  }
});
