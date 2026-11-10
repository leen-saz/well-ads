// The Manager's model table, its «connect your company» failure and the Social tab's platform chips and post states,
// in Arabic and English, on a laptop and on a phone. Synthetic data only; the API answers are made up here.
// Set SHOTS=<folder> to also write a screenshot of each screen (used for the PR).
import { test, expect, type Page } from '@playwright/test';
import { login, addSession } from './helpers';
import { TECH_WORDS } from '../shared/tech-words';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const SHOTS = process.env['SHOTS'];
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

const LONG = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const providers = [
  { key: 'openai', ar: 'OpenAI', on: true }, { key: 'xai', ar: 'Grok (xAI)', on: true },
  { key: 'openrouter', ar: 'OpenRouter', on: true }, { key: 'workers', ar: 'المجاني', on: true },
];
const tasks = [
  { task: 'social', ar: 'السوشال', en: 'Social', default: 'xai', route: null, using: 'workers', model: LONG },
  { task: 'listening', ar: 'الرصد', en: 'Listening', default: 'xai', route: { provider: 'openrouter', model: 'openai/gpt-5-mini' }, using: 'openrouter', model: 'openai/gpt-5-mini' },
  { task: 'maestro', ar: 'المدير', en: 'Manager', default: 'xai', route: null, using: 'xai', model: 'grok-4-fast' },
  { task: 'journeys', ar: 'الرحلات', en: 'Journeys', default: 'openai', route: null, using: null, model: '' },
];
const when = (min: number) => new Date(Date.now() + min * 60000).toISOString();
const posts = [
  { id: 'p1', platforms: ['instagram'], body: 'جلسة تجريبية للمتابعين', publish_at: when(-30), status: 'published', approved_at: when(-60), approved_by: 'owner@example.test', results: { instagram: { ok: true, id: '1789' } }, compliance: [] },
  { id: 'p2', platforms: ['facebook', 'instagram'], body: 'منشور تجريبي ثاني', publish_at: when(-20), status: 'partial', approved_at: when(-60), approved_by: 'owner@example.test', results: { facebook: { ok: true, id: '1_2' }, instagram: { ok: false, code: 'no_media' } }, compliance: [] },
  { id: 'p3', platforms: ['facebook'], body: 'ينتظر موافقة', publish_at: when(120), status: 'scheduled', approved_at: null, results: {}, compliance: [] },
  { id: 'p4', platforms: ['facebook'], body: 'معتمد وينتظر', publish_at: when(180), status: 'scheduled', approved_at: when(-5), approved_by: 'owner@example.test', results: {}, compliance: [] },
];
const platforms = { facebook: { name: 'فيسبوك', max: 63206, live: true }, instagram: { name: 'انستقرام', max: 2200, live: true, needsMedia: true }, tiktok: { name: 'تيك توك', max: 2200, live: false }, x: { name: 'X', max: 280, live: false }, linkedin: { name: 'لينكدإن', max: 3000, live: false }, snapchat: { name: 'سناب شات', max: 250, live: false } };
const ready = { facebook: '', instagram: 'حساب انستقرام مو مربوط: اربطه من صفحة الربط قبل الموعد', tiktok: 'غير متاح الحين: بينحفظ كتذكير', x: 'غير متاح الحين: بينحفظ كتذكير', linkedin: 'غير متاح الحين: بينحفظ كتذكير', snapchat: 'النشر التلقائي لهالمنصة قريباً: بينحفظ كتذكير' };

const screens = [{ w: 1280, h: 900, tag: 'desktop' }, { w: 390, h: 844, tag: 'phone' }];

for (const lang of ['ar', 'en'] as const) {
  for (const sc of screens) {
    test.describe(`${lang} ${sc.tag}`, () => {
      test.use({ viewport: { width: sc.w, height: sc.h } });

      test('المدير: model table', async ({ page, context, request }) => {
        await addSession(context, await login(request, 'owner'));
        await page.route('**/api/maestro/models', async r => {
          if (r.request().method() === 'POST') return r.fulfill(json({ ok: true }));
          return r.fulfill(json({ providers, tasks }));
        });
        await page.goto(`/maestro/?lang=${lang}`);
        const rows = page.locator('#modelsBody form');
        await expect(rows).toHaveCount(4);
        // The long id is one line, left-to-right, cut with an ellipsis, the whole id in the tooltip
        const chip = rows.first().locator('code.mr-id');
        await expect(chip).toHaveAttribute('dir', 'ltr');
        await expect(chip).toHaveAttribute('title', LONG);
        expect(await chip.evaluate(e => getComputedStyle(e).whiteSpace)).toBe('nowrap');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        // Save waits for a change; the model box has a real placeholder for OpenRouter
        const first = rows.first(), save = first.locator('button[type=submit]');
        await expect(save).toBeDisabled();
        await first.locator('select').selectOption('openrouter');
        await expect(first.locator('input[name=model]')).toHaveAttribute('placeholder', lang === 'en' ? 'e.g. openai/gpt-5-mini' : 'مثال: openai/gpt-5-mini');
        await expect(save).toBeEnabled();
        await save.click();                                  // OpenRouter needs a model id: said on the row, nothing sent
        await expect(first.locator('.mr-rmsg .msg.err')).toBeVisible();
        await first.locator('input[name=model]').fill('openai/gpt-5-mini');
        await save.click();
        await expect(first.locator('.mr-rmsg .msg.ok')).toBeVisible();
        const text = await page.locator('#models').innerText();
        expect(text).toContain(lang === 'en' ? 'Current' : 'الحالي');
        if (lang === 'en') expect(text.split('\n').filter(l => /[؀-ۿ]/.test(l))).toEqual([]);
        await shot(page, `maestro-models-${lang}-${sc.tag}`);
      });

      test('المدير: connect failure is an explained state', async ({ page, context, request }) => {
        await addSession(context, await login(request, 'owner'));
        await page.route('**/api/maestro/state*', r => r.fulfill(json({ connected: false, owner: true })));
        await page.route('**/api/maestro/models', r => r.fulfill(json({ providers, tasks })));
        await page.route('**/api/maestro/connect', r => r.fulfill(json({ error: 'ما قدرنا نجهز مساحة شركتك، جرّب بعد شوي' }, 502)));
        await page.goto(`/maestro/?lang=${lang}`);
        await page.locator('#connect').click();
        const box = page.locator('.mr-err');
        await expect(box).toBeVisible();
        await expect(box.locator('svg')).toBeVisible();
        const retry = page.locator('#cretry');
        await expect(retry).toBeDisabled();                  // a short wait before trying again
        expect(TECH_WORDS.test(await box.innerText())).toBe(false);
        await shot(page, `maestro-connect-error-${lang}-${sc.tag}`);
      });

      test('السوشال: platform chips and post states', async ({ page, context, request }) => {
        await addSession(context, await login(request, 'owner'));
        await page.route('**/api/social/posts*', r => r.fulfill(json({ posts, platforms, ready, account: { page: 'صفحة تجريبية', instagram: null, pick: false } })));
        await page.route('**/api/social/approvers*', r => r.fulfill(json({ approvers: [], canApprove: true, owner: true, people: [] })));
        await page.goto(`/social/?lang=${lang}`);
        const chips = page.locator('#plats .so-pl');
        await expect(chips).toHaveCount(6);
        await expect(chips.first().locator('.so-bd')).toHaveText(lang === 'en' ? 'Ready' : 'جاهز');
        await chips.nth(1).click();                          // a platform that needs connecting says why
        await expect(page.locator('#platWhy')).toBeVisible();
        await expect(page.locator('#platWhy')).toContainText(lang === 'en' ? 'Connect the account' : 'يحتاج ربط الحساب');
        await expect(page.locator('.so-state')).toHaveCount(4);
        await expect(page.locator('.so-state.wait')).toContainText(lang === 'en' ? 'Awaiting approval' : 'ينتظر الاعتماد');
        await expect(page.locator('.so-state.ok')).toContainText(lang === 'en' ? 'Approved and waiting' : 'معتمد وينتظر موعده');
        await expect(page.locator('#chk')).toContainText(lang === 'en' ? 'every 5 minutes' : 'كل 5 دقايق');
        await expect(page.locator('.so-res .bad').first()).toBeVisible();   // the reason a platform failed, in plain words
        await expect(page.locator('.so-res a').first()).toHaveAttribute('href', /facebook\.com/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        // The post text is the user's own; everything else follows the language
        const text = await page.evaluate(() => { const c = document.querySelector('#content')!.cloneNode(true) as HTMLElement; c.querySelectorAll('[data-user-text]').forEach(n => n.remove()); return c.innerText; });
        if (lang === 'en') expect(text.split('\n').filter(l => /[؀-ۿ]/.test(l))).toEqual([]);
        expect(TECH_WORDS.test(text)).toBe(false);
        await shot(page, `social-${lang}-${sc.tag}`);
      });
    });
  }
}
