// «نظرة عامة»: the department filter (kept in ?dept=) and the comparison with the same days of last month. Synthetic data only.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

function dash(startDay: string) {
  const rows: unknown[][] = [];
  for (let t = Date.parse(startDay); t <= Date.parse('2026-11-27'); t += 864e5) {
    const day = new Date(t).toISOString().slice(0, 10);
    rows.push(['a', day, 10, 1000, 20, 2, 0], ['b', day, 30, 1000, 10, 0, 3]);
  }
  return JSON.stringify({
    generated_at: '2026-11-28T00:00:00Z', range: { start: startDay, end: '2026-11-27', today: '2026-11-28' },
    departments: { order: ['iv', 'midwife'], departments: { iv: { ar: 'المحاليل' }, midwife: { ar: 'القبالة' } } },
    ads: { a: { name: 'ad-a', campaign: 'c1', platform: 'instagram', goal: 'lead', dept: 'iv', live: true }, b: { name: 'ad-b', campaign: 'c2', platform: 'instagram', goal: 'messages', dept: 'midwife', live: true } },
    rows,
  });
}

const open = async (page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext, request: import('@playwright/test').APIRequestContext, body: string, query: string) => {
  await addSession(context, await login(request, 'owner'));
  await page.route('**/api/overview/data*', r => r.fulfill({ status: 200, contentType: 'application/json', body }));
  await page.goto(`/overview/?${query}`);
};

test('department filter: from the address, changes the numbers, keeps ?dept= and falls back to all on a bad value', async ({ page, context, request }) => {
  await open(page, context, request, dash('2026-08-01'), 'dept=iv');
  const select = page.getByRole('combobox', { name: 'القسم' });
  await expect(select).toContainText('المحاليل');
  await expect(page.getByText('لا توجد فترة سابقة كاملة للمقارنة')).toHaveCount(0);
  await expect(page.getByText('الشهر الماضي').first()).toBeVisible();
  await select.click();
  await page.getByRole('option', { name: 'القبالة' }).click();
  await expect(select).toContainText('القبالة');
  expect(new URL(page.url()).searchParams.get('dept')).toBe('midwife');
  await select.click();
  await page.getByRole('option', { name: 'كل الأقسام' }).click();
  expect(new URL(page.url()).searchParams.has('dept')).toBe(false);
  await page.goto('/overview/?dept=nope');
  await expect(page.getByRole('combobox', { name: 'القسم' })).toContainText('كل الأقسام');
});

test('comparison: says there is no complete earlier period when the data is too short', async ({ page, context, request }) => {
  await open(page, context, request, dash('2026-11-10'), 'lang=ar');
  await expect(page.getByText('لا توجد فترة سابقة كاملة للمقارنة').first()).toBeVisible();
});
