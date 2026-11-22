import { test, expect } from '../../helpers/app';
import { expectError, expectStatus, type Json } from '../../helpers/api';
import { ID, MSG } from '../../helpers/env';
import { fxBuffer, type TestFileName } from '../../helpers/files';
import { createDraft, fxPath, removeAllFiles, tidWith, uploadFile, wizardToUpload } from '../../helpers/flows';
import type { APIRequestContext } from '@playwright/test';

/** จำนวนไฟล์ของร่างจาก GET /api/drafts/:id (รองรับ {files} หรือ {items:[{files}]}) */
async function draftFileCount(api: APIRequestContext, draftId: string): Promise<number> {
  const b: Json = await expectStatus(await api.get(`/api/drafts/${draftId}`), 200);
  const files = b?.files ?? b?.draft?.files ?? b?.items?.[0]?.files;
  expect(Array.isArray(files), `GET /api/drafts/${draftId} ต้องมีรายการ files: ${JSON.stringify(b)}`).toBe(true);
  return files.length;
}

test('TC-UPLOAD-01 · ขนาดและจำนวนไฟล์', async ({ app }) => {
  await app.reset();
  const { page, api } = await app.citizen(ID.somchai);
  const items = page.getByTestId('file-item');
  const err = page.getByTestId('upload-error');
  const idInput = page.getByTestId('upload-input-id-card');

  await wizardToUpload(page, 'SV-01', { qty: 1 });
  const apiDraft = await createDraft(api, { serviceId: 'SV-01', qty: 1 });

  await test.step('5,242,879 ไบต์ → รับ', async () => {
    await idInput.setInputFiles(fxPath('size-5242879.pdf'));
    await expect(items).toHaveCount(1);
    await expect(err).toBeHidden();
    await expectStatus(await uploadFile(api, apiDraft.draftId, 'id-card', 'size-5242879.pdf'), 201);
    await removeAllFiles(page);
  });

  await test.step('5,242,880 ไบต์ (ขอบ ≤ 5 MB) → รับ', async () => {
    await idInput.setInputFiles(fxPath('size-5242880.pdf'));
    await expect(items).toHaveCount(1);
    await expect(err).toBeHidden();
    await expectStatus(await uploadFile(api, apiDraft.draftId, 'id-card', 'size-5242880.pdf'), 201);
    await removeAllFiles(page);
  });

  await test.step('5,242,881 ไบต์ → 400 FILE_TOO_LARGE (ไม่ใช่ 413)', async () => {
    await idInput.setInputFiles(fxPath('size-5242881.pdf'));
    await expect(err).toHaveText(MSG.FILE_TOO_LARGE);
    await expect(items).toHaveCount(0);
    await expectError(await uploadFile(api, apiDraft.draftId, 'id-card', 'size-5242881.pdf'), 400, 'FILE_TOO_LARGE', MSG.FILE_TOO_LARGE);
  });

  await test.step('จำนวน: 5 ไฟล์รับ · ไฟล์ที่ 6 ปฏิเสธ', async () => {
    await removeAllFiles(page);
    await idInput.setInputFiles(fxPath('id-card.pdf'));
    await expect(items).toHaveCount(1);
    await page.getByTestId('upload-input-extra').setInputFiles([1, 2, 3, 4].map((i) => fxPath(`multi-${i}.pdf` as TestFileName)));
    await expect(items).toHaveCount(5);

    await page.getByTestId('upload-input-extra').setInputFiles(fxPath('multi-5.pdf'));
    await expect(err).toHaveText(MSG.FILE_COUNT);
    await expect(items).toHaveCount(5);

    await tidWith(page, 'file-item', { name: 'multi-1.pdf' }).getByTestId('file-remove-btn').click();
    await expect(items).toHaveCount(4);
    await page.getByTestId('upload-input-extra').setInputFiles(fxPath('multi-5.pdf'));
    await expect(items).toHaveCount(5);
    await expect(tidWith(page, 'file-item', { name: 'multi-5.pdf' })).toHaveCount(1);
  });

  await test.step('จำนวน (API): ไฟล์ที่ 6 → 400 FILE_COUNT', async () => {
    const d = await createDraft(api, { serviceId: 'SV-01', qty: 1 });
    await expectStatus(await uploadFile(api, d.draftId, 'id-card', 'id-card.pdf'), 201);
    for (const i of [1, 2, 3, 4]) await expectStatus(await uploadFile(api, d.draftId, 'extra', `multi-${i}.pdf` as TestFileName), 201);
    await expectError(await uploadFile(api, d.draftId, 'extra', 'multi-5.pdf'), 400, 'FILE_COUNT', MSG.FILE_COUNT);
    expect(await draftFileCount(api, d.draftId)).toBe(5);
  });
});

test('TC-UPLOAD-02 · ชนิดไฟล์จากเนื้อไฟล์', async ({ app }) => {
  await app.reset();
  const { page, api } = await app.citizen(ID.somchai);
  const items = page.getByTestId('file-item');
  const err = page.getByTestId('upload-error');
  const idInput = page.getByTestId('upload-input-id-card');

  await wizardToUpload(page, 'SV-01', { qty: 1 });
  const d = await createDraft(api, { serviceId: 'SV-01', qty: 1 });

  for (const f of ['ok-id.pdf', 'real.jpg', 'real.png'] as TestFileName[]) {
    await test.step(`รับ ${f}`, async () => {
      await idInput.setInputFiles(fxPath(f));
      await expect(items).toHaveCount(1);
      await expect(err).toBeHidden();
      await removeAllFiles(page);
      await expectStatus(await uploadFile(api, d.draftId, 'id-card', f), 201);
    });
  }

  const accepted = await draftFileCount(api, d.draftId);

  const rejected: Array<{ f: TestFileName; mimeType?: string }> = [
    { f: 'fake-text.pdf' },
    { f: 'fake-text.jpg' },
    { f: 'exe-as.png' },
    { f: 'notes.txt' },
    { f: 'fake-text.pdf', mimeType: 'application/pdf' },
  ];
  for (const { f, mimeType } of rejected) {
    await test.step(`ปฏิเสธ ${f}${mimeType ? ` (mimeType ${mimeType})` : ''}`, async () => {
      if (mimeType) await idInput.setInputFiles({ name: f, mimeType, buffer: fxBuffer(f) });
      else await idInput.setInputFiles(fxPath(f));
      await expect(err).toHaveText(MSG.FILE_TYPE);
      await expect(items).toHaveCount(0);
      await expectError(await uploadFile(api, d.draftId, 'id-card', f, mimeType ? { mimeType } : {}), 400, 'FILE_TYPE', MSG.FILE_TYPE);
      expect(await draftFileCount(api, d.draftId), 'ไฟล์ที่ปฏิเสธไม่ถูกเก็บ').toBe(accepted);
    });
  }
});
