// «احلم»: the home page (/today/). Arabic and English, the chat is there, the old daily summary is one tab away, and a question
// with no model connected gets a plain Arabic sentence (the smoke Worker has no OpenRouter key). Synthetic data only.
import { expect, test } from '@playwright/test';
import { addSession, login } from './helpers';

test.describe('احلم', () => {
  test('Arabic: the first sidebar item is احلم, the chat opens, the daily summary is on the second tab', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto('/today/');
    await expect(page).toHaveTitle(/احلم/);
    await expect(page.locator('a.navi[href="/today/"]').first()).toContainText('احلم');
    await expect(page.locator('#ahForm')).toBeVisible();
    await expect(page.locator('#paneSum')).toBeHidden();
    await page.locator('#tdTabs button[data-k="summary"]').click();
    await expect(page.locator('#paneSum')).toBeVisible();
    await expect(page.locator('#paneAhlam')).toBeHidden();
    await expect(page.locator('#paneSum')).toContainText('ملخص الأداء');
  });
  test('English: same page, left to right, nothing left in Arabic', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto('/today/?lang=en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('a.navi[href="/today/"]').first()).toContainText('Ahlam');
    await expect(page.locator('#ahQ')).toHaveAttribute('placeholder', 'Type your question…');
    await expect(page.locator('#tdTabs button[data-k="summary"]')).toHaveText('Today summary');
  });
  test('a question with no model connected gets a plain sentence, not a code', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto('/today/');
    await page.locator('#ahQ').fill('وش وضع الأسبوع؟');
    await page.locator('#ahSend').click();
    await expect(page.locator('.ah-m.bot').last()).toContainText('غير متصل');
  });
  test('the API: signed out is 401, and a question needs text', async ({ request }) => {
    expect((await request.post('/api/today/ask', { data: { q: 'x' }, headers: { origin: `http://localhost:${process.env['SMOKE_PORT'] || 8787}` } })).status()).toBe(401);
    const c = await login(request, 'owner');
    const r = await request.post('/api/today/ask', { data: { q: '' }, headers: { cookie: c.header, origin: `http://localhost:${process.env['SMOKE_PORT'] || 8787}` } });
    expect(r.status()).toBe(400);
  });
});
