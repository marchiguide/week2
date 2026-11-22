import { readFile } from 'node:fs/promises';
import {
  apiError, approve, auditFilters, caseApi, caseNo, expect, go, http, iso, issue,
  readAudit, reason, resetTime, row, staffCaseApi, test,
} from './_helpers';

test('TC-AUDIT-01 records audited actions, newest-first ordering, filters and CSV', async ({ scenario }) => {
  test.setTimeout(60_000);
  const registry2 = await scenario.loginStaff('off.reg2');
  await http(await registry2.api.post(`${staffCaseApi(28)}/claim`), 200);
  const registry1 = await scenario.loginStaff('off.reg1');
  await http(await registry1.api.post(`${staffCaseApi(20)}/return`, { data: { reason } }), 200);
  await http(await registry2.api.post(`${staffCaseApi(13)}/forward`), 200);
  const head = await scenario.loginStaff('head1');
  await approve(head, 13);
  await approve(registry2, 25);
  expect((await issue(registry2, 25)).docNo).toBe('DOC-2569-000002');
  await http(await registry2.api.post(`${caseApi(26)}/reject`, { data: { reason } }), 200);
  const unmaskReason = 'ตรวจสอบตัวตนซ้ำ';
  await http(await registry2.api.post(`${staffCaseApi(25)}/unmask`, { data: { reason: unmaskReason } }), 200);
  const executive = await scenario.loginStaff('exec1');
  await http(await executive.api.get('/api/dashboard/export?format=xlsx&period=2026-12&service=ALL'), 200);
  const admin = await scenario.loginStaff('admin1');
  await http(await admin.api.put('/api/admin/services/SV-01', { data: { fee: 25, sla: 3 } }), 200);
  const auditor = await scenario.loginStaff('audit1');

  const page = auditor.page;
  await go(page, '/audit');
  await expect(page.getByTestId('audit-count')).toHaveText('16');
  const rows = page.getByTestId('audit-row');
  const expected = [
    ['STAFF_LOGIN', 'off.reg2', 'officer', 0, '–', ''],
    ['CLAIM', 'off.reg2', 'officer', 28, 'SUBMITTED → IN_REVIEW', ''],
    ['STAFF_LOGIN', 'off.reg1', 'officer', 0, '–', ''],
    ['RETURN', 'off.reg1', 'officer', 20, 'IN_REVIEW → NEED_FIX', reason],
    ['FORWARD', 'off.reg2', 'officer', 13, 'IN_REVIEW → PENDING_APPROVAL', ''],
    ['STAFF_LOGIN', 'head1', 'head', 0, '–', ''],
    ['APPROVE', 'head1', 'head', 13, 'PENDING_APPROVAL → APPROVED', ''],
    ['APPROVE', 'off.reg2', 'officer', 25, 'IN_REVIEW → APPROVED', ''],
    ['ISSUE', 'off.reg2', 'officer', 25, 'APPROVED → COMPLETED', 'DOC-2569-000002'],
    ['REJECT', 'off.reg2', 'officer', 26, 'IN_REVIEW → REJECTED', reason],
    ['UNMASK', 'off.reg2', 'officer', 25, '–', unmaskReason],
    ['STAFF_LOGIN', 'exec1', 'executive', 0, '–', ''],
    ['EXPORT', 'exec1', 'executive', 0, '–', 'xlsx 2026-12 ALL'],
    ['STAFF_LOGIN', 'admin1', 'admin', 0, '–', ''],
    ['ADMIN_CHANGE', 'admin1', 'admin', 0, '–', 'SV-01 fee 20 → 25'],
    ['STAFF_LOGIN', 'audit1', 'auditor', 0, '–', ''],
  ] as const;

  await expect(rows).toHaveCount(expected.length);
  let previousId = Infinity;
  for (const [index, [event, actor, role, n, transition, detail]] of [...expected].reverse().entries()) {
    const entry = rows.nth(index);
    const id = Number(await entry.getAttribute('data-id'));
    expect(Number.isSafeInteger(id) && id > 0).toBe(true);
    expect(id).toBeLessThan(previousId);
    previousId = id;
    await expect(entry).toHaveAttribute('data-event', event);
    await expect(entry).toHaveAttribute('data-actor', actor);
    if (n) await expect(entry).toHaveAttribute('data-case-no', caseNo(n));
    await expect(entry.getByTestId('audit-actor')).toHaveText(actor);
    await expect(entry.getByTestId('audit-role')).toHaveText(role);
    await expect(entry.getByTestId('audit-event')).toHaveText(event);
    await expect(entry.getByTestId('audit-case-no')).toHaveText(n ? caseNo(n) : '–');
    await expect(entry.getByTestId('audit-transition')).toHaveText(transition);
    if (detail) await expect(entry.getByTestId('audit-detail')).toContainText(detail);
    await iso(entry.getByTestId('audit-time'), resetTime);
  }

  for (const [filters, count] of [
    [{ actor: 'off.reg2' }, '7'],
    [{ event: 'APPROVE' }, '2'],
    [{ actor: 'off.reg2', event: 'APPROVE' }, '1'],
    [{}, '16'],
  ] as const) {
    await auditFilters(page, filters);
    await expect(page.getByTestId('audit-count')).toHaveText(count);
    await expect(rows).toHaveCount(Number(count));
  }

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('audit-export-csv-btn').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  const csv = (await readFile(await download.path(), 'utf8')).replace(/^\uFEFF/, '').trimEnd();
  const [header, ...lines] = csv.split(/\r?\n/);
  expect(header).toBe('time,username,role,event,caseNo,fromStatus,toStatus,detail');
  expect(lines).toHaveLength(16);

  await go(page, '/audit');
  await expect(page.getByTestId('audit-count')).toHaveText('17');
  const exported = row(page, 'audit-row', 'event', 'EXPORT').and(page.locator('[data-actor="audit1"]'));
  await expect(exported).toHaveCount(1);
  await expect(exported.getByTestId('audit-role')).toHaveText('auditor');
  await expect(exported.getByTestId('audit-detail')).toContainText('audit-csv');
});

test('TC-AUDIT-02 immutable audit rows and read permissions', async ({ scenario }) => {
  const auditor = await scenario.loginStaff('audit1');
  const before = await readAudit(auditor);
  expect(before.count).toBe(1);
  expect(before.items).toHaveLength(1);
  const entry = `/api/audit/${before.items[0].id}`;
  const admin = await scenario.loginStaff('admin1');

  for (const actor of [admin, auditor]) {
    const requests = [
      ['PUT', entry], ['PATCH', entry], ['DELETE', entry],
      ['PUT', '/api/audit'], ['PATCH', '/api/audit'], ['DELETE', '/api/audit'],
      ['DELETE', '/api/audit/999999'],
    ] as const;
    for (const [method, url] of requests) {
      const response = await actor.api.fetch(url, {
        method, data: method === 'PUT' ? { detail: 'x' } : undefined,
      });
      await apiError(response, 405, 'METHOD_NOT_ALLOWED');
    }
  }

  const after = await readAudit(auditor);
  expect(after.count).toBe(2);
  expect(after.items).toHaveLength(2);
  expect(after.items.find(item => item.id === before.items[0].id)).toEqual(before.items[0]);
  expect(after.items.find(item => item.id !== before.items[0].id))
    .toMatchObject({ event: 'STAFF_LOGIN', username: 'admin1' });
  await go(auditor.page, '/audit');
  await expect(auditor.page.getByTestId('audit-edit-btn')).toHaveCount(0);
  await expect(auditor.page.getByTestId('audit-delete-btn')).toHaveCount(0);
  await apiError(await admin.api.get('/api/audit'), 403, 'FORBIDDEN');
});

test('TC-AUDIT-03 date filters use inclusive Bangkok calendar days', async ({ scenario }) => {
  test.setTimeout(60_000);
  const logins = [
    ['2026-11-30T23:59:59+07:00', 'off.reg1'],
    ['2026-12-01T00:00:00+07:00', 'off.reg2'],
    ['2026-12-01T23:59:59+07:00', 'off.works1'],
    ['2026-12-02T00:00:00+07:00', 'off.reg1'],
    ['2026-12-02T09:00:00+07:00', 'audit1'],
  ] as const;
  for (const [time, username] of logins.slice(0, -1)) {
    await scenario.clock(time);
    await scenario.loginStaff(username);
  }
  await scenario.clock(logins[4][0]);
  const auditor = await scenario.loginStaff('audit1');
  await go(auditor.page, '/audit');
  const cases = [
    ['2026-12-01', '2026-12-01', '', [2, 1]],
    ['2026-11-30', '2026-11-30', '', [0]],
    ['2026-11-30', '2026-12-01', '', [2, 1, 0]],
    ['2026-12-02', '', '', [4, 3]],
    ['', '2026-11-30', '', [0]],
    ['2026-12-01', '2026-12-02', '', [4, 3, 2, 1]],
    ['2026-12-01', '2026-12-01', 'off.reg2', [1]],
  ] as const;
  for (const [from, to, actor, selected] of cases) {
    await test.step(`from ${from || 'any'} to ${to || 'any'}, actor ${actor || 'any'}`, async () => {
      const params = { from, to, actor };
      await auditFilters(auditor.page, params);
      const rows = auditor.page.getByTestId('audit-row');
      await expect(auditor.page.getByTestId('audit-count')).toHaveText(String(selected.length));
      await expect(rows).toHaveCount(selected.length);
      for (const [index, login] of selected.entries()) {
        await iso(rows.nth(index).getByTestId('audit-time'), logins[login][0]);
        await expect(rows.nth(index)).toHaveAttribute('data-actor', logins[login][1]);
      }
      const result = await readAudit(auditor, params);
      expect(result.count).toBe(selected.length);
      expect(result.items.map(item => [item.time, item.username, item.event]))
        .toEqual(selected.map(index => [...logins[index], 'STAFF_LOGIN']));
    });
  }
});
