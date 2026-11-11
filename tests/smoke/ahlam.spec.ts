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
  test('Arabic: «حملة جديدة» opens the wishes form; with no model connected the plan says so in plain words', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto('/today/?tab=campaign');
    await expect(page.locator('#paneCamp')).toBeVisible();
    await page.locator('#cmNew').click();
    await page.locator('#cmGoal').fill('نبي حملة لتقويم القدم للأطفال');
    await page.locator('#cmGo').click();
    await expect(page.locator('#cmMsg')).toContainText('غير متصل');
  });
  test('English: the campaign tab and form, nothing left in Arabic', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto('/today/?tab=campaign&lang=en');
    await expect(page.locator('#tdTabs button[data-k="campaign"]')).toHaveText('New campaign');
    await page.locator('#cmNew').click();
    await expect(page.locator('#cmGo')).toHaveText('Build the plan');
    await expect(page.locator('#cmForm')).not.toContainText(/[\u0600-\u06FF]/);
  });
  // The pack screen with the API mocked at the browser (the smoke Worker has no model): the page itself is the real one.
  const PACK = { campaign: { id: 'c1', title: 'Spring', status: 'review', estimate_usd: 0.05, brief: { summary: 'Brief', messages: ['m'], risks: [] }, approved_by: 'a@x.co' },
    tasks: [{ id: 1, position: 0, agent: 'content', title: 'Copy', status: 'review', depends_on: [], spec: { detail: 'd', retries: 0 }, estimate_usd: 0.01 },
      { id: 2, position: 1, agent: 'social', title: 'Posts', status: 'blocked', depends_on: [1], blocked_reason: 'blocked reason', spec: { retries: 0 }, estimate_usd: 0.01 },
      { id: 3, position: 2, agent: 'optimize', title: 'Plan', status: 'review', depends_on: [1], spec: {}, estimate_usd: 0.01 }],
    outputs: [{ id: 1, task_id: 1, kind: 'copy', body: { text: 'Safe copy' }, compliance: [] }, { id: 2, task_id: 3, kind: 'measurement', body: { kpis: [{ key: 'cpl', ar: 'x', target: 60, unit: 'SAR' }] }, compliance: [] }],
    agents: {}, mayApprove: true, capped: false };
  for (const lang of ['ar', 'en'] as const) {
    test(`${lang}: the campaign pack shows each agent's output, approve and rewrite buttons, and download and copy`, async ({ page, context, request }) => {
      await addSession(context, await login(request, 'owner'));
      await page.route('**/api/campaigns/list', r => r.fulfill({ json: { campaigns: [{ id: 'c1', title: 'Spring', status: 'review', estimate_usd: 0.05, created_at: '2026-11-01T00:00:00Z' }], mayApprove: true } }));
      await page.route('**/api/campaigns/get**', r => r.fulfill({ json: PACK }));
      await page.goto('/today/?tab=campaign' + (lang === 'en' ? '&lang=en' : ''));
      await page.locator('.cm-list button').first().click();
      await expect(page.locator('.cm-tasks > li')).toHaveCount(3);
      await expect(page.locator('[data-ok]')).toHaveCount(2);
      await expect(page.locator('[data-retry]')).toHaveCount(1);
      await expect(page.locator('#cmDl')).toBeVisible();
      await expect(page.locator('#cmCp')).toBeVisible();
      await expect(page.locator('.cm-tasks')).toContainText('Safe copy');
      await expect(page.locator('.cm-kpis')).toContainText('60');
      if (lang === 'en') {
        await expect(page.locator('#cmDl')).toHaveText('Download the pack (Markdown)');
        await expect(page.locator('[data-retry]')).toHaveText('Rewrite and check again');
        await expect(page.locator('.cm-cost')).not.toContainText(/[\u0600-\u06FF]/);
      } else await expect(page.locator('[data-retry]')).toContainText('أعد الكتابة');
    });
  }
  test('a link ?tab=campaign&c=<id> opens that campaign\'s pack directly', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.route('**/api/campaigns/get**', r => r.fulfill({ json: PACK }));
    await page.goto('/today/?tab=campaign&c=44444444-4444-4444-4444-444444444444');
    await expect(page.locator('#cmPack')).toContainText('Safe copy');
  });
});
