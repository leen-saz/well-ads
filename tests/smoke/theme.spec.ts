// Tokens and ink menus (docs/PRD.md §4.2, milestone M1; Leen 2026-11-19: «الداكن خله للقوائم بس»): every page links the one
// token file first; content stays light, the sidebar and its menus are always dark; there is no theme switch.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const v = (page: import('@playwright/test').Page, sel: string, name: string) =>
  page.evaluate(([s, n]) => getComputedStyle(document.querySelector(s!)!).getPropertyValue(n!).trim(), [sel, name]);

test('tokens.css is linked first; content light, sidebar ink', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.goto('/control/');
  const first = await page.evaluate(() => document.head.querySelector('link[rel=stylesheet]')?.getAttribute('href') ?? '');
  expect(first).toMatch(/\/assets\/tokens\.css$/);
  expect(await v(page, 'html', '--paper')).toBe('#FFFFFF');
  await expect(page.locator('#side .navi').first()).toBeVisible();
  expect(await v(page, '#side', '--paper')).toBe('#1D1069');
  // the old aliases follow inside the sidebar too
  expect(await v(page, '#side', '--ink')).toBe('#F3F0FF');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#side')!).backgroundColor)).toBe('rgb(29, 16, 105)');
});

test('the account menu is ink and has no theme switch', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.goto('/control/');
  await page.locator('#meBtn').click();
  await expect(page.locator('#meMenu')).toBeVisible();
  expect(await v(page, '#meMenu', '--paper')).toBe('#1D1069');
  await expect(page.locator('#themeBtn')).toHaveCount(0);
});
