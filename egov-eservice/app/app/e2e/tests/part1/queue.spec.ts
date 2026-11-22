import { test, expect } from '../../helpers/app';
import { body, expectError, expectStatus } from '../../helpers/api';
import { CN, ID, MSG, REASON10, STAFF_NAME, type StaffUser } from '../../helpers/env';
import {
  auditRows,
  claim,
  clickAndWait,
  expectQueueOrder,
  expectWorkload,
  getCase,
  openQueue,
  queueRow,
} from '../../helpers/flows';

const REG_QUEUE = ['000020', '000022', '000024', '000023', '000025', '000026', '000013', '000015', '000027', '000028', '000029', '000030', '000016', '000018', '000019', '000012', '000021'].map(CN);
const CLAIM_PATH = (caseNo: string) => new RegExp(`/api/officer/cases/${caseNo}/claim$`);

test('TC-QUEUE-01 · ลำดับคิวและขอบเขตแผนก', async ({ app }) => {
  await app.reset();
  const r1 = await app.staff('off.reg1');
  const p = r1.page;
  await openQueue(p);

  await test.step('filter all · 17 แถวตาม BR-16', async () => {
    await expect(p.getByTestId('queue-filter')).toHaveValue('all');
    await expectQueueOrder(p, REG_QUEUE);
    const levels = await p.getByTestId('row-sla-level').allInnerTexts();
    expect(levels.slice(0, 3).map((s) => s.trim())).toEqual(['เกินกำหนด', 'ใกล้ครบกำหนด', 'ใกล้ครบกำหนด']);
    for (const m of await p.getByTestId('row-id-masked').allInnerTexts()) expect(m.trim()).toMatch(/^X-XXXX-XXXXX-\d{2}-\d$/);
  });

  await test.step('claim-btn 4 ปุ่ม เฉพาะแถวไม่มีผู้รับ', async () => {
    await expect(p.getByTestId('claim-btn')).toHaveCount(4);
    const withClaim: string[] = [];
    for (const cn of REG_QUEUE) if ((await queueRow(p, cn).getByTestId('claim-btn').count()) > 0) withClaim.push(cn);
    expect(withClaim).toEqual(['000024', '000028', '000029', '000030'].map(CN));
  });

  await test.step('filter unclaimed / mine · workload 3', async () => {
    await p.getByTestId('queue-filter').selectOption('unclaimed');
    await expectQueueOrder(p, ['000024', '000028', '000029', '000030'].map(CN));
    await p.getByTestId('queue-filter').selectOption('mine');
    await expectQueueOrder(p, ['000020', '000022', '000023'].map(CN));
    await expect(p.getByTestId('workload-count')).toHaveText('3');
  });

  await test.step('off.reg2 mine 9 แถว · workload 9', async () => {
    const r2 = await app.staff('off.reg2');
    await openQueue(r2.page, 'mine');
    await expectQueueOrder(r2.page, ['000025', '000026', '000013', '000015', '000027', '000016', '000018', '000012', '000021'].map(CN));
    await expect(r2.page.getByTestId('workload-count')).toHaveText('9');
  });

  await test.step('off.works1 เห็น 000010 แถวเดียว', async () => {
    const w = await app.staff('off.works1');
    await openQueue(w.page);
    await expectQueueOrder(w.page, [CN('000010')]);
  });

  await test.step('head1 เห็น 18 แถว ไม่มี claim-btn', async () => {
    const h = await app.staff('head1');
    await openQueue(h.page);
    await expectQueueOrder(h.page, ['000020', '000022', '000024', '000010', '000023', '000025', '000026', '000013', '000015', '000027', '000028', '000029', '000030', '000016', '000018', '000019', '000012', '000021'].map(CN));
    await expect(h.page.getByTestId('claim-btn')).toHaveCount(0);
  });
});

test('TC-QUEUE-02 · รับเรื่องซ้อน (พร้อมกันและต่อกัน)', async ({ app }) => {
  const ownerText = (u: string) => new RegExp(`${u.replace('.', '\\.')}|${STAFF_NAME[u as StaffUser]}`);

  await test.step('ส่วน 1 · พร้อมกันผ่าน UI (000028)', async () => {
    await app.reset();
    const A = await app.staff('off.reg1');
    const B = await app.staff('off.reg2');
    const cn = CN('000028');
    for (const x of [A, B]) {
      await openQueue(x.page);
      await expect(queueRow(x.page, cn).getByTestId('claim-btn')).toHaveCount(1);
    }
    const [ra, rb] = await Promise.all(
      [A, B].map((x) => clickAndWait(x.page, queueRow(x.page, cn).getByTestId('claim-btn'), CLAIM_PATH(cn))),
    );
    const statuses = [ra.status(), rb.status()];
    expect(statuses.filter((s) => s === 200), `statuses ${statuses}`).toHaveLength(1);
    const [winner, loser, loserRes] = ra.status() === 200 ? [A, B, rb] : [B, A, ra];
    expect(loserRes.status()).toBe(409);
    expect((await loserRes.json()).code).toBe('ALREADY_CLAIMED');
    await expect(loser.page.getByTestId('action-error')).toHaveText(MSG.ALREADY_CLAIMED);
    await expect(queueRow(winner.page, cn).getByTestId('row-owner')).toHaveText(ownerText(winner.who));
    const k = await getCase(winner.api, cn);
    expect(k.owner).toBe(winner.who);
    expect(k.status).toBe('IN_REVIEW');
    const au = await app.staff('audit1');
    expect(await auditRows(au.api, 'CLAIM', cn)).toHaveLength(1);
  });

  await test.step('ส่วน 2 · API 10 ครั้งพร้อมกัน (000029)', async () => {
    await app.reset();
    const A = await app.staff('off.reg1');
    const B = await app.staff('off.reg2');
    const cn = CN('000029');
    const shots = [...Array(5).fill(A), ...Array(5).fill(B)] as Array<typeof A>;
    const res = await Promise.all(shots.map((x) => claim(x.api, cn)));
    const bodies = await Promise.all(res.map((r) => body(r)));
    const ok = res.map((r, i) => ({ s: r.status(), b: bodies[i], who: shots[i].who })).filter((x) => x.s === 200);
    expect(ok, JSON.stringify(res.map((r, i) => [r.status(), bodies[i]]))).toHaveLength(1);
    res.forEach((r, i) => {
      if (r.status() !== 200) {
        expect(r.status()).toBe(409);
        expect(bodies[i].code).toBe('ALREADY_CLAIMED');
      }
    });
    const k = await getCase(A.api, cn);
    expect(k.owner).toBe(ok[0].who);
    const au = await app.staff('audit1');
    expect(await auditRows(au.api, 'CLAIM', cn)).toHaveLength(1);
  });

  await test.step('ส่วน 3 · ต่อกัน (จับ B08)', async () => {
    await app.reset();
    const A = await app.staff('off.reg1');
    const B = await app.staff('off.reg2');
    const cn = CN('000029');
    const a = await expectStatus(await claim(A.api, cn), 200);
    expect(a.owner).toBe('off.reg1');
    await expectError(await claim(B.api, cn), 409, 'ALREADY_CLAIMED', MSG.ALREADY_CLAIMED);
    expect((await getCase(A.api, cn)).owner).toBe('off.reg1');
    await expectWorkload(B.page, 9);
    await expectError(await claim(A.api, cn), 409, 'ALREADY_CLAIMED');
    const au = await app.staff('audit1');
    expect(await auditRows(au.api, 'CLAIM', cn)).toHaveLength(1);
  });
});

test('TC-QUEUE-03 · งานในมือสูงสุด 10', async ({ app }) => {
  await app.reset();
  const r2 = await app.staff('off.reg2');
  const p = r2.page;

  await test.step('1 · workload 9', async () => {
    await expectWorkload(p, 9);
  });

  await test.step('2 · claim 000028 (ครั้งที่ 10) → 10', async () => {
    const res = await clickAndWait(p, queueRow(p, CN('000028')).getByTestId('claim-btn'), CLAIM_PATH(CN('000028')));
    expect(res.status()).toBe(200);
    await expectWorkload(p, 10);
  });

  await test.step('3 · claim 000029 (ครั้งที่ 11) → WORKLOAD_LIMIT', async () => {
    const res = await clickAndWait(p, queueRow(p, CN('000029')).getByTestId('claim-btn'), CLAIM_PATH(CN('000029')));
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe('WORKLOAD_LIMIT');
    await expect(p.getByTestId('action-error')).toHaveText(MSG.WORKLOAD_LIMIT);
    const k = await getCase(r2.api, CN('000029'));
    expect(k.status).toBe('SUBMITTED');
    expect(k.owner || null).toBeNull();
    await expectWorkload(p, 10);
  });

  await test.step('4 · อนุมัติ 000025 → 9', async () => {
    await p.goto(`/officer/cases/${CN('000025')}`);
    await p.getByTestId('approve-btn').click();
    await expect(p.getByTestId('case-status')).toHaveAttribute('data-status', 'APPROVED');
    await expectWorkload(p, 9);
  });

  await test.step('5 · claim 000029 อีกครั้ง → 10', async () => {
    const res = await clickAndWait(p, queueRow(p, CN('000029')).getByTestId('claim-btn'), CLAIM_PATH(CN('000029')));
    expect(res.status()).toBe(200);
    await expectWorkload(p, 10);
  });

  await test.step('6 · off.reg1 claim 000030 ไม่ติดเพดาน', async () => {
    const r1 = await app.staff('off.reg1');
    await expectStatus(await claim(r1.api, CN('000030')), 200);
  });

  await test.step('7 · RESET · ตีกลับ 000025 → 8 (NEED_FIX ไม่นับ)', async () => {
    await app.reset();
    const o = await app.staff('off.reg2');
    await o.page.goto(`/officer/cases/${CN('000025')}`);
    await o.page.getByTestId('return-btn').click();
    await o.page.getByTestId('return-reason').fill(REASON10);
    await o.page.getByTestId('return-submit').click();
    await expect(o.page.getByTestId('case-status')).toHaveText('รอแก้ไขเอกสาร');
    await expectWorkload(o.page, 8);

    await test.step('8 · claim 000028 + 000029 → 10', async () => {
      await expectStatus(await claim(o.api, CN('000028')), 200);
      await expectStatus(await claim(o.api, CN('000029')), 200);
      await expectWorkload(o.page, 10);
    });

    await test.step('9 · สมหญิงส่งแก้ → กลับผู้ถือเดิม 11', async () => {
      const s = await app.citizen(ID.somying);
      await s.page.goto(`/citizen/cases/${CN('000025')}`);
      await s.page.getByTestId('submit-fix-btn').click();
      await expect(s.page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
      await expect(s.page.getByTestId('action-error')).toBeHidden();
      expect((await getCase(o.api, CN('000025'))).owner).toBe('off.reg2');
      await expectWorkload(o.page, 11);
    });

    await test.step('10 · claim 000030 → WORKLOAD_LIMIT · ยัง 11', async () => {
      await expectError(await claim(o.api, CN('000030')), 409, 'WORKLOAD_LIMIT', MSG.WORKLOAD_LIMIT);
      await expectWorkload(o.page, 11);
    });
  });
});
