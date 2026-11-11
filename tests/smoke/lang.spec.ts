// The language switch must reach every page: with lang=en no Arabic text may be left on screen, in a hidden tab or in an
// attribute (placeholder, aria-label, tooltip, title). Only the allow-list below may stay Arabic. Synthetic data only.
import { test, expect, type Page } from '@playwright/test';
import { login, addSession } from './helpers';
import { pageStrings, openTabs, arabicIn } from './page-text';

const PAGES = [
  '/', '/today/', '/control/', '/control/new/', '/connectors/', '/account/', '/admin/', '/admin/modules/', '/library/', '/maestro/health/', '/maestro/audit/',
  '/overview/', '/overview/creative/', '/listening/', '/design/', '/video/', '/content/?tab=copy', '/voice/', '/transcribe/', '/vision/', '/voice/?tab=voiceover', '/social/', '/content/', '/journeys/',
  '/compliance/', '/maestro/', '/knowledge/', '/debugger/', '/soon/', '/welcome/',
];
const PUBLIC_PAGES = ['/login/', '/reset/', '/welcome/'];

async function arabicLeft(page: Page): Promise<string[]> {
  return arabicIn(await pageStrings(page));
}

test.describe('lang=en leaves no Arabic behind', () => {
  for (const path of PAGES) {
    test(`${path} (signed in as owner)`, async ({ page, context, request }) => {
      await addSession(context, await login(request, 'owner'));
      await page.goto(`${path}${path.includes('?') ? '&' : '?'}lang=en`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(600);
      const seen = new Set(await arabicLeft(page));
      for (const s of arabicIn([...(await openTabs(page))])) seen.add(s);
      expect([...seen], `Arabic left on ${path} in English`).toEqual([]);
    });
  }
  for (const path of PUBLIC_PAGES) {
    test(`${path} (signed out)`, async ({ page }) => {
      await page.goto(`${path}${path.includes('?') ? '&' : '?'}lang=en`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      expect(await arabicLeft(page), `Arabic left on ${path} in English`).toEqual([]);
    });
  }
});
