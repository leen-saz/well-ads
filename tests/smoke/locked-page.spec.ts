// A section that is off for the company (or that the user may not open) shows a screen in Well's shell that says so and
// offers a way back: never a bare white page with a «sign in» link. Arabic and English, owner and member.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

for (const who of ['owner', 'member'] as const) {
  for (const lang of ['ar', 'en'] as const) {
    for (const t of ['video', 'journeys', 'transcribe', 'vision']) {
      test(`${t}: closed screen for the ${who} in ${lang}`, async ({ page, context, request }) => {
        await addSession(context, await login(request, who));
        await page.goto(`/soon/?t=${t}&why=locked&lang=${lang}`);
        await expect(page.locator('.side')).toBeVisible();                       // Well's shell, not a white page
        const card = page.locator('#content .sn');
        await expect(card).toBeVisible();
        await expect(card.locator('a.btn.primary')).toHaveAttribute('href', '/today/');   // the way back
        const text = (await page.locator('#content').innerText());
        expect(text).not.toMatch(/الدخول|sign in|log in/i);
        if (lang === 'en') expect(text.split('\n').filter(l => /[؀-ۿ]/.test(l))).toEqual([]);
        // the owner is shown where to enable it; a member is told to ask the owner
        await expect(page.locator('#content a[href="/admin/modules/"]')).toHaveCount(who === 'owner' ? 1 : 0);
      });
    }
  }
}
