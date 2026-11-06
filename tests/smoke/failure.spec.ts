// When a tab's first API call fails the page shows one error state with a retry button (public/assets/common.js:
// failure/pageFailure), never a blank block or a stuck "loading". Retry recovers once the API answers again.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

// page, the API its first load calls, and what counts as the load having worked
const TABS = [
  { page: '/compliance/', api: '**/api/compliance/scan*' },
  { page: '/debugger/', api: '**/api/debugger/report*' },
  { page: '/knowledge/', api: '**/api/knowledge/list*', open: '[data-tab="all"]' },
  { page: '/knowledge/', api: '**/api/knowledge/train*' },
  { page: '/listening/', api: '**/api/listening/demand*', open: '[role="tab"]:has-text("تفاعل منشوراتنا")' },
  { page: '/content/', api: '**/api/content/plans*' },
  { page: '/copy/', api: '**/api/copy/projects*' },
  { page: '/journeys/', api: '**/api/journeys/list*' },
  { page: '/social/', api: '**/api/social/posts*' },
  { page: '/maestro/', api: '**/api/maestro/state*' },
  { page: '/today/', api: '**/api/today/state*' },
];
const MODES: { name: string; fail: (r: import('@playwright/test').Route) => Promise<void>; text: RegExp }[] = [
  { name: 'server error with a message', fail: r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'خطأ تجريبي من الخادم' }) }), text: /خطأ تجريبي من الخادم/ },
  { name: 'gateway page instead of JSON', fail: r => r.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }), text: /الخدمة مو متاحة/ },
  { name: 'connection dropped', fail: r => r.abort('connectionfailed'), text: /ما قدرت أوصل للخادم/ },
];

for (const t of TABS) {
  for (const m of MODES) {
    test(`${t.page} (${t.api.replace(/\*+/g, '')}): ${m.name} → error state with retry, retry recovers`, async ({ page, context, request }) => {
      await addSession(context, await login(request, 'owner'));
      let failing = true;
      await page.route(t.api, r => (failing ? m.fail(r) : r.continue()));
      await page.goto(t.page);
      if (t.open) await page.locator(t.open).click();
      const alert = page.locator('[role="alert"]', { has: page.locator('[data-retry]') }).first();
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(m.text);
      failing = false;
      await alert.locator('[data-retry]').click();
      await expect(page.locator('[data-retry]')).toHaveCount(0);
    });
  }
}

test('the page itself cannot start (the sidebar call fails): a banner with reload, not a blank page', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  let failing = true;
  await page.route('**/api/account/password*', r => (failing ? r.abort('connectionfailed') : r.continue()));
  await page.goto('/knowledge/');
  const banner = page.locator('.page-failure [role="alert"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('ما قدرت أوصل للخادم');
  failing = false;
  await banner.locator('[data-retry]').click();
  await expect(page.locator('a.navi[data-k="knowledge"]')).toBeVisible();
});

test('a request that never answers ends with an error, not an endless spinner', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.addInitScript(() => { const f = AbortSignal.timeout.bind(AbortSignal); AbortSignal.timeout = ms => f(Math.min(ms, 1500)); });
  // Answered only after the page gave up (route handlers that never settle can hang the test teardown)
  await page.route('**/api/compliance/scan*', async r => { await new Promise(res => setTimeout(res, 6000)); await r.abort().catch(() => {}); });
  await page.goto('/compliance/');
  await expect(page.locator('[role="alert"]', { hasText: 'أخذ وقت طويل' })).toBeVisible({ timeout: 10_000 });
});
