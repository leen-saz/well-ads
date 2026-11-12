// Slow pages (UX audit 2026-11-12, finding 4): a page must show something useful while the slow part runs, and independent
// requests must not wait for each other. Answers are held back by the test so the order of events can be checked.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

test('knowledge chat: the answers so far show at once, the AI question follows behind a placeholder', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  const hist = [{ question: 'سؤال قديم؟', answer: 'جواب قديم', active: true }];
  await page.route('**/api/knowledge/train*', async route => {
    const ai = new URL(route.request().url()).searchParams.get('ai');
    if (ai === '0') return route.fulfill({ json: { history: hist, next: null, later: true, covered: 8, total: 8, canEdit: true } });
    await new Promise(r => setTimeout(r, 1500));   // the AI is slow
    return route.fulfill({ json: { history: hist, next: { topic: 'ai-x', q: 'سؤال جديد من المدرّب؟', kind: 'service' }, later: false, covered: 8, total: 8, canEdit: true } });
  });
  await page.goto('/knowledge/');
  await expect(page.locator('#chat')).toContainText('جواب قديم');           // not an empty «loading»
  await expect(page.locator('#chat .sk')).toBeVisible();                     // the next question is on its way
  await expect(page.locator('#chat')).not.toContainText('سؤال جديد من المدرّب؟');
  await expect(page.locator('#chat')).toContainText('سؤال جديد من المدرّب؟');
  await expect(page.locator('#chat .sk')).toHaveCount(0);
  await expect(page.locator('#tf')).toBeVisible();
});

test('knowledge chat: if the AI question fails, the answers stay and the form stays closed', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.route('**/api/knowledge/train*', async route => {
    const ai = new URL(route.request().url()).searchParams.get('ai');
    if (ai === '0') return route.fulfill({ json: { history: [{ question: 'س؟', answer: 'جواب باقي', active: true }], next: null, later: true, covered: 8, total: 8, canEdit: true } });
    return route.fulfill({ status: 502, json: { error: 'x' } });
  });
  await page.goto('/knowledge/');
  await expect(page.locator('#chat')).toContainText('جواب باقي');
  await expect(page.locator('#chat .sk')).toHaveCount(0);
  await expect(page.locator('#tf')).toBeHidden();
});

test('data health: the four database parts are asked for together, not one after another', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  const starts: number[] = [];
  await page.route('**/api/maestro/health?part=*', async route => {
    starts.push(Date.now());
    await new Promise(r => setTimeout(r, 600));
    await route.continue();
  });
  await page.goto('/maestro/health/');
  await expect.poll(() => starts.length, { timeout: 15_000 }).toBe(4);
  // one after another they would start 600 ms apart: here all four start within one request's time
  expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(500);
});

test('the slow pages show a placeholder block while they load', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.route('**/api/maestro/audit', async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue(); });
  await page.goto('/maestro/audit/');
  await expect(page.locator('#sections .sk').first()).toBeVisible();
  await expect(page.locator('#sections .sk')).toHaveCount(0, { timeout: 10_000 });
});
