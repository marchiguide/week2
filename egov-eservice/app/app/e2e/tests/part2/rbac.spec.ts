import { stat } from 'node:fs/promises';
import {
  apiError, auditFilters, caseApi, caseNo, expect, go, http, json, openCase, readCase, reason,
  resetTime, row, somying, staffCaseApi, test,
} from './_helpers';
import type { Session } from './_helpers';

const forbidden = 'ไม่มีสิทธิ์เข้าถึงหน้านี้';

test('TC-RBAC-01 citizen case ownership and indistinguishable 404 responses', async ({ scenario }) => {
  const citizen = await scenario.loginCitizen(somying);
  await go(citizen.page, `/citizen/cases/${caseNo(5)}`, 404);
  await expect(citizen.page.getByTestId('not-found-msg')).toHaveText('ไม่พบคำขอ');
  await expect(citizen.page.getByTestId('case-no')).toHaveCount(0);
  await expect(citizen.page.getByTestId('case-status')).toHaveCount(0);
  expect(await citizen.page.content()).not.toContain('สมชาย');

  const otherCase = await citizen.api.get(caseApi(5));
  expect(await json(otherCase, 404)).toEqual({ code: 'NOT_FOUND', message: 'ไม่พบคำขอ' });
  const missingCase = await citizen.api.get(caseApi(999999));
  await http(missingCase, 404);
  expect(await missingCase.text()).toBe(await otherCase.text());

  await http(await citizen.api.get('/api/documents/DOC-2569-000001/pdf'), 404);
  await http(await citizen.api.get('/api/drafts/DR-0001'), 404);
  await http(await citizen.api.post(`${caseApi(30)}/cancel`), 404);

  await openCase(citizen, 'citizen', 7);
  await expect(citizen.page.getByTestId('case-no')).toHaveText(caseNo(7));
  await http(await (await scenario.loginCitizen()).api.get(caseApi(5)), 200);
});

test('TC-RBAC-02 head-only approval and rejection for SV-02', async ({ scenario }) => {
  const officer = await scenario.loginStaff('off.reg2');
  for (const [n, status] of [[14, 'PENDING_APPROVAL'], [13, 'IN_REVIEW']] as const) {
    await apiError(await officer.api.post(`${caseApi(n)}/approve`), 403, 'FORBIDDEN');
    expect((await readCase(officer, n)).status).toBe(status);
  }
  await apiError(await officer.api.post(`${caseApi(14)}/reject`, { data: { reason } }), 403, 'FORBIDDEN');
  expect((await readCase(officer, 14)).status).toBe('PENDING_APPROVAL');
  for (const n of [13, 14]) {
    await openCase(officer, 'officer', n);
    await expect(officer.page.getByTestId('approve-btn')).toHaveCount(0);
  }

  const head = await scenario.loginStaff('head1');
  await apiError(await head.api.post(`${caseApi(25)}/approve`), 403, 'FORBIDDEN');
  expect(await json(await head.api.post(`${caseApi(14)}/approve`))).toMatchObject({ status: 'APPROVED' });

  const auditor = await scenario.loginStaff('audit1');
  await go(auditor.page, '/audit');
  await auditFilters(auditor.page, { event: 'APPROVE' });
  await expect(auditor.page.getByTestId('audit-count')).toHaveText('1');
  const approval = auditor.page.getByTestId('audit-row');
  await expect(approval).toHaveCount(1);
  await expect(approval).toHaveAttribute('data-actor', 'head1');
  await expect(approval).toHaveAttribute('data-case-no', caseNo(14));
});

const roles = ['anon', 'citizen', 'officer', 'head', 'executive', 'auditor', 'admin'] as const;
type Role = typeof roles[number];

const staffAccounts = {
  officer: 'off.reg1', head: 'head1', executive: 'exec1', auditor: 'audit1', admin: 'admin1',
} as const;

const pagePermissions: { paths: string[]; allowed: readonly Role[] }[] = [
  { paths: ['/citizen'], allowed: ['citizen'] },
  { paths: ['/officer/queue'], allowed: ['officer', 'head'] },
  { paths: ['/head/approvals'], allowed: ['head'] },
  { paths: ['/dashboard'], allowed: ['executive'] },
  { paths: ['/audit'], allowed: ['auditor'] },
  { paths: ['/admin/services', '/admin/holidays', '/admin/users'], allowed: ['admin'] },
  { paths: ['/notifications'], allowed: ['officer', 'head'] },
  { paths: ['/verify/K7M2Q9XA'], allowed: roles },
];

const navigation = {
  anon: [],
  citizen: ['my-cases'],
  officer: ['queue', 'bell'],
  head: ['queue', 'approvals', 'bell'],
  executive: ['dashboard'],
  auditor: ['audit'],
  admin: ['admin-services', 'admin-holidays', 'admin-users'],
};

test('TC-RBAC-03 page, API, department and menu permission matrix', async ({ scenario }) => {
  test.setTimeout(120_000);
  const apiPermissions: {
    method: 'GET' | 'POST'; path: string; allowed: readonly Role[]; data?: object; success?: number;
  }[] = [
    { method: 'GET', path: '/api/officer/queue', allowed: ['officer', 'head'] },
    { method: 'GET', path: '/api/notifications', allowed: ['officer', 'head'] },
    { method: 'GET', path: '/api/dashboard?period=2026-12&service=ALL', allowed: ['executive'] },
    { method: 'GET', path: '/api/audit', allowed: ['auditor'] },
    { method: 'GET', path: '/api/admin/services', allowed: ['admin'] },
    { method: 'POST', path: '/api/drafts', allowed: ['citizen'], success: 201, data: { serviceId: 'SV-01', qty: 1 } },
    { method: 'GET', path: caseApi(25), allowed: ['citizen', 'officer', 'head'] },
    { method: 'POST', path: `${staffCaseApi(28)}/claim`, allowed: ['officer'] },
  ];

  for (const role of roles) {
    await test.step(`permissions for ${role}`, async () => {
      if (role !== 'anon') await scenario.reset();
      const session = role === 'anon' ? await scenario.anonymous()
        : role === 'citizen' ? await scenario.loginCitizen()
        : await scenario.loginStaff(staffAccounts[role]);

      for (const { paths, allowed } of pagePermissions) {
        for (const path of paths) {
          if (allowed.includes(role)) {
            await go(session.page, path);
            await expect(session.page).toHaveURL(new URL(path, scenario.baseURL).href);
          } else if (role === 'anon') {
            await go(session.page, path);
            await expect(session.page).toHaveURL(/\/login(?:\?.*)?$/);
          } else {
            await go(session.page, path, 403);
            await expect(session.page.getByTestId('forbidden-msg')).toHaveText(forbidden);
          }
        }
      }

      if (role !== 'anon') {
        await go(session.page, '/');
        const expectedMenus: readonly string[] = navigation[role];
        for (const name of new Set(Object.values(navigation).flat())) {
          const link = session.page.getByTestId(`nav-${name}`);
          if (expectedMenus.includes(name)) await expect(link).toBeVisible();
          else await expect(link).toHaveCount(0);
        }
      }

      // Citizen pages use Somchai as the representative. The case API row needs the owner of case 25.
      const apiSession = role === 'citizen' ? await scenario.loginCitizen(somying) : session;
      for (const { method, path, allowed, success = 200, data } of apiPermissions) {
        const response = await apiSession.api.fetch(path, { method, data });
        if (allowed.includes(role)) await http(response, success);
        else await apiError(response, role === 'anon' ? 401 : 403, role === 'anon' ? 'UNAUTHENTICATED' : 'FORBIDDEN');
      }
    });
  }

  await scenario.reset();
  const works = await scenario.loginStaff('off.works1');
  const registry = await scenario.loginStaff('off.reg1');
  await apiError(await works.api.post(`${staffCaseApi(28)}/claim`), 403, 'FORBIDDEN');
  await apiError(await registry.api.post(`${staffCaseApi(10)}/claim`), 403, 'FORBIDDEN');
  await go(works.page, '/officer/queue');
  await expect(works.page.getByTestId('queue-row').getByTestId('row-case-no')).toHaveText([caseNo(10)]);
  const queue = await json<{ items: { caseNo: string }[] }>(await works.api.get('/api/officer/queue'));
  expect(queue.items.map(item => item.caseNo)).toEqual([caseNo(10)]);
});

test('TC-RBAC-04 admin settings preserve existing fees and deadlines', async ({ scenario }) => {
  test.setTimeout(90_000);
  const admin = await scenario.loginStaff('admin1');
  const page = admin.page;
  await go(page, '/admin/holidays');
  const holidays = page.getByTestId('holiday-row');
  await expect(holidays).toHaveCount(4);
  for (const date of ['2026-12-07', '2026-12-10', '2026-12-31', '2027-01-01']) {
    await expect(row(page, 'holiday-row', 'date', date)).toHaveCount(1);
  }

  const before = await scenario.newPaid(resetTime, { serviceId: 'SV-01', qty: 1 }, 20);
  expect(before.caseNo).toBe(caseNo(31));
  const originalDeadline = '2026-12-04T16:30:00+07:00';
  expect((await readCase(before.citizen, 31)).dueAt).toBe(originalDeadline);

  await go(page, '/admin/services');
  for (const [service, fee] of [['SV-01', 25], ['SV-02', 600]] as const) {
    await page.getByTestId(`svc-fee-${service}`).fill(String(fee));
    await page.getByTestId(`svc-save-${service}`).click();
    await expect(page.getByTestId('action-success')).toBeVisible();
    await expect.poll(async () => (await readServices(admin)).find(item => item.id === service)?.fee).toBe(fee);
  }

  const citizen = await scenario.loginCitizen();
  await go(citizen.page, '/citizen/new/SV-01');
  for (const [qty, total] of [['5', '฿125'], ['1', '฿25']]) {
    await citizen.page.getByTestId('qty-input').fill(qty);
    await expect(citizen.page.getByTestId('fee-total')).toHaveText(total);
  }
  await go(citizen.page, '/citizen/new/SV-02');
  await expect(citizen.page.getByTestId('fee-total')).toHaveText('฿600');
  await openCase(citizen, 'citizen', 30);
  await expect(citizen.page.getByTestId('case-fee')).toHaveText('฿20');
  await go(citizen.page, '/citizen/new/SV-02?draft=DR-0002');
  await expect(citizen.page.getByTestId('payment-amount')).toHaveText('฿500');
  await apiError(await scenario.pay('PP-0001', 600), 422, 'AMOUNT_MISMATCH');
  expect(await json(await scenario.pay('PP-0001', 500))).toMatchObject({ status: 'PAID', caseNo: caseNo(32) });

  await go(page, '/admin/holidays');
  await page.getByTestId('holiday-date-input').fill('2026-12-02');
  await page.getByTestId('holiday-name-input').fill('วันหยุดทดสอบ');
  await page.getByTestId('holiday-add-btn').click();
  await expect(holidays).toHaveCount(5);
  expect((await readCase(citizen, 31)).dueAt).toBe(originalDeadline);
  const after = await scenario.newPaid(resetTime, { serviceId: 'SV-01', qty: 1 }, 25);
  expect(after.caseNo).toBe(caseNo(33));
  expect((await readCase(after.citizen, 33)).dueAt).toBe('2026-12-08T16:30:00+07:00');

  await http(await admin.api.put('/api/admin/users/exec1', { data: { role: 'auditor', dept: '' } }), 200);
  const newAuditor = await scenario.loginStaff('exec1');
  await go(newAuditor.page, '/');
  await expect(newAuditor.page).toHaveURL(/\/audit$/);
  await go(newAuditor.page, '/dashboard', 403);
  await expect(newAuditor.page.getByTestId('forbidden-msg')).toHaveText(forbidden);
  await go(newAuditor.page, '/audit');
  await auditFilters(newAuditor.page, { event: 'ADMIN_CHANGE' });
  await expect(newAuditor.page.getByTestId('audit-count')).toHaveText('4');
  const changes = newAuditor.page.getByTestId('audit-row');
  const expected = [
    'exec1 role executive → auditor', 'holiday add 2026-12-02', 'SV-02 fee 500 → 600', 'SV-01 fee 20 → 25',
  ];
  for (const [index, detail] of expected.entries()) {
    const change = changes.nth(index);
    await expect(change).toHaveAttribute('data-actor', 'admin1');
    await expect(change.getByTestId('audit-role')).toHaveText('admin');
    await expect(change.getByTestId('audit-detail')).toContainText(detail);
  }

  await apiError(await admin.api.post('/api/drafts', { data: { serviceId: 'SV-01', qty: 1 } }), 403, 'FORBIDDEN');
  await row(page, 'holiday-row', 'date', '2026-12-02').getByTestId('holiday-delete-btn').click();
  await expect(holidays).toHaveCount(4);
  await auditFilters(newAuditor.page, { event: 'ADMIN_CHANGE' });
  await expect(newAuditor.page.getByTestId('audit-count')).toHaveText('5');
  await expect(changes.first().getByTestId('audit-detail')).toContainText('holiday delete 2026-12-02');
});

interface Attachment {
  fileId: string;
  name: string;
}

test('TC-RBAC-05 attachment list, download and department history permissions', async ({ scenario }) => {
  test.setTimeout(90_000);
  const registry1 = await scenario.loginStaff('off.reg1');
  const registry2 = await scenario.loginStaff('off.reg2');
  const works = await scenario.loginStaff('off.works1');
  const head = await scenario.loginStaff('head1');
  const owner = await scenario.loginCitizen(somying);
  const otherCitizen = await scenario.loginCitizen();
  const executive = await scenario.loginStaff('exec1');
  const auditor = await scenario.loginStaff('audit1');
  const admin = await scenario.loginStaff('admin1');
  const anon = await scenario.anonymous();
  const certificateFiles = ['id-card.pdf'];
  const buildingFiles = ['id-card.pdf', 'plan.pdf', 'deed.pdf'];
  const idsByCase = new Map<number, Attachment[]>();

  for (const [actor, n, names] of [
    [registry1, 25, certificateFiles],
    [registry2, 12, buildingFiles],
    [works, 10, buildingFiles], [registry1, 10, buildingFiles],
    [works, 11, buildingFiles],
    [head, 25, certificateFiles], [head, 10, buildingFiles], [head, 12, buildingFiles],
    [owner, 25, certificateFiles],
  ] as const) {
    const list = await json<{ items: Attachment[] }>(await actor.api.get(`${caseApi(n)}/files`));
    expect(list.items.map(file => file.name).sort()).toEqual([...names].sort());
    idsByCase.set(n, list.items);
    for (const file of list.items) {
      const download = await actor.api.get(`/api/files/${file.fileId}`);
      await http(download, 200);
      expect(download.headers()['content-type']).toMatch(/^application\/pdf\b/);
      expect((await download.body()).subarray(0, 4).toString('ascii')).toBe('%PDF');
    }
  }

  for (const [actor, n, status] of [
    [works, 25, 403], [works, 12, 403], [otherCitizen, 25, 404],
    [executive, 25, 403], [auditor, 25, 403], [admin, 25, 403], [anon, 25, 401],
  ] as const) {
    await http(await actor.api.get(`${caseApi(n)}/files`), status);
    const files = idsByCase.get(n);
    expect(files?.length).toBeGreaterThan(0);
    for (const { fileId } of files ?? []) await http(await actor.api.get(`/api/files/${fileId}`), status);
  }

  await http(await registry1.api.get('/api/files/999999'), 404);
  await openCase(registry1, 'officer', 25);
  await expect(registry1.page.getByTestId('doc-item')).toHaveCount(1);
  const attachment = row(registry1.page, 'doc-item', 'name', 'id-card.pdf');
  const [download] = await Promise.all([
    registry1.page.waitForEvent('download'),
    attachment.getByTestId('doc-download-link').click(),
  ]);
  expect((await stat(await download.path())).size).toBeGreaterThan(0);
  await openCase(registry2, 'officer', 12);
  await expect(registry2.page.getByTestId('doc-item')).toHaveCount(3);
  await openCase(owner, 'citizen', 25);
  await expect(owner.page.getByTestId('doc-item')).toHaveCount(1);
});

async function readServices(admin: Session) {
  const result = await json<{ items: { id: string; fee: number; sla: number }[] }>(
    await admin.api.get('/api/admin/services'),
  );
  return result.items;
}

test('TC-RBAC-06 admin fee and SLA boundaries, holiday duplicates and role protection', async ({ scenario }) => {
  test.setTimeout(120_000);
  const invalidFee = 'ค่าธรรมเนียมต้องเป็นจำนวนเต็ม 0–100,000 บาท';
  const invalidSla = 'SLA ต้องเป็นจำนวนเต็ม 1–60 วันทำการ';
  const examples = [
    ['fee', -1, 'INVALID_FEE', invalidFee],
    ['fee', 0, '', ''],
    ['fee', 100000, '', ''],
    ['fee', 100001, 'INVALID_FEE', invalidFee],
    ['sla', 0, 'INVALID_SLA', invalidSla],
    ['sla', 1, '', ''],
    ['sla', 60, '', ''],
    ['sla', 61, 'INVALID_SLA', invalidSla],
  ] as const;
  const endpoint = '/api/admin/services/SV-01';
  let admin = await scenario.loginStaff('admin1');
  async function assertPersisted(expected: { fee: number; sla: number }) {
    await expect.poll(async () => (await readServices(admin)).find(item => item.id === 'SV-01'))
      .toMatchObject(expected);
  }
  let saved = { fee: 20, sla: 3 };
  await go(admin.page, '/admin/services');
  for (const [field, value, code, message] of examples) {
    await test.step(`UI ${field}=${value}`, async () => {
      // Begin from the saved fields after a rejected update.
      await go(admin.page, '/admin/services');
      await admin.page.getByTestId(`svc-${field}-SV-01`).fill(String(value));
      await admin.page.getByTestId('svc-save-SV-01').click();
      if (code) {
        await expect(admin.page.getByTestId('action-error')).toHaveText(message);
      } else {
        await expect(admin.page.getByTestId('action-success')).toBeVisible();
        saved = { ...saved, [field]: value };
      }
      await assertPersisted(saved);
    });
  }

  await scenario.reset();
  admin = await scenario.loginStaff('admin1');
  saved = { fee: 20, sla: 3 };
  for (const [field, value, code, message] of examples) {
    await test.step(`API ${field}=${value}`, async () => {
      const attempted = { ...saved, [field]: value };
      const response = await admin.api.put(endpoint, { data: attempted });
      if (code) {
        await apiError(response, 400, code, message);
      } else {
        await http(response, 200);
        saved = attempted;
      }
      await assertPersisted(saved);
    });
  }

  const duplicate = { date: '2026-12-07', name: 'ซ้ำ' };
  await apiError(await admin.api.post('/api/admin/holidays', { data: duplicate }),
    409, 'DUPLICATE_HOLIDAY', 'มีวันหยุดนี้อยู่แล้ว');
  await go(admin.page, '/admin/holidays');
  await expect(admin.page.getByTestId('holiday-row')).toHaveCount(4);

  await http(await admin.api.post('/api/admin/holidays', {
    data: { date: '2026-12-05', name: 'วันเสาร์' },
  }), 201);
  await apiError(await admin.api.put('/api/admin/users/admin1', { data: { role: 'executive', dept: '' } }),
    409, 'SELF_ROLE_CHANGE');
  expect(await json(await admin.api.get('/api/me'))).toMatchObject({ role: 'admin' });

  const auditor = await scenario.loginStaff('audit1');
  await go(auditor.page, '/audit');
  await auditFilters(auditor.page, { event: 'ADMIN_CHANGE' });
  await expect(auditor.page.getByTestId('audit-count')).toHaveText('5');
  const changes = auditor.page.getByTestId('audit-row');
  await expect(changes).toHaveCount(5);
  await expect(changes.getByTestId('audit-detail')).toContainText([
    'holiday add 2026-12-05', 'SV-01 sla 1 → 60', 'SV-01 sla 3 → 1',
    'SV-01 fee 0 →', 'SV-01 fee 20 → 0',
  ]);
});
