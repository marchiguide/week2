import { test, expect } from '../../helpers/app';
import type { Actor } from '../../helpers/app';
import { expectStatus } from '../../helpers/api';
import { CN, ID, REASON10, type ServiceId } from '../../helpers/env';
import { NEW_PAID, claim, getCase, openQueue, queueRow, resubmit, returnCase } from '../../helpers/flows';

const C31 = 'EG-2569-000031';
const LEVEL_TEXT = { normal: 'ปกติ', near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด', paused: 'หยุดนับ', closed: 'ปิดแล้ว' } as const;
type Level = keyof typeof LEVEL_TEXT;

/** ตรวจ sla-level บนหน้าคำขอ (ข้อความ + data-level) และ slaLevel ใน API */
async function expectLevel(a: Actor, caseNo: string, level: Level, base = '/citizen/cases'): Promise<void> {
  await a.page.goto(`${base}/${caseNo}`);
  await expect.soft(a.page.getByTestId('sla-level'), `${caseNo} sla-level`).toHaveText(LEVEL_TEXT[level]);
  await expect.soft(a.page.getByTestId('sla-level')).toHaveAttribute('data-level', level);
  expect.soft((await getCase(a.api, caseNo)).slaLevel, `${caseNo} slaLevel (API)`).toBe(level);
}

test('TC-SLA-01 · กำหนดเสร็จตามตารางวันที่', async ({ app }) => {
  const rows: Array<{ row: string; service: ServiceId; at: string; due: string; text: string; qty?: number }> = [
    { row: 'a', service: 'SV-01', qty: 3, at: '2026-12-01T09:00:00+07:00', due: '2026-12-04T16:30:00+07:00', text: '4 ธ.ค. 2569 16:30' },
    { row: 'b', service: 'SV-01', at: '2026-12-01T16:29:00+07:00', due: '2026-12-04T16:30:00+07:00', text: '4 ธ.ค. 2569 16:30' },
    { row: 'c', service: 'SV-01', at: '2026-12-01T16:30:00+07:00', due: '2026-12-08T16:30:00+07:00', text: '8 ธ.ค. 2569 16:30' },
    { row: 'd', service: 'SV-01', at: '2026-12-04T10:00:00+07:00', due: '2026-12-11T16:30:00+07:00', text: '11 ธ.ค. 2569 16:30' },
    { row: 'e', service: 'SV-01', at: '2026-12-05T10:00:00+07:00', due: '2026-12-14T16:30:00+07:00', text: '14 ธ.ค. 2569 16:30' },
    { row: 'f', service: 'SV-02', at: '2026-12-01T09:00:00+07:00', due: '2026-12-17T16:30:00+07:00', text: '17 ธ.ค. 2569 16:30' },
    { row: 'g', service: 'SV-03', at: '2026-12-01T09:00:00+07:00', due: '2026-12-24T16:30:00+07:00', text: '24 ธ.ค. 2569 16:30' },
    { row: 'h', service: 'SV-01', at: '2026-12-29T10:00:00+07:00', due: '2027-01-05T16:30:00+07:00', text: '5 ม.ค. 2570 16:30' },
    { row: 'i', service: 'SV-01', at: '2026-12-31T23:59:00+07:00', due: '2027-01-07T16:30:00+07:00', text: '7 ม.ค. 2570 16:30' },
  ];
  for (const r of rows) {
    await test.step(`แถว ${r.row} · ${r.service} ชำระ ${r.at} → ${r.due}`, async () => {
      await app.reset();
      const paid = await NEW_PAID(app, { service: r.service, at: r.at, qty: r.qty, areaSqm: r.service === 'SV-03' ? 100 : undefined });
      expect(paid.caseNo).toBe(C31);
      expect.soft((await getCase(paid.actor.api, C31)).dueAt, `แถว ${r.row} dueAt`).toBe(r.due);
      await paid.actor.page.goto(`/citizen/cases/${C31}`);
      await expect.soft(paid.actor.page.getByTestId('sla-due'), `แถว ${r.row} data-iso`).toHaveAttribute('data-iso', r.due);
      await expect.soft(paid.actor.page.getByTestId('sla-due'), `แถว ${r.row} ข้อความ`).toHaveText(r.text);
    });
  }
});

test('TC-SLA-02 · หยุดนับ SLA ระหว่างรอแก้ไข', async ({ app }) => {
  await test.step('ส่วน 1 · ตีกลับ 2 ธ.ค. 11:00 ส่งแก้ 3 ธ.ค. 10:00 → 8 ธ.ค.', async () => {
    await app.reset();
    const paid = await NEW_PAID(app, { at: '2026-12-01T09:00:00+07:00' });
    const c = paid.actor;
    expect((await getCase(c.api, C31)).dueAt).toBe('2026-12-04T16:30:00+07:00');

    await app.clock('2026-12-02T11:00:00+07:00');
    const o = await app.staff('off.reg1');
    await expectStatus(await claim(o.api, C31), 200);
    await expectStatus(await returnCase(o.api, C31, REASON10), 200);
    await o.page.goto(`/officer/cases/${C31}`);
    await expect(o.page.getByTestId('case-status')).toHaveText('รอแก้ไขเอกสาร');
    await c.page.goto(`/citizen/cases/${C31}`);
    await expect(c.page.getByTestId('sla-level')).toHaveText('หยุดนับ');
    await expect(c.page.getByTestId('sla-level')).toHaveAttribute('data-level', 'paused');
    await expect(c.page.getByTestId('fix-deadline')).toHaveAttribute('data-iso', '2026-12-09T11:00:00+07:00');

    await app.clock('2026-12-03T10:00:00+07:00');
    await c.page.reload();
    await c.page.getByTestId('submit-fix-btn').click();
    await expect(c.page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
    const k = await getCase(c.api, C31);
    expect(k.dueAt).toBe('2026-12-08T16:30:00+07:00');
    expect(k.owner).toBe('off.reg1');
    await c.page.reload();
    await expect(c.page.getByTestId('sla-due')).toHaveText('8 ธ.ค. 2569 16:30');
    await expect(c.page.getByTestId('sla-level')).toHaveText('ปกติ');
    await o.page.goto(`/officer/cases/${C31}`);
    await expect(o.page.getByTestId('case-owner')).toHaveText('off.reg1');
  });

  await test.step('ส่วน 2 · seed 000017 ส่งแก้ 1 ธ.ค. 09:00 → 1 ธ.ค. 16:30', async () => {
    await app.reset();
    const c = await app.citizen(ID.somchai);
    const cn = CN('000017');
    await c.page.goto(`/citizen/cases/${cn}`);
    await expect(c.page.getByTestId('sla-level')).toHaveText('หยุดนับ');
    await expect(c.page.getByTestId('sla-due')).toHaveAttribute('data-iso', '2026-11-27T16:30:00+07:00');
    await c.page.getByTestId('submit-fix-btn').click();
    await expect(c.page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
    const k = await getCase(c.api, cn);
    expect(k.dueAt).toBe('2026-12-01T16:30:00+07:00');
    expect(k.slaLevel).toBe('near');
    expect(k.owner).toBe('off.reg1');
    await c.page.reload();
    await expect(c.page.getByTestId('sla-level')).toHaveText('ใกล้ครบกำหนด');
  });

  await test.step('ส่วน 3 · ส่งแก้ 000017 เมื่อ 4 ธ.ค. 10:00 → 4 ธ.ค. 16:30', async () => {
    await app.reset();
    await app.clock('2026-12-04T10:00:00+07:00');
    const c = await app.citizen(ID.somchai);
    const cn = CN('000017');
    const r = await expectStatus(await resubmit(c.api, cn), 200);
    expect(r.status).toBe('IN_REVIEW');
    expect((await getCase(c.api, cn)).dueAt).toBe('2026-12-04T16:30:00+07:00');
    await expectLevel(c, cn, 'near');
  });

  await test.step('ส่วน 4 · ตีกลับและส่งแก้วันเดียวกัน → หยุด 0 วัน', async () => {
    await app.reset();
    const paid = await NEW_PAID(app, { at: '2026-12-01T09:00:00+07:00' });
    await app.clock('2026-12-02T09:00:00+07:00');
    const o = await app.staff('off.reg1');
    await expectStatus(await claim(o.api, C31), 200);
    await expectStatus(await returnCase(o.api, C31, REASON10), 200);
    await app.clock('2026-12-02T15:00:00+07:00');
    await expectStatus(await resubmit(paid.actor.api, C31), 200);
    expect((await getCase(paid.actor.api, C31)).dueAt).toBe('2026-12-04T16:30:00+07:00');
  });

  await test.step('ส่วน 5 · คร่อมสุดสัปดาห์/วันหยุด ส่งแก้หลัง 16:30 → 8 ธ.ค. เกินกำหนด', async () => {
    await app.reset();
    const paid = await NEW_PAID(app, { at: '2026-12-01T09:00:00+07:00' });
    await app.clock('2026-12-04T10:00:00+07:00');
    const o = await app.staff('off.reg1');
    await expectStatus(await claim(o.api, C31), 200);
    await expectStatus(await returnCase(o.api, C31, REASON10), 200);
    await app.clock('2026-12-08T17:00:00+07:00');
    await expectStatus(await resubmit(paid.actor.api, C31), 200);
    expect((await getCase(paid.actor.api, C31)).dueAt).toBe('2026-12-08T16:30:00+07:00');
    await expectLevel(paid.actor, C31, 'overdue');
  });
});

test('TC-SLA-03 · ระดับเตือน ปกติ / ใกล้ครบกำหนด / เกินกำหนด', async ({ app }) => {
  await test.step('ส่วน A · คำขอใหม่ กำหนด 4 ธ.ค. 16:30', async () => {
    await app.reset();
    const paid = await NEW_PAID(app, { at: '2026-12-01T09:00:00+07:00' });
    const rows: Array<[string, Level]> = [
      ['2026-12-01T09:00:00+07:00', 'normal'],
      ['2026-12-02T09:00:00+07:00', 'normal'],
      ['2026-12-03T09:00:00+07:00', 'near'],
      ['2026-12-04T16:30:00+07:00', 'near'],
      ['2026-12-04T16:30:01+07:00', 'overdue'],
      ['2026-12-04T16:31:00+07:00', 'overdue'],
      ['2026-12-05T10:00:00+07:00', 'overdue'],
    ];
    for (const [t, level] of rows) {
      await test.step(`${t} → ${level}`, async () => {
        await app.clock(t);
        await expectLevel(paid.actor, C31, level);
      });
    }
  });

  await test.step('ส่วน B · seed 000016 กำหนด 8 ธ.ค. 16:30', async () => {
    await app.reset();
    const p = await app.citizen(ID.piti);
    const rows: Array<[string, Level]> = [
      ['2026-12-03T09:00:00+07:00', 'normal'],
      ['2026-12-04T09:00:00+07:00', 'near'],
      ['2026-12-08T16:30:00+07:00', 'near'],
      ['2026-12-08T16:31:00+07:00', 'overdue'],
    ];
    for (const [t, level] of rows) {
      await test.step(`${t} → ${level}`, async () => {
        await app.clock(t);
        await expectLevel(p, CN('000016'), level);
      });
    }
  });

  await test.step('ส่วน C · seed ที่ 09:00 (คิว + หน้าคำขอ)', async () => {
    await app.reset();
    const o = await app.staff('off.reg1');
    await openQueue(o.page);
    const rows: Array<[string, Level]> = [['000020', 'overdue'], ['000022', 'near'], ['000024', 'near'], ['000025', 'normal']];
    for (const [tail, level] of rows) {
      const row = queueRow(o.page, CN(tail));
      await expect.soft(row.getByTestId('row-sla-level'), `${tail} row-sla-level`).toHaveText(LEVEL_TEXT[level]);
      await expect.soft(row, `${tail} data-sla-level`).toHaveAttribute('data-sla-level', level);
    }
    for (const [tail, level] of rows) await expectLevel(o, CN(tail), level, '/officer/cases');

    const somchai = await app.citizen(ID.somchai);
    await expectLevel(somchai, CN('000017'), 'paused');
    const somying = await app.citizen(ID.somying);
    await expectLevel(somying, CN('000001'), 'closed');

    await app.clock('2026-12-01T16:30:00+07:00');
    await openQueue(o.page);
    await expect(queueRow(o.page, CN('000022')).getByTestId('row-sla-level')).toHaveText('ใกล้ครบกำหนด');
    await app.clock('2026-12-01T16:31:00+07:00');
    await openQueue(o.page);
    await expect(queueRow(o.page, CN('000022')).getByTestId('row-sla-level')).toHaveText('เกินกำหนด');
  });
});
