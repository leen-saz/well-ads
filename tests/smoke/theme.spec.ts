// Theme (docs/PRD.md §4.3, milestone M1): the Worker paints the saved theme before any script, from the cookie,
// and links the one token file first; the account menu switches it on the open page.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const bg = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim());

test('no cookie: light, with tokens.css linked first in <head>', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.goto('/control/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const first = await page.evaluate(() => document.head.querySelector('link[rel=stylesheet]')?.getAttribute('href') ?? '');
  expect(first).toMatch(/\/assets\/tokens\.css$/);
  expect(await bg(page)).toBe('#F1EEFA');
});

test('dark cookie: dark from the first paint', async ({ page, context, request, baseURL }) => {
  await addSession(context, await login(request, 'owner'));
  await context.addCookies([{ name: 'well-theme', value: 'dark', url: baseURL! }]);
  await page.goto('/control/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg(page)).toBe('#120D2B');
});

test('the account menu cycles light → dark → match device and saves it', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.goto('/control/');
  await page.locator('#meBtn').click();
  const btn = page.locator('#themeBtn');
  await btn.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await btn.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  expect((await context.cookies()).find(c => c.name === 'well-theme')?.value).toBe('system');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
});
