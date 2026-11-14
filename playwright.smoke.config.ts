// End-to-end smoke tests: the built Worker runs locally (wrangler dev) against a fake Supabase with synthetic users.
// Needs `npm run build` first. Run: npm run test:smoke
import { defineConfig } from '@playwright/test';
import { CORE_KEYS, MODULE_KEYS } from './tests/smoke/keys';

// SMOKE_PORT / SMOKE_FAKE_PORT let two checkouts run the suite at the same time on one machine
const WORKER = Number(process.env['SMOKE_PORT'] || 8787), FAKE = Number(process.env['SMOKE_FAKE_PORT'] || 8788);
const CFG = '--config dist/server/wrangler.smoke.json', STATE = '.wrangler/smoke-state';
const secret = 'smoke-session-secret-smoke-session-secret';

export default defineConfig({
  testDir: 'tests/smoke',
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  // One retry in CI stays for now: with retries 0 a full local run failed 6 timing-sensitive tests (maestro CLS, period filter, buyer exec box, locked page,
  // admin users) that all pass alone, so a hard 0 would turn machine load into red PRs. Flaky ones show as warnings in the run; the sleeps are gone from the
  // specs that had them (tests/smoke/settle.ts). Set 0 once those six are fixed.
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${WORKER}`,
    // test-results/ is uploaded as a public artifact on failure: no traces, screenshots or videos, only the text error context (synthetic pages)
    trace: 'off', screenshot: 'off', video: 'off',
    locale: 'ar',
    timezoneId: 'Asia/Riyadh',
    ...(process.env['PW_CHANNEL'] ? { channel: process.env['PW_CHANNEL'] } : {}),
  },
  webServer: [
    {
      command: 'node tests/smoke/fake-supabase.mjs',
      env: { FAKE_PORT: String(FAKE), SMOKE_KEYS: [...CORE_KEYS, ...MODULE_KEYS].join(',') },
      url: `http://127.0.0.1:${FAKE}/ping`,
      reuseExistingServer: false,
    },
    {
      command: `node tests/smoke/prepare.mjs && sh tests/smoke/seed-r2.sh && npx wrangler dev ${CFG} --persist-to ${STATE} --port ${WORKER}`
        + ` --var SUPABASE_URL:http://127.0.0.1:${FAKE} --var SUPABASE_SERVICE_ROLE_KEY:smoke-service-key`
        + ` --var SESSION_SECRET:${secret} --var OWNER_EMAIL:owner@example.test`
        + ` --var BUILD_VERSION:smoke-build`
        + ` --var PAPERCLIP_URL:https://paperclip.example.test --var PAPERCLIP_TOKEN:smoke-paperclip-token`,
      url: `http://localhost:${WORKER}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
