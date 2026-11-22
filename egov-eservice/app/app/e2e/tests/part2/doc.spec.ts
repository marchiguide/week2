import type { Page } from '@playwright/test';
import {
  apiError, approve, expect, go, http, iso, issue, json, openCase, resetTime, somchai, somying, staffCaseApi, test,
} from './_helpers';

const verificationText = {
  VALID: 'เอกสารถูกต้อง',
  EXPIRED: 'เอกสารหมดอายุ',
  TAMPERED: 'ลายเซ็นไม่ถูกต้อง',
  NOT_FOUND: 'ไม่พบเอกสาร',
};

async function verifyPage(page: Page, code: string, result: keyof typeof verificationText) {
  await go(page, `/verify/${code}`, result === 'NOT_FOUND' ? 404 : 200);
  await expect(page).toHaveURL(new RegExp(`/verify/${code}$`));
  const banner = page.getByTestId('verify-result');
  await expect(banner).toHaveText(verificationText[result]);
  await expect(banner).toHaveAttribute('data-result', result);
}

async function documentDetails(page: Page, data: {
  docNo: string; applicant: string; issuedAt: string; expires: string; signer: string;
}) {
  await expect(page.getByTestId('verify-doc-no')).toHaveText(data.docNo);
  await expect(page.getByTestId('verify-applicant')).toHaveText(data.applicant);
  await expect(page.getByTestId('verify-service')).toHaveText('SV-01 ขอหนังสือรับรอง');
  await iso(page.getByTestId('verify-issued'), data.issuedAt);
  await iso(page.getByTestId('verify-expires'), data.expires);
  await expect(page.getByTestId('verify-signer')).toHaveText(data.signer);
}

async function assertDetailsAbsent(page: Page) {
  for (const id of ['doc-no', 'applicant', 'service', 'issued', 'expires', 'signer']) {
    await expect(page.getByTestId(`verify-${id}`)).toHaveCount(0);
  }
}

test('TC-DOC-01 issued PDF, public metadata, QR and duplicate issue', async ({ scenario }) => {
  const issuer = await scenario.loginStaff('off.reg2');
  await approve(issuer, 25);
  const { docNo, verifyCode } = await issue(issuer, 25);
  expect(docNo).toBe('DOC-2569-000002');

  const citizen = await scenario.loginCitizen(somying);
  const path = `/api/documents/${docNo}/pdf`;
  const pdf = await citizen.api.get(path);
  await http(pdf, 200);
  expect(pdf.headers()['content-type']).toMatch(/^application\/pdf\b/);
  expect(pdf.headers()['content-disposition']).toContain(`${docNo}.pdf`);
  expect((await pdf.body()).toString('latin1')).toContain(
    `docNo=${docNo} caseNo=EG-2569-000025 verify=${verifyCode} validUntil=2027-02-28`,
  );
  await openCase(citizen, 'citizen', 25);
  await expect(citizen.page.getByTestId('doc-qr')).toHaveAttribute(
    'data-url', new URL(`/verify/${verifyCode}`, scenario.baseURL).href,
  );

  const visitor = await scenario.anonymous();
  await verifyPage(visitor.page, verifyCode, 'VALID');
  await documentDetails(visitor.page, {
    docNo, applicant: 'สมหญิง ร***', issuedAt: resetTime, expires: '2027-02-28', signer: 'เจ้าหน้าที่ทะเบียน 2',
  });
  expect(await json(await visitor.api.get(`/api/verify/${verifyCode}`))).toMatchObject({
    result: 'VALID', validUntil: '2027-02-28', issuedAt: resetTime,
  });
  const other = await scenario.loginCitizen();
  await http(await other.api.get(path), 404);

  await apiError(await issuer.api.post(`${staffCaseApi(25)}/issue`), 409, 'INVALID_STATE');
  await approve(issuer, 26);
  expect((await issue(issuer, 26)).docNo).toBe('DOC-2569-000003');
});

test('TC-DOC-02 public verification of valid and unknown codes', async ({ scenario }) => {
  const visitor = await scenario.anonymous();
  await verifyPage(visitor.page, 'K7M2Q9XA', 'VALID');
  await documentDetails(visitor.page, {
    docNo: 'DOC-2569-000001', applicant: 'สมชาย ใ***', issuedAt: '2026-11-05T10:00:00+07:00',
    expires: '2027-02-02', signer: 'เจ้าหน้าที่ทะเบียน 1',
  });
  const body = visitor.page.locator('body');
  await expect(body).not.toContainText('ใจดี');
  await expect(body).not.toContainText(somchai);
  expect(await json(await visitor.api.get('/api/verify/K7M2Q9XA'))).toMatchObject({
    result: 'VALID', applicantMasked: 'สมชาย ใ***',
  });

  await verifyPage(visitor.page, 'ZZZZZZZZ', 'NOT_FOUND');
  await assertDetailsAbsent(visitor.page);
  expect(await json(await visitor.api.get('/api/verify/ZZZZZZZZ'), 404)).toEqual({ result: 'NOT_FOUND' });
});

test('TC-DOC-03 expiry at midnight, leap dates and tamper precedence', async ({ scenario }) => {
  test.setTimeout(90_000);
  async function expiry(code: string, lastDay: string, nextDay: string) {
    const visitor = await scenario.anonymous();
    for (const [now, result] of [
      [`${lastDay}T23:59:00+07:00`, 'VALID'],
      [`${nextDay}T00:00:00+07:00`, 'EXPIRED'],
    ] as const) {
      await scenario.clock(now);
      await verifyPage(visitor.page, code, result);
      await iso(visitor.page.getByTestId('verify-expires'), lastDay);
    }
  }

  let registry2 = await scenario.loginStaff('off.reg2');
  await approve(registry2, 25);
  let certificate = await issue(registry2, 25);
  await expiry(certificate.verifyCode, '2027-02-28', '2027-03-01');

  await scenario.reset();
  let registry1 = await scenario.loginStaff('off.reg1');
  let licence = await issue(registry1, 19);
  await expiry(licence.verifyCode, '2027-11-30', '2027-12-01');

  await scenario.reset();
  await expiry('K7M2Q9XA', '2027-02-02', '2027-02-03');

  await scenario.reset();
  const visitor = await scenario.anonymous();
  expect(await json(await visitor.api.post('/api/test/documents/DOC-2569-000001/tamper'))).toEqual({ ok: true });
  await verifyPage(visitor.page, 'K7M2Q9XA', 'TAMPERED');
  await assertDetailsAbsent(visitor.page);
  await scenario.clock('2027-03-01T00:00:00+07:00');
  await verifyPage(visitor.page, 'K7M2Q9XA', 'TAMPERED');
  await assertDetailsAbsent(visitor.page);
  expect(await json(await visitor.api.get('/api/verify/K7M2Q9XA'))).toEqual({ result: 'TAMPERED' });

  await scenario.reset();
  await scenario.clock('2028-02-29T10:00:00+07:00');
  registry2 = await scenario.loginStaff('off.reg2');
  registry1 = await scenario.loginStaff('off.reg1');
  await approve(registry2, 25);
  certificate = await issue(registry2, 25);
  licence = await issue(registry1, 19);
  expect(certificate.docNo).toBe('DOC-2571-000001');
  expect(licence.docNo).toBe('DOC-2571-000002');
  await expiry(certificate.verifyCode, '2028-05-28', '2028-05-29');
  await expiry(licence.verifyCode, '2029-02-27', '2029-02-28');
});
