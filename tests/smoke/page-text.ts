// What a page shows, for the smoke tests that read it: every text node (hidden panes too), the attributes a user can read
// (placeholder, aria-label, tooltip, title, alt, button values) and the document title.
import type { Page } from '@playwright/test';

export async function pageStrings(page: Page): Promise<string[]> {
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
  return [...new Set(found.filter(Boolean))];
}

// Open every tab/segment button so the panes that are drawn on demand are on the page too
export async function openTabs(page: Page) {
  const sel = '#content [role="tab"], #content [data-tab], #content .seg button';
  const n = await page.locator(sel).count();
  for (let i = 0; i < Math.min(n, 12); i++) {
    const b = page.locator(sel).nth(i);
    if (!(await b.isVisible().catch(() => false))) continue;
    await b.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(250);
  }
}

// What may stay Arabic in English: the language button itself, the product's own proper names, and data the user wrote
const ALLOW: RegExp[] = [
  /^عربي$/, // the language button names the language in its own script
  /^A word or claim never to be written/, // English help text that quotes two Arabic example words
];
const ARABIC = /[؀-ۿݐ-ݿ]/;
export const arabicIn = (strings: string[]) => strings.filter(s => ARABIC.test(s) && !ALLOW.some(re => re.test(s)));
