import { defineConfig, devices } from '@playwright/test';

/**
 * BASE_URL  = ที่อยู่เว็บ (TEST-PLAN §0) ค่าเริ่มต้น http://localhost:8080
 * workers 1 = POST /api/test/reset ล้างทั้งระบบ (CONTRACT 0.9) จึงรันขนานไม่ได้
 * PW_VIDEO=1 = อัดวิดีโอทุก context (ใช้ทำ GIF ของ TC ระดับ P1)
 */
export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: './tests',
  globalSetup: './helpers/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/results.json' }],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.PW_VIDEO === '1' ? 'on' : 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
});
