import { test, expect } from '../../helpers/app';
import { expectError, expectStatus } from '../../helpers/api';
import { MSG } from '../../helpers/env';

/**
 * TC-FEE-01 (จับ B01) · ผลคาดหวังคิดจากสูตร BR-04 BR-05:
 * SV-01 = 20 × ฉบับ (1–5) · SV-02 = 500 · SV-03 = 1,000 (1–100) / 1,000 + 10 × (พื้นที่ − 100) (101–500)
 */
type Row = { v: number; total: string; fee?: number; err?: string; code?: string };

const SV03: Row[] = [
  { v: 0, total: '–', err: MSG.INVALID_AREA, code: 'INVALID_AREA' },
  { v: -1, total: '–', err: MSG.INVALID_AREA, code: 'INVALID_AREA' },
  { v: 1, total: '฿1,000', fee: 1000 },
  { v: 100, total: '฿1,000', fee: 1000 },
  { v: 101, total: '฿1,010', fee: 1010 },
  { v: 102, total: '฿1,020', fee: 1020 },
  { v: 250, total: '฿2,500', fee: 2500 },
  { v: 300, total: '฿3,000', fee: 3000 },
  { v: 499, total: '฿4,990', fee: 4990 },
  { v: 500, total: '฿5,000', fee: 5000 },
  { v: 501, total: '–', err: MSG.AREA_TOO_LARGE, code: 'AREA_TOO_LARGE' },
];

const SV01: Row[] = [
  { v: 0, total: '–', err: MSG.INVALID_QTY, code: 'INVALID_QTY' },
  { v: 1, total: '฿20', fee: 20 },
  { v: 2, total: '฿40', fee: 40 },
  { v: 3, total: '฿60', fee: 60 },
  { v: 4, total: '฿80', fee: 80 },
  { v: 5, total: '฿100', fee: 100 },
  { v: 6, total: '–', err: MSG.INVALID_QTY, code: 'INVALID_QTY' },
];

test('TC-FEE-01 · ค่าธรรมเนียม SV-01 / SV-02 / SV-03', async ({ app }) => {
  await app.reset();
  const { page, api } = await app.citizen();

  const check = async (service: 'SV-01' | 'SV-03', inputId: string, field: string, rows: Row[]) => {
    await page.goto(`/citizen/new/${service}`);
    for (const r of rows) {
      await test.step(`${service} ${field}=${r.v} → ${r.total}`, async () => {
        await page.getByTestId(inputId).fill(String(r.v));
        await expect.soft(page.getByTestId('fee-total')).toHaveText(r.total);
        if (r.err) {
          await expect.soft(page.getByTestId('fee-error')).toHaveText(r.err);
          await expect.soft(page.getByTestId('to-upload-btn')).toBeDisabled();
          await expectError(await api.post('/api/drafts', { data: { serviceId: service, [field]: r.v } }), 400, r.code);
        } else {
          await expect.soft(page.getByTestId('fee-error')).toBeHidden();
          await expect.soft(page.getByTestId('to-upload-btn')).toBeEnabled();
          const b = await expectStatus(await api.post('/api/drafts', { data: { serviceId: service, [field]: r.v } }), 201);
          expect.soft(b.fee, `API fee ${service} ${field}=${r.v}`).toBe(r.fee);
        }
      });
    }
  };

  await check('SV-03', 'area-input', 'areaSqm', SV03);
  await check('SV-01', 'qty-input', 'qty', SV01);

  await test.step('SV-02 ไม่มีช่องกรอก ฿500', async () => {
    await page.goto('/citizen/new/SV-02');
    await expect(page.getByTestId('fee-total')).toHaveText('฿500');
    await expect(page.getByTestId('qty-input')).toHaveCount(0);
    await expect(page.getByTestId('area-input')).toHaveCount(0);
    const b = await expectStatus(await api.post('/api/drafts', { data: { serviceId: 'SV-02' } }), 201);
    expect(b.fee).toBe(500);
  });
});
