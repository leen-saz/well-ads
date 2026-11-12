// The Media buyer is hidden (src/modules/buyer/flag.ts): not in the sidebar for anyone, the owner included, and no door left:
// the page and every API of it, the execution ones too, answer 404.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

test('the owner sees no Media buyer in the sidebar, and its page and APIs are 404', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.goto('/today/');
  await page.locator('#side a').first().waitFor();
  expect(await page.locator('#side a[href^="/buyer"]').count()).toBe(0);
  expect((await page.goto('/buyer/'))?.status()).toBe(404);
  for (const [method, path] of [['GET', 'report'], ['GET', 'rules'], ['GET', 'actions'], ['POST', 'propose'], ['POST', 'decide'], ['POST', 'apply'], ['POST', 'rollback'], ['POST', 'execution']] as const) {
    const r = await page.request.fetch(`/api/buyer/${path}`, { method, data: method === 'POST' ? {} : undefined });
    expect(r.status(), `${method} ${path}`).toBe(404);
  }
});
