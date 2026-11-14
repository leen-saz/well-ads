// Layout stability (UX audit 2026-11-12, finding 3): pages must not jump while their tables and cards load. The same
// Cumulative Layout Shift the real visitors report (public/assets/vitals.js) is measured here, with every API answer
// held back 400 ms so late content arrives AFTER the first paint, as it does on the live site. Target: 0.1 or less.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const PAGES = ['/control/', '/maestro/', '/maestro/audit/', '/maestro/health/', '/admin/', '/listening/', '/knowledge/', '/today/', '/overview/'];
const LIMIT = 0.1;

for (const path of PAGES) {
  test(`CLS ${path} stays under ${LIMIT} while data loads late`, async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.route('**/api/**', async route => { await new Promise(r => setTimeout(r, 400)); await route.continue(); });
    // The fixture data is always old, which adds the «numbers are old» notice at the top (a deliberate, rare shift). Live data is fresh: measure that case.
    await page.route('**/api/data-status', route => route.fulfill({ json: { level: 'ok', warnings: [], dash_age_hours: 0.5, crm_age_hours: 0.5, dispatch: 'ok', dispatch_at: null } }));
  // The fixture data is always old, which adds the «numbers are old» notice at the top (a deliberate, rare shift). Live data is fresh: measure that case.
  await page.route('**/api/data-status', route => route.fulfill({ json: { level: 'ok', warnings: [], dash_age_hours: 0.5, crm_age_hours: 0.5, dispatch: 'ok', dispatch_at: null } }));
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number; __who: Record<string, number> };
      w.__cls = 0; w.__who = {};
      const name = (n: Node | null) => { const e = n as Element | null; return e && e.nodeType === 1 ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') : '(text)'; };
      new PerformanceObserver(list => {
        for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number; sources?: { node: Node | null }[] }[]) {
          if (e.hadRecentInput) continue;
          w.__cls += e.value;
          const k = name(e.sources?.[0]?.node ?? null); w.__who[k] = (w.__who[k] || 0) + e.value;   // the element that moved most, to point a failure at its cause
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);   // on purpose: the shifts are measured over a fixed 1.5 s window after load, so a condition would change what is measured
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    const who = await page.evaluate(() => Object.entries((window as unknown as { __who: Record<string, number> }).__who).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '));
    console.log(`CLS ${path} ${cls.toFixed(3)} · ${who}`);
    expect(cls, `${path} layout shift, mostly: ${who}`).toBeLessThanOrEqual(LIMIT);
  });
}
