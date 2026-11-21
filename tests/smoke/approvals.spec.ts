// The approvals center (docs/PRD.md §3.1, milestone M3). The server's filtering is unit-tested (tests/unit/approvals.test.ts);
// here the page: sidebar entry, empty state, tabs with counts, the confirmation before every decision, the item's own route
// being called, ad actions sent to the board, and J/K/A/R.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const LIST = {
  items: [
    { kind: 'social', id: '7', title: 'منشور تجريبي', detail: 'فيسبوك، X', at: '2026-11-21T10:00:00Z', by: 'a@example.test', href: '/social/?post=7', money: false, meta: {} },
    { kind: 'ads', id: 'u1', title: 'تعديل ميزانية: حملة تجربة', detail: 'ميتا · السبب', at: '2026-11-20T08:00:00Z', by: null, href: '/control/?tab=buyer&action=u1', money: true, meta: {} },
    { kind: 'lessons', id: '3', title: 'درس تجريبي', detail: 'لوحة القرارات', at: '2026-11-19T08:00:00Z', by: null, href: '/control/?tab=learn', money: false, meta: { module: 'ads' } },
  ],
  counts: { social: 1, ads: 1, lessons: 1, total: 3 },
  can: { social: true, ads: true, lessons: true },
};

test('owner: sidebar entry and the empty state', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.goto('/approvals/');
  await expect(page.locator('#side a.ap-link[href="/approvals/"]')).toBeVisible();
  await expect(page.locator('[data-empty]')).toContainText('ما فيه شي ينتظرك');
});

test('no approve right anywhere: no sidebar entry', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'nobody'));
  await page.goto('/today/');
  await expect(page.locator('#side .navi').first()).toBeVisible();
  await expect(page.locator('#side a[href="/approvals/"]')).toHaveCount(0);
});

test('items: tabs with counts, confirm before approving, the post route is called', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.route('**/api/approvals/list*', r => r.fulfill({ json: LIST }));
  const calls: { url: string; method: string; body: unknown }[] = [];
  await page.route(/\/api\/(social\/posts|lessons\/list|buyer\/decide)$/, r => { calls.push({ url: r.request().url(), method: r.request().method(), body: r.request().postDataJSON() }); return r.fulfill({ json: { ok: true } }); });
  await page.goto('/approvals/');
  await expect(page.locator('[data-kind]')).toHaveCount(3);
  await expect(page.locator('[role=tab][data-k=all]')).toContainText('3');
  await page.locator('[role=tab][data-k=ads]').click();
  await expect(page.locator('[data-kind]')).toHaveCount(1);
  // an ad action is approved on the board (dry run + second confirmation), not here
  await expect(page.locator('[data-kind=ads] a', { hasText: 'افتح للاعتماد' })).toHaveAttribute('href', '/control/?tab=buyer&action=u1');
  await page.locator('[role=tab][data-k=all]').click();
  await page.locator('[data-kind=social] button', { hasText: 'اعتمد' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  expect(calls).toEqual([]);   // nothing decided before the confirmation
  await page.getByRole('alertdialog').getByRole('button', { name: 'اعتمد' }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]!.method).toBe('PATCH');
  expect(calls[0]!.url).toMatch(/\/api\/social\/posts$/);
  expect(calls[0]!.body).toEqual({ id: 7, action: 'approve' });
});

test('keys: J moves, R opens the reject confirmation for the current item', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.route('**/api/approvals/list*', r => r.fulfill({ json: LIST }));
  const calls: unknown[] = [];
  await page.route(/\/api\/buyer\/decide$/, r => { calls.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
  await page.goto('/approvals/');
  await expect(page.locator('[data-kind]')).toHaveCount(3);
  await page.keyboard.press('j');
  await expect(page.locator('[data-ap-i="1"]')).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('r');
  await expect(page.getByRole('alertdialog')).toContainText('ترفض هذا؟');
  await page.getByRole('alertdialog').getByRole('button', { name: 'ارفض' }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({ id: 'u1', decision: 'reject' });
});
