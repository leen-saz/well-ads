// End-to-end smoke tests: the built Worker runs locally (wrangler dev) against a fake Supabase with synthetic users.
// Needs `npm run build` first. Run: npm run test:smoke
import { defineConfig } from '@playwright/test';
import { CORE_KEYS, MODULE_KEYS } from './tests/smoke/keys';

const WORKER = 8787, FAKE = 8788;
const CFG = '--config dist/server/wrangler.smoke.json', STATE = '.wrangler/smoke-state';
const secret = 'smoke-session-secret-smoke-session-secret';

export default defineConfig({
  testDir: 'tests/smoke',
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${WORKER}`,
    locale: 'ar',
    timezoneId: 'Asia/Riyadh',
    ...(process.env['PW_CHANNEL'] ? { channel: process.env['PW_CHANNEL'] } : {}),
  },
  webServer: [
    {
      command: 'node tests/smoke/fake-supabase.mjs',
      env: { FAKE_PORT: String(FAKE), SMOKE_KEYS: [...CORE_KEYS, ...MODULE_KEYS].join(',') },
      url: `http://127.0.0.1:${FAKE}/ping`,
      reuseExistingServer: !process.env['CI'],
    },
    {
      command: `node tests/smoke/prepare.mjs && sh tests/smoke/seed-r2.sh && npx wrangler dev ${CFG} --persist-to ${STATE} --port ${WORKER}`
        + ` --var SUPABASE_URL:http://127.0.0.1:${FAKE} --var SUPABASE_SERVICE_ROLE_KEY:smoke-service-key`
        + ` --var SESSION_SECRET:${secret} --var OWNER_EMAIL:owner@example.test`
        + ` --var BUILD_VERSION:smoke-build`
        + ` --var PAPERCLIP_URL:https://paperclip.example.test --var PAPERCLIP_TOKEN:smoke-paperclip-token`,
      url: `http://localhost:${WORKER}/api/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env['CI'],
    },
  ],
});
