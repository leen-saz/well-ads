// The Connections page: platforms nothing is built for are not listed, and the page says nothing about MCP or GitHub.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

for (const lang of ['ar', 'en'] as const) {
  test(`connections in ${lang}: no unbuilt platforms, no MCP/GitHub words`, async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto(`/connectors/?lang=${lang}`);
    await page.locator('.cx').first().waitFor();
    const names = (await page.locator('.cx h3').allInnerTexts()).join('|');
    expect(names).toContain('Meta');
    for (const unbuilt of ['Pinterest', 'Reddit', 'Taboola', 'Mixpanel', 'Criteo']) expect(names, unbuilt).not.toContain(unbuilt);
    const text = await page.locator('#content').innerText();
    expect(text).not.toMatch(/\bMCP\b|GitHub|tiktok-data/i);
    expect(text).not.toContain('سحب أرقامها لسا ما انبنى');
    if (lang === 'en') expect(text.split('\n').filter(l => /[؀-ۿ]/.test(l))).toEqual([]);
  });
}
