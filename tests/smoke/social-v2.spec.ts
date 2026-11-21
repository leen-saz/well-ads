// Publishing v2 on the Social tab (docs/PRD.md §3.2, milestone M6). Validation, slots and moving are unit-tested
// (tests/unit/social-v2.test.ts); here the page sends the right request for each and shows what came back.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const PLATS = { facebook: { name: 'فيسبوك', max: 63206, live: true }, x: { name: 'X', max: 280, live: true } };
const at = new Date(Date.now() + 2 * 864e5);
const POST = { id: 9, platforms: ['facebook'], body: 'منشور', media: [], publish_at: at.toISOString(), status: 'scheduled', approved_at: '2026-11-20T08:00:00Z', approved_by: 'owner@example.test', results: {}, overrides: { facebook: { body: 'نص فيسبوك' } } };

async function open(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext, request: import('@playwright/test').APIRequestContext, posts: unknown[] = []) {
  await addSession(context, await login(request, 'owner'));
  await page.route('**/api/social/posts?*', r => r.fulfill({ json: { posts, platforms: PLATS, ready: {}, account: null } }));
  await page.route('**/api/social/slots', r => r.request().method() === 'GET' ? r.fulfill({ json: { slots: [{ id: 1, weekday: 0, at_local: '20:00' }] } }) : r.fallback());
  await page.goto('/social/');
  await expect(page.locator('#plats input[value=x]')).toBeAttached();
}

test('text per platform and «أضف للطابور» send overrides and queue, without a time', async ({ page, context, request }) => {
  await open(page, context, request);
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/social/posts', r => { if (r.request().method() === 'POST') { sent.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true, post: { publish_at: at.toISOString() }, notices: [] } }); } return r.fallback(); });
  await page.locator('#plats label:has(input[value=facebook])').click();
  await page.locator('#plats label:has(input[value=x])').click();
  await page.locator('#body').fill('نص مشترك');
  await page.locator('#ovr summary').click();
  await expect(page.locator('#ovrList textarea')).toHaveCount(2);
  await page.locator('#ovr_x').fill('نص قصير لإكس');
  await expect(page.locator('[data-ovr-cnt=x]')).toHaveText(/\/ 280/);
  await page.locator('#queueBtn').click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ platforms: ['facebook', 'x'], body: 'نص مشترك', overrides: { x: { body: 'نص قصير لإكس' } }, queue: true, publish_at: '' });
  await expect(page.locator('#msg')).toContainText('انضاف للطابور');
});

test('queue slots: listed, added with the right body', async ({ page, context, request }) => {
  await open(page, context, request);
  await expect(page.locator('#slotList')).toContainText('الأحد');
  const added: unknown[] = [];
  await page.route('**/api/social/slots', r => { if (r.request().method() === 'POST') { added.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); } return r.fallback(); });
  await page.locator('#slotDay').selectOption('4');
  await page.locator('#slotTime').fill('21:30');
  await page.locator('#slotAdd button[type=submit]').click();
  await expect.poll(() => added.length).toBe(1);
  expect(added[0]).toEqual({ weekday: 4, at_local: '21:30' });
});

test('two-week grid; «انقل» on an approved post warns, then sends move with the new time', async ({ page, context, request }) => {
  await open(page, context, request, [POST]);
  await page.locator('.so-view [data-view=grid]').click();
  await expect(page.locator('.so-cell')).toHaveCount(14);
  await expect(page.locator('.so-mini[data-id="9"]')).toHaveAttribute('draggable', 'true');
  const moves: unknown[] = [];
  await page.route('**/api/social/posts', r => { if (r.request().method() === 'PATCH') { moves.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true, approvalCleared: true } }); } return r.fallback(); });
  page.on('dialog', d => d.accept());
  await page.locator('.so-mini[data-id="9"] [data-move]').click();
  await page.locator('#mv_9').fill('2026-12-01T19:15');
  await page.locator('.so-mv button[type=submit]').click();
  await expect.poll(() => moves.length).toBe(1);
  expect(moves[0]).toEqual({ id: 9, action: 'move', publish_at: '2026-12-01T16:15:00.000Z' });
  await expect(page.locator('#msg')).toContainText('ينتظر الاعتماد من جديد');
});

test('the per-platform text shows on the post card', async ({ page, context, request }) => {
  await open(page, context, request, [POST]);
  await page.locator('.so-view [data-view=list]').click();
  await expect(page.locator('.so-post[data-id="9"] details.so-more')).toContainText('فيسبوك');
});
