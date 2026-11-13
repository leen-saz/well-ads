// The Video tab for the owner: the work area (everything except the owner's status card) reads in plain words, also when the
// database tables are missing and in English. What is still to set up is only in the status card, which a member never gets.
// Synthetic data only.
import { test, expect } from '@playwright/test';
import { login, addSession, FAKE } from './helpers';
import { pageStrings, openTabs, arabicIn } from './page-text';
import { TECH_WORDS } from '../shared/tech-words';

const FORBIDDEN = new RegExp(`${TECH_WORDS.source}|HIGGSFIELD|OPENAI`, 'i');

for (const missing of [false, true]) {
  test.describe(missing ? 'tables missing' : 'normal data', () => {
    test.beforeAll(async ({ request }) => { await request.post(`${FAKE}/__mode`, { data: { missing } }); });
    test.afterAll(async ({ request }) => { await request.post(`${FAKE}/__mode`, { data: { missing: false } }); });
    for (const lang of ['ar', 'en']) {
      test(`/video/ as the owner, ${lang}: work area is plain, details only in the status card`, async ({ page, context, request }) => {
        await addSession(context, await login(request, 'owner'));
        await page.goto(`/video/?lang=${lang}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);
        const card = page.locator('[data-owner-only]');
        // the owner's card lists what is still to set up (no engine keys in the smoke environment)
        await expect(card).toBeVisible();
        expect(await card.textContent()).toMatch(/HIGGSFIELD_API_KEY/);
        await page.evaluate(() => document.querySelectorAll('[data-owner-only]').forEach(n => n.remove()));
        const seen = new Set(await pageStrings(page));
        await openTabs(page, seen);
        expect([...seen].filter(s => FORBIDDEN.test(s)).map(s => s.slice(0, 120)), 'technical words in the work area').toEqual([]);
        await expect(page.locator('#notready')).toBeVisible();
        if (lang === 'en') expect(arabicIn([...seen])).toEqual([]);
      });
    }
  });
}

test('a member never gets the status card or the names', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'member'));
  await page.goto('/video/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await expect(page.locator('[data-owner-only]')).toBeHidden();
  expect(await page.content()).not.toMatch(/HIGGSFIELD|034_video/);
});
