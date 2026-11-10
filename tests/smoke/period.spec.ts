// The one period bar (public/assets/period.js) on the three pages that had the old 7/30/90 buttons: «ملخص الأداء» (Overview),
// «الرصد» (listening, both tabs) and «المدير» (the agent card). Arabic and English, built Worker, synthetic data only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { login, addSession } from './helpers';

const fixture = readFileSync(join(import.meta.dirname, '../parity/fixtures/ads.json'), 'utf8');
const AR = ['اليوم', 'أمس', 'أسبوع', 'شهر', 'هذا الشهر', 'كل الفترة', 'اختيار تاريخ'];
const EN = ['Today', 'Yesterday', 'Week', 'Month', 'This month', 'All time', 'Custom dates'];
const OLD = /(^|\s)(7|30|90) (أيام|يوم|days)(\s|$)/;
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const riyadh = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
const TODAY = riyadh();
const ago = (n: number) => riyadh(new Date(Date.now() - n * 864e5));

// Synthetic listening data: a brand and a competitor, mentions spread over the last 100 days
async function listeningWorld(page: Page, seen: string[]) {
  await page.route('**/api/listening/watch*', r => r.fulfill(json({ missing: false, owner: true, sources: { news: true }, watches: [
    { id: 1, kind: 'brand', name: 'علامة تجريبية', keywords: ['تجربة'], links: {} }, { id: 2, kind: 'competitor', name: 'منافس تجريبي', keywords: ['منافس'], links: {} }] })));
  await page.route('**/api/listening/mentions*', r => {
    seen.push(new URL(r.request().url()).search);
    const q = new URL(r.request().url()).searchParams;
    const from = q.get('from') ?? ago(90), to = q.get('to') ?? TODAY;
    const mentions = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, watch_id: i % 3 ? 1 : 2, source: 'news', url: `https://news.example.test/${i}`, title: `خبر تجريبي ${i}`, snippet: '', author: '',
      published_at: new Date(Date.now() - i * 864e5).toISOString(), sentiment: ['positive', 'neutral', 'negative'][i % 3], reason: '', fetched_at: new Date().toISOString() }))
      .filter(m => riyadh(new Date(m.published_at)) >= from && riyadh(new Date(m.published_at)) <= to);
    return r.fulfill(json({ missing: false, mentions }));
  });
  await page.route('**/api/listening/demand*', r => r.fulfill(json({ sources: [{ source: 'meta_form', now: 12, prev: 8 }] })));
}

async function bar(page: Page, lang: 'ar' | 'en', scope = '.pf') {
  const labels = lang === 'en' ? EN : AR;
  const root = page.locator(scope).first();
  await expect(root.locator('button')).toHaveCount(7);
  await expect(root.locator('button')).toHaveText(labels, { useInnerText: true });
  return root;
}
const pressed = (root: ReturnType<Page['locator']>) => root.locator('button[aria-pressed="true"]');

for (const lang of ['ar', 'en'] as const) {
  const q = lang === 'en' ? '?lang=en' : '?lang=ar';
  const labels = lang === 'en' ? EN : AR;

  test.describe(`period filter, ${lang}`, () => {
    test.beforeEach(async ({ page, request }) => { await addSession(page.context(), await login(request, 'owner')); });

    test('الرصد: the bar, every quick period, custom dates, and the server gets the days', async ({ page }) => {
      const seen: string[] = [];
      await listeningWorld(page, seen);
      await page.goto(`/listening/${q}`);
      const root = await bar(page, lang, '#lxPeriod .pf');
      await expect(pressed(root)).toHaveText(labels[3]!);                                   // month is the default
      await expect(page.locator('#ments .lx-m').first()).toBeVisible();
      expect(seen.at(-1)).toBe(`?from=${ago(29)}&to=${TODAY}`);
      // Each quick period: the button is pressed, the address names it, and the list is asked for those Riyadh days
      const want: Record<string, [string, string]> = { t: [TODAY, TODAY], y: [ago(1), ago(1)], '7': [ago(6), TODAY], tm: [`${TODAY.slice(0, 8)}01`, TODAY] };
      for (const [i, k] of ['t', 'y', '7', '30', 'tm', 'all'].entries()) {
        await root.locator('button').nth(i).click();
        await expect(pressed(root)).toHaveText(labels[i]!);
        await expect(page).toHaveURL(new RegExp(`range=${k}(&|$)`));
        if (want[k]) await expect.poll(() => seen.at(-1)).toBe(`?from=${want[k]![0]}&to=${want[k]![1]}`);
      }
      // Today: at most one day of mentions is listed
      await root.locator('button').nth(0).click();
      await expect(page.locator('#ments .lx-m')).toHaveCount(1);
      // Custom dates: two clicks on the calendar, then Apply
      await root.locator('.pf-custom').click();
      const pop = page.locator('#lxPeriod .pf-pop');
      await expect(pop).toBeVisible();
      const days = pop.locator('.pf-grid button:not(:disabled)');
      await days.nth(0).click(); await days.nth(2).click();
      await expect(pop.locator('.pf-sel')).toContainText(lang === 'en' ? 'days' : 'أيام');
      await pop.locator('.pf-apply').click();
      await expect(pop).toBeHidden();
      await expect(pressed(root)).toHaveCount(1);
      await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
      await expect(page).not.toHaveURL(/range=/);
      // It survives a reload (address) and a plain visit (saved in the browser)
      const url = page.url();
      await page.reload();
      await expect(page).toHaveURL(url);
      await expect(pressed(page.locator('#lxPeriod .pf'))).toHaveClass(/pf-custom/);
      await page.goto(`/listening/${q}`);
      await expect(pressed(page.locator('#lxPeriod .pf'))).toHaveClass(/pf-custom/);
      // The old buttons are gone
      expect((await page.locator('#paneListen').innerText()).split('\n').some(l => OLD.test(l))).toBe(false);
    });

    test('الرصد: the organic tab has the same bar, and a bad address value falls back to the default', async ({ page }) => {
      await listeningWorld(page, []);
      const demand: string[] = [];
      await page.route('**/api/listening/demand*', r => { demand.push(new URL(r.request().url()).search); return r.fulfill(json({ sources: [{ source: 'meta_form', now: 3, prev: 2 }] })); });
      await page.goto(`/listening/${q}&tab=organic&range=forever&from=x`);
      const root = await bar(page, lang, '#orgPeriod .pf');
      await expect(pressed(root)).toHaveText(labels[5]!);                                   // all time is this tab's default
      await expect.poll(() => demand.at(-1)).toMatch(/^\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
      await root.locator('button').nth(2).click();
      await expect.poll(() => demand.at(-1)).toBe(`?from=${ago(6)}&to=${TODAY}`);
      expect((await page.locator('#paneOrganic').innerText()).split('\n').some(l => OLD.test(l))).toBe(false);
    });

    test('ملخص الأداء: the bar drives every section, and keeps the choice', async ({ page }) => {
      await page.route('**/api/overview/data*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fixture }));
      await page.goto(`/overview/${q}`);
      const root = await bar(page, lang, '.pf');
      await expect(pressed(root)).toHaveText(labels[3]!);
      const label = page.locator('p.text-muted-foreground').first();
      await expect(label).toContainText(lang === 'en' ? 'September 22' : '22 سبتمبر');             // 30 days to the fixture's last full day, 21 Oct
      const before = await label.innerText();
      await root.locator('button').nth(5).click();                                           // all time
      await expect(label).toContainText(lang === 'en' ? 'August 23' : '23 أغسطس');             // the first day of the fixture
      await expect(page).toHaveURL(/range=all/);
      await root.locator('button').nth(0).click();                                           // today (22 Oct in the data)
      await expect(label).toContainText(lang === 'en' ? 'October 22 to October 22' : '22 أكتوبر إلى 22 أكتوبر');
      await root.locator('button').nth(4).click();                                           // this month
      await expect(label).toContainText(lang === 'en' ? 'October 1 to October 22' : '1 أكتوبر إلى 22 أكتوبر');
      expect(await label.innerText()).not.toBe(before);
      await page.reload();
      await expect(pressed(page.locator('.pf'))).toHaveText(labels[4]!);
      await expect(page.locator('main')).not.toContainText(/7 أيام|30 يوم|90 يوم|7 days|90 days/);
    });

    test('المواد الإعلانية: the same bar, and every idea follows it', async ({ page }) => {
      await page.route('**/api/overview/data*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fixture }));
      await page.goto(`/overview/creative/${q}`);
      const root = await bar(page, lang, '.pf');
      await expect(pressed(root)).toHaveText(labels[3]!);
      const label = page.locator('p.text-muted-foreground').first();
      await expect(label).toContainText(lang === 'en' ? 'September 22 to October 21' : '22 سبتمبر');
      await root.locator('button').nth(5).click();
      await expect(label).toContainText(lang === 'en' ? 'August 23' : '23 أغسطس');
      await expect(page).toHaveURL(/range=all/);
      await page.reload();
      await expect(pressed(page.locator('.pf'))).toHaveText(labels[5]!);
      await expect(page.locator('main')).not.toContainText(/7 أيام|30 يوم|90 يوم|7 days|90 days|كل البيانات|All data/);
    });

    test('الإعدادات: the activity log uses the bar and asks for those days', async ({ page }) => {
      const asked: string[] = [];
      await page.route('**/api/admin/log*', r => { asked.push(new URL(r.request().url()).search); return r.fulfill(json({ log: [] })); });
      await page.goto(`/admin/${q}`);
      const root = await bar(page, lang, '#logPeriod .pf');
      await expect(pressed(root)).toHaveText(labels[5]!);                                    // all time = the latest 200, no dates
      await expect.poll(() => asked.at(-1)).toBe('?limit=200');
      await root.locator('button').nth(2).click();
      await expect.poll(() => asked.at(-1)).toBe(`?limit=500&from=${ago(6)}&to=${TODAY}`);
    });

    test('المدير: the agent card uses the same bar', async ({ page }) => {
      const asked: string[] = [];
      await page.route('**/api/maestro/state*', r => r.fulfill(json({ connected: true, owner: true, canApprove: true, canEdit: true, statuses: { todo: 'جديدة', done: 'خلصت' }, budget: { cap: 0, spent: 0, pct: null }, tabs: [], projectTabs: {},
        agents: [{ id: 'a1', name: 'إيجنت تجريبي', role: 'general', status: 'idle' }], issues: [], approvals: [] })));
      await page.route('**/api/maestro/agent*', r => { asked.push(new URL(r.request().url()).search); return r.fulfill(json({ days: 30, done: 4, spentCents: 120, runs: 5, successRate: 80, avgTaskMinutes: 12, lastRunAt: null, lastError: null })); });
      await page.goto(`/maestro/${q}`);
      await page.locator('[data-view="agents"]').click();
      await page.locator('[data-perf]').first().click();
      const root = await bar(page, lang, '#perfPeriod .pf');
      await expect(pressed(root)).toHaveText(labels[3]!);
      await expect(page.locator('#perfBody .mx-kpi')).toHaveCount(4);
      expect(asked.at(-1)).toBe(`?id=a1&from=${ago(29)}&to=${TODAY}`);
      await root.locator('button').nth(2).click();
      await expect.poll(() => asked.at(-1)).toBe(`?id=a1&from=${ago(6)}&to=${TODAY}`);
      await root.locator('.pf-custom').click();
      await expect(page.locator('#perfPeriod .pf-pop')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#perfPeriod .pf-pop')).toBeHidden();
      expect((await page.locator('#pdlg').innerText()).split('\n').some(l => OLD.test(l))).toBe(false);
    });
  });
}
