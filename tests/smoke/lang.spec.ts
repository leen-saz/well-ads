// The language switch must reach every page: with lang=en no Arabic text may be left on screen, in a hidden tab or in an
// attribute (placeholder, aria-label, tooltip, title). Only the allow-list below may stay Arabic. Synthetic data only.
import { test, expect, type Page } from '@playwright/test';
import { login, addSession } from './helpers';

const PAGES = [
  '/', '/today/', '/control/', '/control/new/', '/connectors/', '/account/', '/admin/', '/admin/modules/', '/library/', '/maestro/health/',
  '/overview/', '/overview/creative/', '/listening/', '/design/', '/copy/', '/voice/', '/transcribe/', '/vision/', '/social/', '/content/', '/journeys/',
  '/compliance/', '/maestro/', '/knowledge/', '/debugger/', '/soon/', '/welcome/',
];
const PUBLIC_PAGES = ['/login/', '/reset/', '/welcome/'];

// What may stay Arabic in English: the language button itself, the product's own proper names, and data the user wrote
const ALLOW: RegExp[] = [
  /^عربي$/, // the language button names the language in its own script
  /^A word or claim never to be written/, // English help text that quotes two Arabic example words
];
const ARABIC = /[؀-ۿݐ-ݿ]/;

// Every Arabic run still on the page: text nodes (hidden panes too), attributes and the title
async function arabicLeft(page: Page): Promise<string[]> {
  const found: string[] = await page.evaluate(() => {
    const out: string[] = [];
    const skip = /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT)$/;
    const w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.parentElement && skip.test(n.parentElement.tagName)) continue;
      if (n.parentElement?.closest('[data-user-text]')) continue;
      out.push((n.nodeValue || '').trim());
    }
    for (const el of document.querySelectorAll('*')) {
      if (el.closest('[data-user-text]')) continue;
      for (const a of ['placeholder', 'aria-label', 'data-tip', 'title', 'alt', 'value']) {
        if (a === 'value' && !(el.tagName === 'INPUT' && /^(button|submit)$/.test((el as HTMLInputElement).type))) continue;
        const v = el.getAttribute(a); if (v) out.push(v.trim());
      }
    }
    out.push(document.title);
    return out;
  });
  return [...new Set(found.filter(s => ARABIC.test(s) && !ALLOW.some(re => re.test(s))))];
}

// Open every tab/segment button so the panes that are drawn on demand are on the page too
async function openTabs(page: Page) {
  const n = await page.locator('#content [role="tab"], #content [data-tab], #content .seg button').count();
  for (let i = 0; i < Math.min(n, 12); i++) {
    const b = page.locator('#content [role="tab"], #content [data-tab], #content .seg button').nth(i);
    if (!(await b.isVisible().catch(() => false))) continue;
    await b.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(250);
  }
}

test.describe('lang=en leaves no Arabic behind', () => {
  for (const path of PAGES) {
    test(`${path} (signed in as owner)`, async ({ page, context, request }) => {
      await addSession(context, await login(request, 'owner'));
      await page.goto(`${path}?lang=en`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(600);
      const seen = new Set(await arabicLeft(page));
      await openTabs(page);
      for (const s of await arabicLeft(page)) seen.add(s);
      expect([...seen], `Arabic left on ${path} in English`).toEqual([]);
    });
  }
  for (const path of PUBLIC_PAGES) {
    test(`${path} (signed out)`, async ({ page }) => {
      await page.goto(`${path}?lang=en`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      expect(await arabicLeft(page), `Arabic left on ${path} in English`).toEqual([]);
    });
  }
});
