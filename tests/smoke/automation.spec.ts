// «تلقائي» page (docs/PRD.md §3.6, M13): off by default, every campaign in scope, the owner switches an agent (one button), sets a
// lower cap, and excludes a campaign.
// The rules themselves are unit-tested (tests/unit/automation.test.ts); here the page and the bodies it sends.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const D = (over: Record<string, unknown> = {}) => ({ auto: { on: { buyer: false }, spendCap: 2500 }, agents: ['buyer'], limits: { maxPct: 20, spendCapMax: 2500 },
  excluded: [], missing: false, kill: false, live: { meta: false, snapchat: false }, keys: { meta: true, snapchat: false }, owner: true, ...over });

test('off by default; switching on, saving a cap and excluding a campaign send the right bodies', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  const sent: { path: string; method: string; body: unknown }[] = [];
  await page.route('**/api/automation/settings', r => r.request().method() === 'GET' ? r.fulfill({ json: D() }) : (sent.push({ path: 'settings', method: 'POST', body: r.request().postDataJSON() }), r.fulfill({ json: { ok: true } })));
  await page.route('**/api/automation/excluded', r => (sent.push({ path: 'excluded', method: r.request().method(), body: r.request().postDataJSON() }), r.fulfill({ json: { ok: true } })));
  await page.goto('/automation/');
  await expect(page.locator('[data-agent=buyer] [data-state=approve]')).toContainText('بموافقتي');
  await expect(page.locator('[data-empty]')).toContainText('يشتغل على كل الحملات');
  await page.locator('[data-agent=buyer] button').click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ path: 'settings', method: 'POST', body: { agent: 'buyer', on: true } });
  // the page reloads its settings after a change: wait for it before typing
  await expect(page.getByText('صار «تلقائي»')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByLabel('السقف').fill('1800');
  await page.getByRole('button', { name: 'احفظ' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]!.body).toEqual({ spendCap: 1800 });
  await page.getByLabel('رقم الحملة').fill('120200000000001');
  await page.getByRole('button', { name: 'استثنِ' }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]).toEqual({ path: 'excluded', method: 'POST', body: { platform: 'meta', entity_id: '120200000000001', name: '' } });
});

test('the emergency stop is said; English has no Arabic left', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.route('**/api/automation/settings', r => r.fulfill({ json: D({ kill: true, auto: { on: { buyer: true }, spendCap: 2000 }, excluded: [{ platform: 'meta', entity_id: '1', name: 'Ramadan' }] }) }));
  await page.goto('/automation/?lang=en');
  await expect(page.locator('[data-kill]')).toContainText('emergency stop');
  await expect(page.locator('[data-agent=buyer] [data-state=auto]')).toContainText('Auto');
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/[؀-ۿ]/);
});

test('the real API: the owner reads it, off by default (fake database)', async ({ request }) => {
  const o = await login(request, 'owner');
  const r = await request.get('/api/automation/settings', { headers: { cookie: o.header } });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.auto.on.buyer).toBe(false);
  expect(j.auto.spendCap).toBe(2500);
});
