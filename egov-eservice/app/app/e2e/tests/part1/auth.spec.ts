import { test, expect } from '../../helpers/app';
import { body, expectError, expectStatus, thaidStart, thaidVerify } from '../../helpers/api';
import { ID, MSG, OTP_BAD, OTP_OK, STAFF_NAME, type StaffUser } from '../../helpers/env';
import { clickAndWait, expectPath, openLogin, uiLoginCitizen, uiLoginStaff } from '../../helpers/flows';

const VERIFY = /\/api\/auth\/thaid\/verify$/;

test('TC-AUTH-01 · เลขบัตร 13 หลัก + checksum', async ({ app }) => {
  await app.reset();
  const a = await app.anon();
  const { page, api } = a;

  const invalid = ['110170012345', '11017001234567', '1101700123457', '11017001234ab'];
  for (const v of invalid) {
    await test.step(`ปฏิเสธ ${v}`, async () => {
      await openLogin(page, 'citizen');
      const input = page.getByTestId('thaid-id-input');
      await input.fill(v);
      await expect(input, 'ช่องไม่จำกัด maxlength (A-45)').toHaveValue(v);
      await page.getByTestId('thaid-submit').click();
      await expect(page.getByTestId('thaid-error')).toHaveText(MSG.INVALID_ID);
      await expect(page.getByTestId('otp-step')).toBeHidden();
      await expectError(await thaidStart(api, v), 400, 'INVALID_ID');
    });
  }

  const valid = [ID.somchai, ID.somying, ID.piti, ID.mana];
  for (const v of valid) {
    await test.step(`รับ ${v}`, async () => {
      await openLogin(page, 'citizen');
      await expect(page.getByTestId('thaid-submit')).toHaveText('เข้าสู่ระบบด้วย ThaiD (จำลอง)');
      await page.getByTestId('thaid-id-input').fill(v);
      await page.getByTestId('thaid-submit').click();
      await expect(page.getByTestId('otp-step')).toBeVisible();
      await expect(page.getByTestId('thaid-error')).toBeHidden();
      const b = await expectStatus(await thaidStart(api, v), 200);
      expect(b).toEqual({ status: 'OTP_SENT' });
    });
  }
});

test('TC-AUTH-02 · OTP ผิด 3 ครั้งล็อก 15 นาที', async ({ app }) => {
  await app.reset();
  const { page } = await app.anon();
  const api = await app.rawApi();

  const submitOtp = async (otp: string) => {
    await page.getByTestId('otp-input').fill(otp);
    return clickAndWait(page, page.getByTestId('otp-submit'), VERIFY);
  };

  await openLogin(page, 'citizen');
  await page.getByTestId('thaid-id-input').fill(ID.piti);
  await page.getByTestId('thaid-submit').click();
  await expect(page.getByTestId('otp-step')).toBeVisible();

  await test.step('1 · OTP ผิดครั้งที่ 1 → เหลือ 2 ครั้ง', async () => {
    const r = await submitOtp(OTP_BAD);
    expect(r.status()).toBe(401);
    expect((await r.json()).code).toBe('OTP_INVALID');
    await expect(page.getByTestId('otp-error')).toHaveText(MSG.OTP_INVALID);
    await expect(page.getByTestId('otp-attempts-left')).toHaveText('เหลือ 2 ครั้ง');
  });

  await test.step('2 · ผิดครั้งที่ 2 → เหลือ 1 ครั้ง', async () => {
    const r = await submitOtp(OTP_BAD);
    expect(r.status()).toBe(401);
    await expect(page.getByTestId('otp-attempts-left')).toHaveText('เหลือ 1 ครั้ง');
  });

  await test.step('3 · ผิดครั้งที่ 3 → 423 LOCKED ถึง 09:15:00', async () => {
    const r = await submitOtp(OTP_BAD);
    expect(r.status()).toBe(423);
    expect((await r.json()).code).toBe('LOCKED');
    await expect(page.getByTestId('lock-message')).toHaveText(MSG.LOCKED);
    await expect(page.getByTestId('lock-until')).toHaveAttribute('data-iso', '2026-12-01T09:15:00+07:00');
  });

  await test.step('4 · OTP ถูกทันที → ยัง 423', async () => {
    await expectError(await thaidVerify(api, ID.piti, OTP_OK), 423, 'LOCKED');
  });

  await test.step('5 · สมชายล็อกอินได้ระหว่างปิติถูกล็อก', async () => {
    const other = await app.rawApi();
    await expectStatus(await thaidStart(other, ID.somchai), 200);
    await expectStatus(await thaidVerify(other, ID.somchai, OTP_OK), 200);
  });

  await test.step('6 · 09:14:59 OTP ถูก → ยัง 423', async () => {
    await app.clock('2026-12-01T09:14:59+07:00');
    await expectError(await thaidVerify(api, ID.piti, OTP_OK), 423, 'LOCKED');
  });

  await test.step('7 · 09:15:00 ปลดล็อก ผิดอีกครั้ง → 401 เหลือ 2 ครั้ง', async () => {
    await app.clock('2026-12-01T09:15:00+07:00');
    await openLogin(page, 'citizen');
    await page.getByTestId('thaid-id-input').fill(ID.piti);
    await page.getByTestId('thaid-submit').click();
    await expect(page.getByTestId('otp-step')).toBeVisible();
    const r = await submitOtp(OTP_BAD);
    expect(r.status()).toBe(401);
    expect((await r.json()).code).toBe('OTP_INVALID');
    await expect(page.getByTestId('otp-attempts-left')).toHaveText('เหลือ 2 ครั้ง');
  });

  await test.step('8 · OTP ถูก → 200', async () => {
    const r = await submitOtp(OTP_OK);
    expect(r.status()).toBe(200);
    await expectPath(page, '/citizen');
  });

  await test.step('9 · RESET · ผิด 2 → ถูก → ออก → ผิด 2 ไม่ล็อก (ตัวนับรีเซ็ต)', async () => {
    await app.reset();
    const p = await app.rawApi();
    await expectStatus(await thaidStart(p, ID.piti), 200);
    expect((await expectError(await thaidVerify(p, ID.piti, OTP_BAD), 401, 'OTP_INVALID')).attemptsLeft).toBe(2);
    expect((await expectError(await thaidVerify(p, ID.piti, OTP_BAD), 401, 'OTP_INVALID')).attemptsLeft).toBe(1);
    await expectStatus(await thaidVerify(p, ID.piti, OTP_OK), 200);
    expect((await p.post('/api/auth/logout')).status()).toBe(204);
    await expectStatus(await thaidStart(p, ID.piti), 200);
    expect((await expectError(await thaidVerify(p, ID.piti, OTP_BAD), 401, 'OTP_INVALID')).attemptsLeft).toBe(2);
    expect((await expectError(await thaidVerify(p, ID.piti, OTP_BAD), 401, 'OTP_INVALID')).attemptsLeft).toBe(1);
  });
});

test('TC-AUTH-03 · ลงทะเบียนครั้งแรก', async ({ app }) => {
  await app.reset();
  const { page } = await app.anon();

  await uiLoginCitizen(page, ID.mana);
  await expectPath(page, '/register');

  await test.step('1 · reg-name อ่านอย่างเดียว', async () => {
    const name = page.getByTestId('reg-name');
    await expect(name).toHaveValue('มานะ ตั้งใจ');
    expect(await name.evaluate((e) => (e as HTMLInputElement).readOnly)).toBe(true);
    await name.focus();
    await page.keyboard.type('abc');
    await expect(name).toHaveValue('มานะ ตั้งใจ');
  });

  const submitWith = async (mobile: string, consent: boolean) => {
    await page.getByTestId('reg-mobile').fill(mobile);
    await page.getByTestId('reg-email').fill('');
    await page.getByTestId('reg-consent').setChecked(consent);
    await page.getByTestId('reg-submit').click();
  };

  for (const bad of ['081234567', '08123456789', '1812345678', '08123abcde']) {
    await test.step(`2–4 · เบอร์ ${bad} ไม่ผ่าน`, async () => {
      await submitWith(bad, true);
      await expect(page.getByTestId('reg-error-mobile')).toHaveText(MSG.INVALID_MOBILE);
      await expectPath(page, '/register');
    });
  }

  await test.step('5 · ไม่ติ๊กยินยอม', async () => {
    await submitWith('0845678901', false);
    await expect(page.getByTestId('reg-error-consent')).toHaveText(MSG.CONSENT_REQUIRED);
    await expectPath(page, '/register');
  });

  await test.step('6 · ครบ → /citizen', async () => {
    await expect(page.getByTestId('reg-submit')).toHaveText('ลงทะเบียน');
    await submitWith('0845678901', true);
    await expectPath(page, '/citizen');
    await expect(page.getByTestId('citizen-welcome')).toHaveText('สวัสดี มานะ ตั้งใจ');
  });

  await test.step('7 · ออก → ล็อกอินใหม่ เข้า /citizen ตรง ๆ', async () => {
    await page.getByTestId('logout-btn').click();
    await expectPath(page, '/login');
    const visited: string[] = [];
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
    });
    await uiLoginCitizen(page, ID.mana);
    await expectPath(page, '/citizen');
    expect(visited, 'ไม่ผ่าน /register').not.toContain('/register');
  });

  await test.step('8 · RESET · API register ยังไม่ลงทะเบียน', async () => {
    await app.reset();
    const api = await app.rawApi();
    await expectStatus(await thaidStart(api, ID.mana), 200);
    const v = await expectStatus(await thaidVerify(api, ID.mana, OTP_OK), 200);
    expect(v.registered).toBe(false);
    await expectError(await api.post('/api/auth/register', { data: { mobile: '081234567', email: '', consent: true } }), 400, 'INVALID_MOBILE');
    await expectError(await api.post('/api/auth/register', { data: { mobile: '0845678901', email: '', consent: false } }), 400, 'CONSENT_REQUIRED');
  });
});

test('TC-AUTH-04 · เจ้าหน้าที่ SSO จำลองและหน้าตั้งต้น', async ({ app }) => {
  await app.reset();
  const { page } = await app.anon();
  const api = await app.rawApi();

  const table: Array<[StaffUser, string, string, string, string | null]> = [
    ['off.reg1', '/officer/queue', 'เจ้าหน้าที่', 'officer', 'registry'],
    ['off.reg2', '/officer/queue', 'เจ้าหน้าที่', 'officer', 'registry'],
    ['off.works1', '/officer/queue', 'เจ้าหน้าที่', 'officer', 'works'],
    ['head1', '/head/approvals', 'หัวหน้าฝ่าย', 'head', null],
    ['exec1', '/dashboard', 'ผู้บริหาร', 'executive', null],
    ['audit1', '/audit', 'ผู้ตรวจสอบภายใน', 'auditor', null],
    ['admin1', '/admin/services', 'ผู้ดูแลระบบ', 'admin', null],
  ];

  for (const [user, landing, roleText, role, dept] of table) {
    await test.step(`${user} → ${landing}`, async () => {
      await openLogin(page, 'staff');
      await expect(page.getByTestId('staff-submit')).toHaveText('เข้าสู่ระบบเจ้าหน้าที่ (SSO ภาครัฐ จำลอง)');
      await uiLoginStaff(page, user);
      await expectPath(page, landing);
      await expect(page.getByTestId('user-name')).toHaveText(STAFF_NAME[user]);
      const r = page.getByTestId('user-role');
      await expect(r).toHaveText(roleText);
      await expect(r).toHaveAttribute('data-role', role);
      if (dept) await expect(r).toHaveAttribute('data-dept', dept);
      await page.getByTestId('logout-btn').click();
      await expectPath(page, '/login');
    });
  }

  for (const [username, password] of [['off.reg1', 'wrong'], ['nobody', 'Test@1234'], [ID.somchai, 'Test@1234']]) {
    await test.step(`ปฏิเสธ ${username}/${password}`, async () => {
      await uiLoginStaff(page, username, password);
      await expect(page.getByTestId('staff-error')).toHaveText(MSG.INVALID_CREDENTIALS);
      await expectPath(page, '/login');
      const res = await api.post('/api/auth/staff/login', { data: { username, password } });
      const b = await body(res);
      expect(res.status(), JSON.stringify(b)).toBe(401);
      expect(b.code).toBe('INVALID_CREDENTIALS');
    });
  }

  await test.step('ออกจากระบบแล้วเปิด /officer/queue → /login', async () => {
    await uiLoginStaff(page, 'off.reg1');
    await expectPath(page, '/officer/queue');
    await page.getByTestId('logout-btn').click();
    await expectPath(page, '/login');
    await page.goto('/officer/queue');
    await expectPath(page, '/login');
  });
});
