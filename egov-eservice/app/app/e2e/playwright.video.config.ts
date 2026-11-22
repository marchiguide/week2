/**
 * Evidence run only (PROMPTS step 4: GIF of every P1 TC).
 * Same as playwright.config.ts, plus recordVideo in contextOptions so contexts the tests open themselves
 * (browser.newContext(this.contextOptions) in tests/part2/_helpers.ts) are recorded too.
 * Does not change any test or expected value.
 *   PW_VIDEO_DIR=/tmp/step4-video npx playwright test -c playwright.video.config.ts
 */
import base from './playwright.config';

const dir = process.env.PW_VIDEO_DIR || 'reports/videos';

export default {
  ...base,
  use: {
    ...base.use,
    video: 'off',
    contextOptions: {
      ...(base.use?.contextOptions ?? {}),
      recordVideo: { dir, size: { width: 1280, height: 720 } },
    },
  },
};
