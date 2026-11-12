// The decisions board's table: the evidence column is whole (nothing cut by the card), the suggestion's chips never sit on top of
// its reason, and the impact figure keeps its «+~» sign on the right side. Synthetic suggestions; Arabic and English; wide and phone.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const sug = (id: number, over: Record<string, unknown> = {}) => ({
  id, platform: 'meta', level: 'ad', kind: 'budget_up', target_id: `9000${id}`, target_name: `Smoke ad number ${id} with a rather long name to test the cell`, campaign: 'Smoke campaign', params: { pct: 20 },
  evidence: { spend: 1840.5, leads: 61, cpl: 30.17, target_cpl: 45, ctr: 2.31, metric: 'leads' }, source: 'rule', status: 'open', created_at: '2026-11-10T08:00:00Z',
  critic: { ok: true, issues: [] }, ...over,
});
const OPEN = [
  sug(1),
  sug(2, { kind: 'pause', params: {}, critic: { ok: false, issues: ['smoke reason'] }, evidence: { spend: 920, leads: 0, cpl: null, target_cpl: 45, ctr: 0.4, metric: 'leads' } }),
  sug(3, { source: 'claude', evidence: { spend: 12345.75, leads: 1234, cpl: 10, target_cpl: 45, ctr: 12.5, metric: 'chats' } }),
];

for (const lang of ['ar', 'en'] as const) {
  for (const [w, h] of [[1920, 1000], [1470, 900], [1280, 800], [1024, 768], [390, 844]] as const) {
    test(`decisions table ${lang} ${w}px`, async ({ page, context, request }) => {
      await addSession(context, await login(request, 'owner'));
      await page.setViewportSize({ width: w, height: h });
      await page.route('**/api/control/suggestions', r => r.request().method() === 'GET' ? r.fulfill({ json: { open: OPEN, done: [] } }) : r.continue());
      await page.route('**/api/control/settings', r => r.fulfill({ json: { settings: [], owner: true } }));
      await page.route('**/control/ads.json', r => r.fulfill({ json: { ads: {}, generated_at: '2026-11-10T08:00:00Z' } }));
      await page.route('**/api/control/kill', r => r.fulfill({ json: { kill: false } }));
      await page.goto(`/control/?lang=${lang}`);
      await expect(page.locator('#inbox tbody tr')).toHaveCount(3);
      const box = (sel: string, i = 0) => page.locator(sel).nth(i).evaluate(e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      const card = await box('#inbox');
      // nothing scrolls sideways inside the card and nothing sticks out of it
      expect(await page.locator('#inbox').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'card scrolls sideways').toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page scrolls sideways').toBe(true);
      for (let i = 0; i < 3; i++) {
        const ev = await box('#inbox .c-ev', i);
        expect(ev.l, `evidence ${i} left edge`).toBeGreaterThanOrEqual(card.l - 1); expect(ev.r, `evidence ${i} right edge`).toBeLessThanOrEqual(card.r + 1);
        // the chips and the reason do not overlap
        const chips = await box('#inbox .sg-chips', i), why = await box('#inbox .sg-why', i);
        expect(chips.b, `suggestion ${i}: chips over the reason`).toBeLessThanOrEqual(why.t + 1);
      }
      // the impact sign is isolated, so it cannot flip in the right-to-left cell
      const imp = page.locator('#inbox .c-imp bdi').first();
      await expect(imp).toHaveAttribute('dir', 'ltr');
      await expect(imp).toHaveText(/^\+~/);
      if (lang === 'ar' && w === 1470 && process.env['SHOTS']) await page.screenshot({ path: `${process.env['SHOTS']}/control-table-${lang}-${w}.png` });
    });
  }
}
