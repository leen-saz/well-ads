// Account health and groups on the connectors page (docs/PRD.md §3.4, milestone M5). The state machine and the checks are unit-tested
// (tests/unit/account-health.test.ts); here the page: a health line on the card, «افحص الحين», the empty groups state, creating a group.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const H = {
  accounts: [{ platform: 'meta', status: 'disconnected', probed: true, last_check_at: '2026-11-20T10:07:00Z', error_code: 'meta_401_190', expires_at: null }],
  groups: [], can: { approve: true },
};

test('health line on the card, empty groups, create a group with the right body', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.route('**/api/connectors/health', r => r.fulfill({ json: H }));
  const posts: unknown[] = [];
  await page.route('**/api/connectors/groups', r => { posts.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true, id: 1 } }); });
  await page.goto('/connectors/');
  await expect(page.locator('#cxHealth')).toContainText('صحة الحسابات');
  await expect(page.locator('#hSum')).toContainText('1 يحتاج انتباه');
  await expect(page.locator('#cx_meta [data-health=disconnected]')).toContainText('وقف الربط');
  await expect(page.locator('[data-gempty]')).toBeVisible();
  await page.locator('[data-gnew]').click();
  await page.locator('#gName').fill('القبالة');
  // only connected accounts are offered; none in the fake data, so the form says so and the server refuses an empty group
  await page.locator('[data-gform] button[type=submit]').click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ id: null, name: 'القبالة', members: [] });
});

test('«افحص الحين» calls the recheck once and says how many were checked', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.route('**/api/connectors/health', r => r.fulfill({ json: H }));
  let n = 0;
  await page.route('**/api/connectors/recheck', r => { n++; return r.fulfill({ json: { ok: true, checked: 3 } }); });
  await page.goto('/connectors/');
  await page.locator('#hNow').click();
  await expect(page.locator('.toast')).toContainText('انفحص 3 حساب');
  expect(n).toBe(1);
});

test('the real API answers for the owner (fake database): no accounts yet, no error', async ({ request }) => {
  const o = await login(request, 'owner');
  const r = await request.get('/api/connectors/health', { headers: { cookie: o.header } });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.accounts).toEqual([]);
  expect(j.can.approve).toBe(true);
});

// M12a: the write-access line, read from what each account is already allowed to do
test('write access on the card: «يكتب», or «ناقصه» with the missing permission by name, in Arabic and English', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.route('**/api/connectors/health', r => r.fulfill({ json: { ...H, accounts: [], access: [
    { platform: 'meta', state: 'read_only', missing: ['ads_management'], code: null, checked_at: '2026-11-21T01:07:00Z' },
    { platform: 'meta_pages', state: 'write', missing: [], code: null, checked_at: '2026-11-21T01:07:00Z' },
  ] } }));
  await page.goto('/connectors/');
  await expect(page.locator('#cx_meta [data-access=read_only]')).toContainText('ناقصه:');
  await expect(page.locator('#cx_meta [data-access=read_only]')).toContainText('إدارة الإعلانات');
  await expect(page.locator('#cx_meta_pages [data-access=write]')).toContainText('يكتب');
  await page.goto('/connectors/?lang=en');
  await expect(page.locator('#cx_meta [data-access=read_only]')).toContainText('Missing:');
  await expect(page.locator('#cx_meta [data-access=read_only]')).toContainText('Ad management');
  await expect(page.locator('#cx_meta_pages [data-access=write]')).toContainText('Can write');
});
