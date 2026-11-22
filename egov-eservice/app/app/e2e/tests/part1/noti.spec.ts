import { test, expect, type App, type Actor } from '../../helpers/app';
import { expectStatus } from '../../helpers/api';
import { CN, type StaffUser } from '../../helpers/env';
import { apiNoti, openQueue, uiNoti } from '../../helpers/flows';

const n = (tail: string, level: 'near' | 'overdue') => `${CN(tail)}:${level}`;
const sorted = (xs: string[]) => [...xs].sort();

/** ตรวจแจ้งเตือนของผู้ใช้ทั้งหน้า /notifications (noti-item + bell-count) และ GET /api/notifications */
async function expectNoti(a: Actor, expected: string[]): Promise<void> {
  await expect.poll(() => uiNoti(a.page), { message: `${a.who} /notifications` }).toEqual(sorted(expected));
  await expect(a.page.getByTestId('bell-count'), `${a.who} bell-count`).toHaveText(String(expected.length));
  if (expected.length === 0) await expect(a.page.getByTestId('noti-empty')).toHaveText('ไม่มีแจ้งเตือน');
  expect(await apiNoti(a.api), `${a.who} GET /api/notifications`).toEqual(sorted(expected));
}

/** เฉพาะรายการของคำขอหนึ่ง (API) */
async function notiOf(a: Actor, caseNo: string): Promise<string[]> {
  return (await apiNoti(a.api)).filter((x) => x.startsWith(`${caseNo}:`));
}

/** TC-NOTI-01 ทั้งหมด (ใช้ซ้ำใน TC-NOTI-02 ส่วน A) */
async function runNoti01(app: App): Promise<Record<'off.reg1' | 'off.reg2' | 'head1' | 'off.works1', Actor>> {
  await app.reset();
  // request แรกหลัง reset = ล็อกอิน off.reg1 ที่ 09:00 (กระตุ้นการประเมิน)
  const reg1 = await app.staff('off.reg1');
  const reg2 = await app.staff('off.reg2');
  const head = await app.staff('head1');
  const works = await app.staff('off.works1');

  await test.step('09:00 · ตามตาราง TEST-DATA 8', async () => {
    await expectNoti(reg1, [n('000024', 'near'), n('000022', 'near'), n('000020', 'overdue')]);
    await expectNoti(reg2, [n('000024', 'near')]);
    await expectNoti(head, [n('000020', 'overdue')]);
    await expectNoti(works, []);

    await reg1.page.goto('/notifications');
    const item = (tail: string, level: string) => reg1.page.locator(`[data-testid="noti-item"][data-case-no="${CN(tail)}"][data-level="${level}"]`);
    await expect(item('000024', 'near')).toHaveText(`คำขอ ${CN('000024')} ใกล้ครบกำหนด`);
    await expect(item('000020', 'overdue')).toHaveText(`คำขอ ${CN('000020')} เกินกำหนด`);
  });

  await test.step('16:31 · 000022 เกินกำหนด', async () => {
    await app.clock('2026-12-01T16:31:00+07:00');
    await expectStatus(await reg1.api.get('/api/me'), 200);
    await expectNoti(reg1, [n('000024', 'near'), n('000022', 'near'), n('000020', 'overdue'), n('000022', 'overdue')]);
    await expectNoti(head, [n('000020', 'overdue'), n('000022', 'overdue')]);
    await expectNoti(reg2, [n('000024', 'near')]);
  });

  return { 'off.reg1': reg1, 'off.reg2': reg2, head1: head, 'off.works1': works };
}

test('TC-NOTI-01 · ผู้รับแจ้งเตือนตามระดับ', async ({ app }) => {
  await runNoti01(app);
});

test('TC-NOTI-02 · ไม่แจ้งซ้ำ ข้ามระดับ และขั้นรออนุมัติ/รอออกเอกสาร', async ({ app }) => {
  await test.step('ส่วน A · ไม่แจ้งซ้ำ', async () => {
    const u = await runNoti01(app);
    const reg1 = u['off.reg1'];
    const head = u.head1;
    for (let i = 0; i < 3; i++) {
      await reg1.page.goto('/notifications');
      await head.page.goto('/notifications');
      await expectStatus(await reg1.api.get('/api/notifications'), 200);
      await expectStatus(await head.api.get('/api/notifications'), 200);
    }
    for (let i = 0; i < 2; i++) {
      await openQueue(reg1.page);
      await openQueue(head.page);
    }
    await expectNoti(reg1, [n('000024', 'near'), n('000022', 'near'), n('000020', 'overdue'), n('000022', 'overdue')]);
    await expectNoti(head, [n('000020', 'overdue'), n('000022', 'overdue')]);
  });

  await test.step('ส่วน B · ข้ามระดับ (request แรกที่ ส. 5 ธ.ค. 10:00)', async () => {
    await app.reset();
    await app.clock('2026-12-05T10:00:00+07:00');
    const reg1 = await app.staff('off.reg1');
    const reg2 = await app.staff('off.reg2');
    const works = await app.staff('off.works1');
    const head = await app.staff('head1');

    for (const a of [reg1, reg2, head]) expect(await notiOf(a, CN('000024')), `${a.who} 000024`).toEqual([n('000024', 'overdue')]);
    for (const tail of ['000020', '000022']) {
      expect(await notiOf(reg1, CN(tail))).toEqual([n(tail, 'overdue')]);
      expect(await notiOf(head, CN(tail))).toEqual([n(tail, 'overdue')]);
    }

    const od = (tails: string[]) => tails.map((t) => n(t, 'overdue'));
    await expectNoti(reg1, od(['000020', '000022', '000023', '000024', '000028', '000029', '000030']));
    await expectNoti(reg2, [...od(['000013', '000015', '000024', '000025', '000026', '000027', '000028', '000029', '000030']), n('000016', 'near')]);
    await expectNoti(works, od(['000010']));
    await expectNoti(head, [
      ...od(['000010', '000013', '000014', '000015', '000020', '000022', '000023', '000024', '000025', '000026', '000027', '000028', '000029', '000030']),
      n('000011', 'near'),
    ]);
  });

  await test.step('ส่วน C · ขั้นรออนุมัติและรอออกเอกสาร', async () => {
    await app.reset();
    await app.clock('2026-12-04T09:00:00+07:00');
    const head = await app.staff('head1');
    const users: Partial<Record<StaffUser, Actor>> = { head1: head };
    users['off.reg1'] = await app.staff('off.reg1');
    users['off.reg2'] = await app.staff('off.reg2');
    const reg1 = users['off.reg1']!;
    const reg2 = users['off.reg2']!;
    const c14 = CN('000014');
    const c19 = CN('000019');

    expect(await notiOf(head, c14)).toEqual([n('000014', 'near')]);
    expect(await notiOf(reg1, c14)).toEqual([]);
    expect(await notiOf(reg2, c14)).toEqual([]);

    await app.clock('2026-12-04T16:31:00+07:00');
    await expectStatus(await head.api.get('/api/me'), 200);
    expect(await notiOf(head, c14)).toEqual(sorted([n('000014', 'near'), n('000014', 'overdue')]));
    expect(await notiOf(reg1, c14)).toEqual([]);
    expect(await notiOf(reg2, c14)).toEqual([]);

    await app.clock('2026-12-08T09:00:00+07:00');
    await expectStatus(await head.api.get('/api/me'), 200);
    expect(await notiOf(reg1, c19)).toEqual([n('000019', 'near')]);
    expect(await notiOf(reg2, c19)).toEqual([]);
    expect(await notiOf(head, c19)).toEqual([]);

    await app.clock('2026-12-09T16:31:00+07:00');
    await expectStatus(await head.api.get('/api/me'), 200);
    expect(await notiOf(reg1, c19)).toEqual(sorted([n('000019', 'near'), n('000019', 'overdue')]));
    expect(await notiOf(head, c19)).toEqual([n('000019', 'overdue')]);

    await head.page.goto('/notifications');
    await expect(head.page.locator(`[data-testid="noti-item"][data-case-no="${c14}"]`)).toHaveCount(2);
  });
});
