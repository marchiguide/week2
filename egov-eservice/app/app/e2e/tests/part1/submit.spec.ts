import { test, expect } from '../../helpers/app';
import { body, expectError, expectStatus } from '../../helpers/api';
import { CN, ID, MSG } from '../../helpers/env';
import {
  attrList,
  claim,
  createDraft,
  createPayment,
  expectPath,
  expectQueueOrder,
  fxPath,
  getCase,
  mineCount,
  myCases,
  openQueue,
  queueRow,
  testPay,
  tidWith,
  uploadFile,
} from '../../helpers/flows';

/** คิวทะเบียนเริ่มต้น 17 แถว (TEST-DATA 9.1) */
const REG_QUEUE = ['000020', '000022', '000024', '000023', '000025', '000026', '000013', '000015', '000027', '000028', '000029', '000030', '000016', '000018', '000019', '000012', '000021'];

test('TC-SUBMIT-01 · ยื่นคำขอ SV-01 ครบวงจร', async ({ app }) => {
  await app.reset();
  const c = await app.citizen(ID.somchai);
  const { page } = c;

  await test.step('1 · กรอกข้อมูล qty 2 → ฿40', async () => {
    await page.goto('/citizen');
    await page.getByTestId('start-service-SV-01').click();
    await expectPath(page, '/citizen/new/SV-01');
    await expect(page.getByTestId('wizard-step')).toHaveText('1/3 กรอกข้อมูล');
    await page.getByTestId('qty-input').fill('2');
    await expect(page.getByTestId('fee-total')).toHaveText('฿40');
    await page.getByTestId('to-upload-btn').click();
  });

  await test.step('2 · แนบ id-card.pdf', async () => {
    await expect(page.getByTestId('wizard-step')).toHaveText('2/3 แนบเอกสาร');
    await expect(page.getByTestId('to-payment-btn')).toBeDisabled();
    await page.getByTestId('upload-input-id-card').setInputFiles(fxPath('id-card.pdf'));
    await expect(page.getByTestId('file-item')).toHaveCount(1);
    await expect(page.getByTestId('file-item')).toHaveAttribute('data-doc-key', 'id-card');
    await expect(page.getByTestId('to-payment-btn')).toBeEnabled();
    await page.getByTestId('to-payment-btn').click();
  });

  await test.step('3 · สร้าง QR PP-0002', async () => {
    await expect(page.getByTestId('wizard-step')).toHaveText('3/3 ชำระเงิน');
    await expect(page.getByTestId('payment-amount')).toHaveText('฿40');
    await page.getByTestId('create-qr-btn').click();
    await expect(page.getByTestId('qr-ref')).toHaveText('PP-0002');
    await expect(page.getByTestId('qr-expires')).toHaveAttribute('data-iso', '2026-12-01T09:15:00+07:00');
    await expect(page.getByTestId('payment-status')).toHaveText('รอชำระ');
  });

  await test.step('4 · ชำระ ฿40 → EG-2569-000031', async () => {
    const b = await expectStatus(await testPay(c.api, 'PP-0002', 40), 200);
    expect(b).toEqual({ status: 'PAID', caseNo: 'EG-2569-000031', receiptNo: 'RC-2569-000031', duplicate: false });
    await page.getByTestId('refresh-payment-btn').click();
    await expect(page.getByTestId('payment-status')).toHaveText('ชำระแล้ว');
    await expect(page.getByTestId('submitted-case-no')).toHaveText('EG-2569-000031');
    await expect(page.getByTestId('receipt-no')).toHaveText('RC-2569-000031');
    await expect(page.getByTestId('receipt-amount')).toHaveText('฿40');
    await expect(page.getByTestId('receipt-paid-at')).toHaveAttribute('data-iso', '2026-12-01T09:00:00+07:00');
  });

  await test.step('5 · หน้าคำขอ', async () => {
    await page.getByTestId('go-case-btn').click();
    await expectPath(page, '/citizen/cases/EG-2569-000031');
    await expect(page.getByTestId('case-status')).toHaveText('ส่งคำขอแล้ว');
    await expect(page.getByTestId('case-status')).toHaveAttribute('data-status', 'SUBMITTED');
    await expect(page.getByTestId('case-fee')).toHaveText('฿40');
    await expect(page.getByTestId('sla-due')).toHaveText('4 ธ.ค. 2569 16:30');
    await expect(page.getByTestId('sla-due')).toHaveAttribute('data-iso', '2026-12-04T16:30:00+07:00');
    await expect(page.getByTestId('sla-level')).toHaveText('ปกติ');
    await expect(page.getByTestId('cancel-case-btn')).toHaveCount(1);
    await expect(page.getByTestId('case-step')).toHaveCount(0);
  });

  await test.step('off.reg1 เห็นในคิว ท้ายกลุ่ม 4 ธ.ค.', async () => {
    const o = await app.staff('off.reg1');
    await openQueue(o.page);
    const expected = [...REG_QUEUE];
    expected.splice(expected.indexOf('000030') + 1, 0, '000031');
    await expectQueueOrder(o.page, expected.map(CN));
    const row = queueRow(o.page, 'EG-2569-000031');
    await expect(row.getByTestId('row-owner')).toHaveText('');
    await expect(row.getByTestId('claim-btn')).toHaveCount(1);
  });
});

test('TC-SUBMIT-02 · เอกสารบังคับครบก่อนชำระ', async ({ app }) => {
  await app.reset();
  const { page, api } = await app.citizen(ID.somchai);
  const toPay = page.getByTestId('to-payment-btn');
  const missing = page.getByTestId('missing-docs');

  await test.step('SV-02', async () => {
    await page.goto('/citizen/new/SV-02');
    await page.getByTestId('to-upload-btn').click();
    await expect(page.getByTestId('wizard-step')).toHaveText('2/3 แนบเอกสาร');
    await page.getByTestId('upload-input-id-card').setInputFiles(fxPath('id-card.pdf'));
    await expect(page.getByTestId('file-item')).toHaveCount(1);
    await expect(toPay).toBeDisabled();
    await expect(missing).toHaveText('ยังขาดเอกสาร: แผนที่ตั้ง');

    await page.getByTestId('upload-input-map').setInputFiles(fxPath('map.pdf'));
    await expect(page.getByTestId('file-item')).toHaveCount(2);
    await expect(toPay).toBeEnabled();
    await expect(missing).toHaveCount(0);

    await tidWith(page, 'file-item', { 'doc-key': 'map' }).getByTestId('file-remove-btn').click();
    await expect(page.getByTestId('file-item')).toHaveCount(1);
    await expect(toPay).toBeDisabled();
    await expect(missing).toHaveText('ยังขาดเอกสาร: แผนที่ตั้ง');
  });

  await test.step('SV-03 พื้นที่ 100', async () => {
    await page.goto('/citizen/new/SV-03');
    await page.getByTestId('area-input').fill('100');
    await page.getByTestId('to-upload-btn').click();
    await expect(page.getByTestId('wizard-step')).toHaveText('2/3 แนบเอกสาร');

    await page.getByTestId('upload-input-id-card').setInputFiles(fxPath('id-card.pdf'));
    await expect(page.getByTestId('file-item')).toHaveCount(1);
    await expect(toPay).toBeDisabled();
    await expect(missing).toHaveText('ยังขาดเอกสาร: แบบแปลน, โฉนด');

    await page.getByTestId('upload-input-deed').setInputFiles(fxPath('deed.pdf'));
    await expect(page.getByTestId('file-item')).toHaveCount(2);
    await expect(toPay).toBeDisabled();
    await expect(missing).toHaveText('ยังขาดเอกสาร: แบบแปลน');

    await page.getByTestId('upload-input-plan').setInputFiles(fxPath('plan-as-jpg.jpg'));
    await expect(page.getByTestId('upload-error')).toHaveText(MSG.PLAN_NOT_PDF);
    await expect(page.getByTestId('file-item')).toHaveCount(2);
    await expect(toPay).toBeDisabled();
    await expect(missing).toHaveText('ยังขาดเอกสาร: แบบแปลน');

    await page.getByTestId('upload-input-plan').setInputFiles(fxPath('plan.pdf'));
    await expect(page.getByTestId('file-item')).toHaveCount(3);
    await expect(toPay).toBeEnabled();
    await expect(missing).toHaveCount(0);
  });

  await test.step('API: ขาดแบบแปลน → 409 MISSING_DOCS · ครบ → 201', async () => {
    const d = await createDraft(api, { serviceId: 'SV-03', areaSqm: 100 });
    await expectStatus(await uploadFile(api, d.draftId, 'id-card', 'id-card.pdf'), 201);
    await expectStatus(await uploadFile(api, d.draftId, 'deed', 'deed.pdf'), 201);
    const e = await expectError(await api.post(`/api/drafts/${d.draftId}/payment`), 409, 'MISSING_DOCS');
    expect(e.missing).toEqual(['แบบแปลน']);
    await expectError(await uploadFile(api, d.draftId, 'plan', 'plan-as-jpg.jpg'), 400, 'PLAN_NOT_PDF');
    await expectStatus(await uploadFile(api, d.draftId, 'plan', 'plan.pdf'), 201);
    await createPayment(api, d.draftId);
  });
});

test('TC-SUBMIT-03 · ร่าง และการยกเลิก', async ({ app }) => {
  await test.step('ส่วน A ร่าง', async () => {
    await app.reset();
    const { page, api } = await app.citizen(ID.somchai);
    await page.goto('/citizen');
    await expect(page.getByTestId('my-case-row')).toHaveCount(10);
    const drafts = page.getByTestId('my-draft-row');
    await expect(drafts).toHaveCount(2);
    await expect(tidWith(page, 'my-draft-row', { 'draft-id': 'DR-0001' })).toHaveAttribute('data-status', 'DRAFT');
    await expect(tidWith(page, 'my-draft-row', { 'draft-id': 'DR-0002' })).toHaveAttribute('data-status', 'PENDING_PAYMENT');
    for (const t of await drafts.allInnerTexts()) expect(t, 'แถวร่างไม่มี EG-').not.toContain('EG-');

    await tidWith(page, 'my-draft-row', { 'draft-id': 'DR-0001' }).getByTestId('open-draft-btn').click();
    await expect(page.getByTestId('qty-input')).toHaveValue('2');
    await expect(page.getByTestId('fee-total')).toHaveText('฿40');

    await page.goto('/citizen/new/SV-01');
    await page.getByTestId('qty-input').fill('3');
    await page.getByTestId('save-draft-btn').click();
    await expect(page.getByTestId('draft-id')).toHaveText('DR-0003');

    await page.goto('/citizen');
    await expect(page.getByTestId('my-case-row')).toHaveCount(10);
    expect(await myCases(api)).toHaveLength(10);
    const d = await expectStatus(await api.get('/api/drafts'), 200);
    expect(d.items).toHaveLength(3);
  });

  await test.step('ส่วน B ยกเลิก …000030', async () => {
    await app.reset();
    const { page } = await app.citizen(ID.somchai);
    await page.goto(`/citizen/cases/${CN('000030')}`);
    await expect(page.getByTestId('cancel-case-btn')).toHaveCount(1);
    await page.getByTestId('cancel-case-btn').click();
    await expect(page.getByTestId('cancel-confirm-text')).toHaveText(MSG.NO_REFUND);
    await page.getByTestId('confirm-cancel-btn').click();
    await expect(page.getByTestId('case-status')).toHaveText('ยกเลิก');
    await expect(page.getByTestId('case-status')).toHaveAttribute('data-status', 'CANCELLED');
    await expect(page.getByTestId('no-refund-note')).toHaveText(MSG.NO_REFUND);
    await expect(page.getByTestId('cancel-case-btn')).toHaveCount(0);

    const o = await app.staff('off.reg1');
    await openQueue(o.page);
    await expectQueueOrder(o.page, REG_QUEUE.filter((x) => x !== '000030').map(CN));
    expect(await attrList(o.page.getByTestId('queue-row'), 'data-case-no')).not.toContain(CN('000030'));

    const e = await app.staff('exec1');
    await e.page.goto('/dashboard');
    await expect(e.page.getByTestId('kpi-backlog')).toHaveText('20');
    await expect(e.page.getByTestId('kpi-received')).toHaveText('3');
  });

  await test.step('ส่วน C ยกเลิกไม่ได้เมื่อมีผู้รับ', async () => {
    await app.reset();
    const o = await app.staff('off.reg1');
    await expectStatus(await claim(o.api, CN('000030')), 200);
    const c = await app.citizen(ID.somchai);
    await c.page.goto(`/citizen/cases/${CN('000030')}`);
    await expect(c.page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
    await expect(c.page.getByTestId('cancel-case-btn')).toHaveCount(0);
    await expectError(await c.api.post(`/api/cases/${CN('000030')}/cancel`), 409, 'CANNOT_CANCEL', MSG.CANNOT_CANCEL);
    await expectError(await c.api.post(`/api/cases/${CN('000013')}/cancel`), 409);
  });

  await test.step('ส่วน E ลบร่าง', async () => {
    await app.reset();
    const { page, api } = await app.citizen(ID.somchai);
    expect((await api.delete('/api/drafts/DR-0001')).status()).toBe(204);
    expect((await api.get('/api/drafts/DR-0001')).status()).toBe(404);
    await page.goto('/citizen');
    await expect(page.getByTestId('my-draft-row')).toHaveCount(1);
    await expect(page.getByTestId('my-draft-row')).toHaveAttribute('data-draft-id', 'DR-0002');
    expect((await api.delete('/api/drafts/DR-0002')).status()).toBe(204);
    expect((await api.get('/api/payments/PP-0001')).status()).toBe(404);
    expect((await testPay(api, 'PP-0001', 500)).status()).toBe(404);
  });

  await test.step('ส่วน F ยกเลิกชนกับรับเรื่อง (พร้อมกัน)', async () => {
    await app.reset();
    const c = await app.citizen(ID.somchai);
    const o = await app.staff('off.reg1');
    const [rc, ro] = await Promise.all([c.api.post(`/api/cases/${CN('000030')}/cancel`), claim(o.api, CN('000030'))]);
    const [bc, bo] = [await body(rc), await body(ro)];
    const ok = [rc.status(), ro.status()].filter((s) => s === 200).length;
    expect(ok, `cancel=${rc.status()} ${JSON.stringify(bc)} · claim=${ro.status()} ${JSON.stringify(bo)}`).toBe(1);
    const k = await getCase(o.api, CN('000030'));
    if (rc.status() === 200) {
      expect(ro.status()).toBe(409);
      expect(bo.code).toBe('INVALID_STATE');
      expect(k.status).toBe('CANCELLED');
      expect(k.owner || null, 'ไม่มีผู้ถือ').toBeNull();
      expect(await mineCount(o.api)).toBe(3);
    } else {
      expect(rc.status()).toBe(409);
      expect(bc.code).toBe('CANNOT_CANCEL');
      expect(k.status).toBe('IN_REVIEW');
      expect(k.owner).toBe('off.reg1');
      expect(await mineCount(o.api)).toBe(4);
    }
  });
});
