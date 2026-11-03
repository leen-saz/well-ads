// Phase 4.1: number parity between the pipeline dashboard and its Astro replacement (docs/phase-4.md).
// CI uses Playwright's Chromium; locally an installed Chrome is enough (PW_CHANNEL=chrome).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/parity',
  timeout: 60_000,
  fullyParallel: true,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    viewport: { width: 1440, height: 900 },
    locale: 'ar',
    timezoneId: 'Asia/Riyadh',
    ...(process.env['PW_CHANNEL'] ? { channel: process.env['PW_CHANNEL'] } : {}),
  },
});
