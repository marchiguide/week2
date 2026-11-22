import { test, expect } from '../../helpers/app';
import { body, expectError, expectStatus } from '../../helpers/api';
import { ID, MSG } from '../../helpers/env';
import { NEW_UNPAID, getCase, getPayment, myCases, testPay, wizardSV01ToPayment } from '../../helpers/flows';

test('TC-PAY-01 · อายุ QR 15:00', async ({ app }) => {
  // seed PP-0001 ของ DR-0002 (SV-02 ฿500) สร้าง 08:55:00 · อายุ = เวลาชำระ − 08:55:00
  await test.step('รอบ 1 · 09:00:00 (อายุ 5:00) → PAID', async () => {
    await app.reset();
    const c = await app.citizen(ID.somchai);
    const b = await expectStatus(await testPay(c.api, 'PP-0001', 500), 200);
    expect(b.status).toBe('PAID');
    expect(b.caseNo).toBe('EG-2569-000031');
  });

  await test.step('รอบ 2 · 09:09:59 (อายุ 14:59) → PAID', async () => {
    await app.reset();
    await app.clock('2026-12-01T09:09:59+07:00');
    const c = await app.citizen(ID.somchai);
    const b = await expectStatus(await testPay(c.api, 'PP-0001', 500), 200);
    expect(b.status).toBe('PAID');
    expect(b.caseNo).toBe('EG-2569-000031');
  });

  await test.step('รอบ 3 · 09:10:00 (อายุ 15:00) → 410 QR_EXPIRED', async () => {
    await app.reset();
    await app.clock('2026-12-01T09:10:00+07:00');
    const c = await app.citizen(ID.somchai);
    await expectError(await testPay(c.api, 'PP-0001', 500), 410, 'QR_EXPIRED');
    const p = await expectStatus(await getPayment(c.api, 'PP-0001'), 200);
    expect(p.status).toBe('EXPIRED');
    expect(await myCases(c.api), 'ไม่ออกเลขคำขอ').toHaveLength(10);

    const { page } = c;
    await page.goto('/citizen/new/SV-02?draft=DR-0002');
    await expect(page.getByTestId('qr-expired-msg')).toHaveText(MSG.QR_EXPIRED);
    await expect(page.getByTestId('payment-status')).toHaveText('QR หมดอายุ');
    await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'EXPIRED');
    await expect(page.getByTestId('regenerate-qr-btn')).toHaveCount(1);
    await page.getByTestId('regenerate-qr-btn').click();
    await expect(page.getByTestId('qr-ref')).toHaveText('PP-0002');
    await expect(page.getByTestId('qr-expires')).toHaveAttribute('data-iso', '2026-12-01T09:25:00+07:00');
    const b = await expectStatus(await testPay(c.api, 'PP-0002', 500), 200);
    expect(b.caseNo).toBe('EG-2569-000031');
  });

  await test.step('รอบ 4 · 09:10:01 (อายุ 15:01) → 410', async () => {
    await app.reset();
    await app.clock('2026-12-01T09:10:01+07:00');
    const c = await app.citizen(ID.somchai);
    await expectError(await testPay(c.api, 'PP-0001', 500), 410, 'QR_EXPIRED');
  });
});

test('TC-PAY-02 · ยอดเงินและ callback ซ้ำ', async ({ app }) => {
  await app.reset();
  const c = await app.citizen(ID.somchai);
  const u = await NEW_UNPAID(c.api, 'SV-01', { qty: 1 });
  expect(u.ref).toBe('PP-0002');
  expect(u.amount).toBe(20);

  await test.step('1 · ฿19 → 422 AMOUNT_MISMATCH', async () => {
    await expectError(await testPay(c.api, 'PP-0002', 19), 422, 'AMOUNT_MISMATCH');
    expect((await expectStatus(await getPayment(c.api, 'PP-0002'), 200)).status).toBe('PENDING');
    expect(await myCases(c.api)).toHaveLength(10);
  });

  await test.step('2 · ฿21 → 422', async () => {
    await expectError(await testPay(c.api, 'PP-0002', 21), 422, 'AMOUNT_MISMATCH');
    expect((await expectStatus(await getPayment(c.api, 'PP-0002'), 200)).status).toBe('PENDING');
  });

  await test.step('3 · ฿20 → PAID 000031', async () => {
    const b = await expectStatus(await testPay(c.api, 'PP-0002', 20), 200);
    expect(b.status).toBe('PAID');
    expect(b.caseNo).toBe('EG-2569-000031');
    expect(b.receiptNo).toBe('RC-2569-000031');
    expect(await myCases(c.api)).toHaveLength(11);
  });

  await test.step('4 · ซ้ำ ref เดิม → duplicate:true เลขเดิม', async () => {
    const b = await expectStatus(await testPay(c.api, 'PP-0002', 20), 200);
    expect(b.duplicate).toBe(true);
    expect(b.caseNo).toBe('EG-2569-000031');
    expect(b.receiptNo).toBe('RC-2569-000031');
    expect(await myCases(c.api)).toHaveLength(11);
  });

  await test.step('5 · ใบถัดไป 000032 ไม่ข้ามเลข', async () => {
    const n = await NEW_UNPAID(c.api, 'SV-01', { qty: 1 });
    const b = await expectStatus(await testPay(c.api, n.ref, 20), 200);
    expect(b.caseNo).toBe('EG-2569-000032');
    expect(b.receiptNo).toBe('RC-2569-000032');
  });
});

test('TC-PAY-03 · ชำระพร้อมกัน เลขไม่ซ้ำ', async ({ app }) => {
  await app.reset();
  const a = await app.citizen(ID.somchai);
  const b = await app.citizen(ID.somying);
  const orders: Array<{ who: 'somchai' | 'somying'; ref: string }> = [];
  for (const [who, actor] of [['somchai', a], ['somchai', a], ['somchai', a], ['somying', b], ['somying', b], ['somying', b]] as const) {
    const u = await NEW_UNPAID(actor.api, 'SV-01', { qty: 1 });
    orders.push({ who, ref: u.ref });
  }
  expect(orders.map((o) => o.ref).sort()).toEqual(['PP-0002', 'PP-0003', 'PP-0004', 'PP-0005', 'PP-0006', 'PP-0007']);

  const res = await Promise.all(orders.map((o) => testPay((o.who === 'somchai' ? a : b).api, o.ref, 20)));
  const bodies = await Promise.all(res.map((r) => body(r)));
  res.forEach((r, i) => expect(r.status(), `${orders[i].ref} ${JSON.stringify(bodies[i])}`).toBe(200));

  const caseNos = bodies.map((x) => x.caseNo as string);
  const receipts = bodies.map((x) => x.receiptNo as string);
  expect(new Set(caseNos).size, 'caseNo ไม่ซ้ำ').toBe(6);
  expect([...caseNos].sort()).toEqual([31, 32, 33, 34, 35, 36].map((n) => `EG-2569-0000${n}`));
  expect([...receipts].sort()).toEqual([31, 32, 33, 34, 35, 36].map((n) => `RC-2569-0000${n}`));

  const mineA = (await myCases(a.api)).map((x) => x.caseNo);
  const mineB = (await myCases(b.api)).map((x) => x.caseNo);
  orders.forEach((o, i) => {
    const mine = o.who === 'somchai' ? mineA : mineB;
    const other = o.who === 'somchai' ? mineB : mineA;
    expect(mine, `${o.who} มี ${caseNos[i]}`).toContain(caseNos[i]);
    expect(other).not.toContain(caseNos[i]);
  });

  const n = await NEW_UNPAID(a.api, 'SV-01', { qty: 1 });
  const next = await expectStatus(await testPay(a.api, n.ref, 20), 200);
  expect(next.caseNo).toBe('EG-2569-000037');
});

test('TC-PAY-04 · เลขคำขอข้ามปี', async ({ app }) => {
  await app.reset();
  const c = await app.citizen(ID.somchai);
  const { page } = c;

  await test.step('1 · 31 ธ.ค. 23:58 สร้างร่าง SV-01 + QR (ยังไม่มีเลข)', async () => {
    await app.clock('2026-12-31T23:58:00+07:00');
    await wizardSV01ToPayment(page, 1);
    await page.getByTestId('create-qr-btn').click();
    await expect(page.getByTestId('qr-ref')).toHaveText('PP-0002');
    await expect(page.getByTestId('submitted-case-no')).toHaveCount(0);
    const p = await expectStatus(await getPayment(c.api, 'PP-0002'), 200);
    expect(p.caseNo ?? null).toBeNull();
  });

  await test.step('2 · 23:59 ชำระ → EG-2569-000031', async () => {
    await app.clock('2026-12-31T23:59:00+07:00');
    const b = await expectStatus(await testPay(c.api, 'PP-0002', 20), 200);
    expect(b.caseNo).toBe('EG-2569-000031');
    expect(b.receiptNo).toBe('RC-2569-000031');
    await page.getByTestId('refresh-payment-btn').click();
    await expect(page.getByTestId('submitted-case-no')).toHaveText('EG-2569-000031');
    await expect(page.getByTestId('receipt-paid-at')).toHaveAttribute('data-iso', '2026-12-31T23:59:00+07:00');
  });

  await test.step('3 · 1 ม.ค. 2570 00:00 → EG-2570-000001', async () => {
    await app.clock('2027-01-01T00:00:00+07:00');
    const u = await NEW_UNPAID(c.api, 'SV-01', { qty: 1 });
    const b = await expectStatus(await testPay(c.api, u.ref, 20), 200);
    expect(b.caseNo).toBe('EG-2570-000001');
    expect(b.receiptNo).toBe('RC-2570-000001');
  });

  await test.step('4 · ใบที่ 2 ของปี 2570', async () => {
    const u = await NEW_UNPAID(c.api, 'SV-01', { qty: 1 });
    const b = await expectStatus(await testPay(c.api, u.ref, 20), 200);
    expect(b.caseNo).toBe('EG-2570-000002');
  });

  await test.step('5 · เลขเดิมไม่ถูกแก้', async () => {
    const k = await getCase(c.api, 'EG-2569-000031');
    expect(k.caseNo).toBe('EG-2569-000031');
  });
});
