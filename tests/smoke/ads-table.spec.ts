// The Overview ads table: paging, sorting and search keep working (guards the @tanstack/react-table v9 migration, where an unstable option sends the table back to page 1)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const FIX = readFileSync(join(process.cwd(), 'tests/parity/fixtures/ads.json'), 'utf8');
const WORDS = { en: { next: 'Next page', prev: 'Previous page', search: 'Search by ad or campaign name' }, ar: { next: 'الصفحة اللي بعد', prev: 'الصفحة اللي قبل', search: 'ابحث باسم الإعلان أو الحملة' } };

for (const lang of ['ar', 'en'] as const) {
  test(`ads table pages, re-sorts and searches (${lang})`, async ({ page, context, request }) => {
    const w = WORDS[lang];
    await addSession(context, await login(request, 'owner'));
    await page.route('**/api/overview/data*', r => r.fulfill({ status: 200, contentType: 'application/json', body: FIX }));
    await page.goto(`/overview/?lang=${lang}`);
    const next = page.getByLabel(w.next);
    for (let i = 0; i < 8 && !(await next.count()); i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(400); }
    await next.waitFor({ state: 'attached', timeout: 30_000 });
    const pageNo = async () => Number(((await page.locator('[data-slot="card"]:has(thead button)').first().innerText()).match(/\d+(?= (?:of|من) \d+)/) || ['0'])[0]);
    expect(await pageNo()).toBe(1);
    await next.dispatchEvent('click');
    await expect.poll(pageNo).toBe(2);
    await page.getByLabel(w.prev).dispatchEvent('click');
    await expect.poll(pageNo).toBe(1);
    await next.dispatchEvent('click');
    await expect.poll(pageNo).toBe(2);
    await page.locator('table:has(thead button) thead button').nth(1).dispatchEvent('click');
    await expect.poll(pageNo, { message: 'sorting returns to page 1' }).toBe(1);
    await next.dispatchEvent('click');
    await expect.poll(pageNo).toBe(2);
    await page.getByPlaceholder(w.search).evaluate((e: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(e, 'a');
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(pageNo, { message: 'searching returns to page 1' }).toBe(1);
  });
}
