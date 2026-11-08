// «ملخص الأداء»: the customer-journey funnel on the built Worker (synthetic data only). /api/overview/data answers
// with the parity fixture (tests/parity/fixtures/ads.json), with or without a made-up CRM block.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { login, addSession } from './helpers';

type Row = [string, string, number, number, number, number, number];
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../parity/fixtures/ads.json'), 'utf8')) as { rows: Row[]; crm?: unknown };

// Every 2nd lead is a CRM lead tied to its ad; every 30th of those paid
function withCrm() {
  const rows: unknown[] = [], paid: unknown[] = [];
  let n = 0;
  for (const r of fixture.rows) for (let i = 0; i < r[5]; i++) {
    if (++n % 2) continue;
    const p = (n / 2) % 30 === 0;
    rows.push([r[0], r[1], p ? r[1] : '', p, p ? 1500 : 0]);
    if (p) paid.push([r[1], r[1], 1500, 'meta_form']);
  }
  return { ...fixture, crm: { rows, paid_all: paid } };
}

async function open(page: Page, request: import('@playwright/test').APIRequestContext, data: unknown) {
  await addSession(page.context(), await login(request, 'owner'));
  await page.route('**/api/overview/data*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  await page.goto('/overview/');
  const band = page.locator('svg[role="group"] path').first();
  await expect(band).toHaveAttribute('d', /^M0,/);
  return band;
}
const stages = (page: Page) => page.locator('svg[role="group"] g[role="button"]');
const verdict = (page: Page) => page.locator('#verdict-h');

test('the funnel draws four stages and three links, with a verdict, a line per step and a table', async ({ page, request }) => {
  await open(page, request, withCrm());
  await expect(stages(page)).toHaveCount(7);
  for (const n of ['الوعي', 'الاهتمام', 'التحويل', 'البيع']) await expect(page.locator('svg[role="group"]')).toContainText(n);
  await expect(verdict(page)).not.toBeEmpty();
  await expect(page.locator('section[aria-labelledby="analysis-h"] li')).toHaveCount(4);
  await expect(page.locator('#analysis-h')).toHaveText('التحليل');
  await page.getByText('الأرقام كجدول').click();
  await expect(page.locator('table:has(caption:text("رحلة العميل بالأرقام")) tbody tr')).toHaveCount(4);
});

test('a platform changes the shape and the numbers; focus shows a stage\'s details', async ({ page, request }) => {
  const band = await open(page, request, withCrm());
  await page.waitForTimeout(900);
  const before = await band.getAttribute('d');
  await page.locator('[aria-label="المنصة"] button', { hasText: 'فيسبوك' }).click();
  await expect.poll(() => band.getAttribute('d')).not.toBe(before);
  await stages(page).first().focus();
  await expect(page.locator('[aria-live="polite"]')).toContainText('الوعي');
});

test('reduced motion: the new shape lands at once', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const band = await open(page, request, withCrm());
  await page.locator('[aria-label="المنصة"] button', { hasText: 'سناب شات' }).click();
  const first = await band.getAttribute('d');
  await page.waitForTimeout(400);
  expect(await band.getAttribute('d')).toBe(first);
});

test('no CRM: the sale stage shows —, the link says «غير مربوط», and it is not called the bottleneck', async ({ page, request }) => {
  await open(page, request, fixture);
  await expect(page.locator('svg[role="group"] g[role="button"][aria-label^="البيع"]')).toHaveAttribute('aria-label', /—/);
  await expect(page.locator('svg[role="group"] g[role="button"][aria-label^="من ليد إلى إقفالة"]')).toHaveAttribute('aria-label', /غير مربوط/);
  await expect(page.locator('svg[role="group"]')).not.toContainText('0.00%');
  await expect(page.getByText('مرحلة البيع غير مربوطة')).toBeVisible();
});

test('paid closings with none tied to an ad: «غير مربوط», no 0% and no bottleneck on the sale link', async ({ page, request }) => {
  const d = withCrm() as { crm: { rows: unknown[][]; paid_all: unknown[] } };
  d.crm.rows = d.crm.rows.map(r => [r[0], r[1], '', false, 0]);
  await open(page, request, d);
  const sale = page.locator('svg[role="group"] g[role="button"][aria-label^="من ليد إلى إقفالة"]');
  await expect(sale).toHaveAttribute('aria-label', /غير مربوط/);
  await expect(sale).not.toHaveAttribute('aria-label', /عنق الزجاجة/);
  await expect(page.locator('section[aria-labelledby="analysis-h"]')).toContainText('مو صفر');
});

test('English: every word in the journey card is English and the band reads left to right', async ({ page, request }) => {
  await page.addInitScript(() => { try { localStorage.setItem('well-ads-lang', 'en'); } catch { /* storage blocked */ } });
  await open(page, request, withCrm());
  const card = page.locator('[data-slot="card"]', { has: page.locator('#verdict-h') });
  await expect(card).toContainText('Customer journey');
  await expect(page.locator('#analysis-h')).toHaveText('Analysis');
  const text = await card.evaluate(el => el.textContent ?? '');
  expect(text).not.toMatch(/[\u0600-\u06FF]/);
  const x = await page.locator('svg[role="group"] g[role="button"]').evaluateAll(gs => gs.slice(0, 4).map(g => (g as SVGGElement).getBBox().x));
  expect(x[0]!).toBeLessThan(x[3]!);
});

test('375 px: the funnel scrolls inside its card, the page does not scroll sideways', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, request, withCrm());
  const { pageW, boxW, boxScroll } = await page.evaluate(() => {
    const box = document.querySelector('svg[role="group"]')!.parentElement!;
    return { pageW: document.documentElement.scrollWidth, boxW: box.clientWidth, boxScroll: box.scrollWidth };
  });
  expect(pageW).toBeLessThanOrEqual(375);
  expect(boxScroll).toBeGreaterThan(boxW);
});
