// The decisions board's keyboard shortcuts and the emergency-stop read, in a real browser. Synthetic suggestions.
// 1) «a» twice approves a suggestion on the inbox tabs only: on the learning tab (inbox hidden) nothing is sent.
// 2) A focused button keeps its own Enter key (no shortcut swallows it).
// 3) With the emergency-stop state unreadable, the board says so, approves nothing and cannot lift the stop.
import { test, expect, type Page } from '@playwright/test';
import { login, addSession } from './helpers';

const sug = (id: number) => ({
  id, platform: 'meta', level: 'ad', kind: 'budget_up', target_id: `9000${id}`, target_name: `Smoke ad ${id}`, campaign: 'Smoke campaign', params: { pct: 10 }, reason: 'smoke',
  evidence: { spend: 100, leads: 5, cpl: 20, target_cpl: 45, ctr: 2, metric: 'leads' }, source: 'rule', status: 'open', created_at: '2026-11-10T08:00:00Z', critic: { ok: true, issues: [] },
});

async function board(page: Page, context: Parameters<typeof addSession>[0], request: Parameters<typeof login>[0], kill: 'ok' | 'down') {
  await addSession(context, await login(request, 'owner'));
  const decided: string[] = [];
  await page.route('**/api/control/suggestions', r => {
    if (r.request().method() === 'POST') { decided.push(r.request().postData() || ''); return r.fulfill({ json: { done: [{ ...sug(1), status: 'approved' }] } }); }
    return r.fulfill({ json: { open: [sug(1), sug(2)], done: [] } });
  });
  await page.route('**/api/control/settings', r => r.fulfill({ json: { settings: [], owner: true } }));
  await page.route('**/api/control/learning', r => r.fulfill({ json: { lessons: [], activity: [], outcomes: [], ready: true } }));
  await page.route('**/control/ads.json', r => r.fulfill({ json: { ads: {}, generated_at: '2026-11-10T08:00:00Z' } }));
  await page.route('**/api/control/kill', r => (kill === 'down' ? r.fulfill({ status: 503, json: { error: 'x' } }) : r.fulfill({ json: { kill: false } })));
  await page.goto('/control/?lang=ar');
  await expect(page.locator('#inbox tbody tr')).toHaveCount(2);
  return decided;
}
const pressA = async (page: Page) => { await page.keyboard.press('a'); await page.keyboard.press('a'); await page.waitForTimeout(300); };

test('«a» twice approves on the inbox, but never on a tab whose inbox is hidden', async ({ page, context, request }) => {
  const decided = await board(page, context, request, 'ok');
  await page.locator('[data-t="learn"]').click();
  await expect(page.locator('#inbox')).toBeVisible();
  await pressA(page);
  expect(decided, 'a hidden suggestion was approved from the learning tab').toEqual([]);
  await page.locator('[data-t="all"]').click();
  await expect(page.locator('#inbox tbody tr')).toHaveCount(2);
  await page.locator('#inbox tbody tr').first().hover();
  await pressA(page);
  expect(decided.length, 'the shortcut still works on the inbox').toBe(1);
});

test('Enter on a focused button is not swallowed by a shortcut', async ({ page, context, request }) => {
  await board(page, context, request, 'ok');
  await page.locator('#killBtn').focus();
  const prevented = await page.evaluate(() => new Promise<boolean>(res => {
    const el = document.activeElement as HTMLElement;
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    el.dispatchEvent(ev); res(ev.defaultPrevented);
  }));
  expect(prevented).toBe(false);
});

test('with the stop state unreadable the board says so and approves nothing', async ({ page, context, request }) => {
  const decided = await board(page, context, request, 'down');
  await expect(page.locator('#killBanner')).toBeVisible();
  await expect(page.locator('#killBanner')).toContainText('ما قدرنا نقرأ حالة إيقاف الطوارئ');
  await expect(page.locator('#killBtn')).toBeDisabled();
  await page.locator('#inbox tbody tr').first().hover();
  await pressA(page);
  expect(decided, 'approved while the stop state was unknown').toEqual([]);
});
