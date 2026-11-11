// The app shell: the floating sidebar card and the top bar line up at every width, in Arabic (RTL) and English (LTR):
// a gap between them (the bar never touches the card), the page title on the same line as the logo row, nothing cut at
// the window's edge, no sideways scroll. Measures bounding boxes; set SHOTS=<folder> to also save a screenshot.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const SHOTS = process.env['SHOTS'];
const WIDTHS = [1920, 1440, 1280, 1024];
for (const lang of ['ar', 'en'] as const) {
  for (const path of ['/today/', '/overview/', '/overview/creative/', '/social/', '/account/', '/admin/']) {
    for (const w of WIDTHS) {
      test(`shell ${path} ${lang} ${w}px`, async ({ page, context, request }) => {
        await addSession(context, await login(request, 'owner'));
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(`${path}?lang=${lang}`);
        await page.locator('.side-top').waitFor();
        const box = (sel: string) => page.locator(sel).first().evaluate(e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
        const check = async (label: string, aligned: boolean) => {
          const side = await box('.side'), bar = await box('.topbar'), row = await box('.side-top'), title = await box('.topbar h1');
          const gap = lang === 'ar' ? side.l - bar.r : bar.l - side.r;
          expect(gap, `${label}: space between the top bar and the sidebar card`).toBeGreaterThanOrEqual(8);
          if (aligned) expect(Math.abs((row.t + row.b) / 2 - (title.t + title.b) / 2), `${label}: title on the logo row's line`).toBeLessThanOrEqual(4);
          expect(side.t, `${label}: card top inside the window`).toBeGreaterThanOrEqual(0);
          expect(side.b, `${label}: card bottom inside the window`).toBeLessThanOrEqual(900);
          expect(side.l, `${label}: card left edge`).toBeGreaterThanOrEqual(0);
          expect(side.r, `${label}: card right edge`).toBeLessThanOrEqual(w);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no sideways scroll`).toBe(true);
        };
        await check('open', true);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/shell-${lang}-${w}.png`, clip: { x: 0, y: 0, width: w, height: 260 } });
        await page.locator('.side-fold').click();          // the folded sidebar keeps the same gap
        await expect(page.locator('.app.mini')).toHaveCount(1);
        await check('folded', false);   // the folded card stacks the logo over the button, so only the gap and the edges apply
      });
    }
  }
}
test('shell: on a phone the sidebar is off-screen and the top bar spans the width', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/social/');
  await page.locator('.topbar').waitFor();
  const bar = await page.locator('.topbar').evaluate(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; });
  expect(bar.l).toBeLessThanOrEqual(0.5); expect(bar.r).toBeGreaterThanOrEqual(389.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
