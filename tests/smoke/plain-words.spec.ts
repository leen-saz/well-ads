// A normal member (every tab allowed, not the owner) never reads anything technical: no Supabase, SQL, Cloudflare, GitHub, API,
// token, key or secret names, pipeline, migration, dash.json, MCP or Worker, in Arabic or in English, also when the database
// tables are missing. Technical text may appear only on the Connectors page and the owner-only pages (data health, admin),
// which are not visited here. Synthetic data only.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';
import { pageStrings, openTabs, arabicIn } from './page-text';
import { TECH_WORDS } from '../shared/tech-words';

const PAGES = [
  '/', '/today/', '/control/', '/control/new/', '/account/', '/library/', '/overview/', '/overview/creative/', '/listening/',
  '/design/', '/content/?tab=copy', '/voice/', '/social/', '/content/', '/journeys/', '/compliance/', '/maestro/', '/knowledge/', '/debugger/', '/soon/',
];
const FAKE = 'http://localhost:8788';

for (const missing of [false, true]) {
  test.describe(missing ? 'database tables missing' : 'normal data', () => {
    test.beforeAll(async ({ request }) => { await request.post(`${FAKE}/__mode`, { data: { missing } }); });
    test.afterAll(async ({ request }) => { await request.post(`${FAKE}/__mode`, { data: { missing: false } }); });
    for (const lang of ['ar', 'en']) {
      for (const path of PAGES) {
        test(`${path} as a member, ${lang}`, async ({ page, context, request }) => {
          await addSession(context, await login(request, 'member'));
          await page.goto(`${path}${path.includes('?') ? '&' : '?'}lang=${lang}`);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(500);
          const seen = new Set(await pageStrings(page));
          await openTabs(page, seen);
          const bad = [...seen].filter(s => TECH_WORDS.test(s)).map(s => s.slice(0, 120));
          expect(bad, `technical words on ${path} (${lang})`).toEqual([]);
          // The plain sentences that replace the technical ones follow the language too
          if (lang === 'en') expect(arabicIn([...seen]), `Arabic left on ${path} in English`).toEqual([]);
        });
      }
    }
  });
}
