// «المدقق»: the owner sees a result badge next to the verdict and an audit page; anyone else sees nothing of it, no element and
// no wording, and the page and API refuse them. Synthetic data only (a made-up dash.json in Leen's proportions).
import { test, expect, type Page } from '@playwright/test';
import { login, addSession } from './helpers';
import { synth } from '../../src/modules/auditor/synth';

// Few leads tied to ads, 48 closings in ~4K results: the judge names the sales gap (whole CRM) and the auditor confirms it.
// With targets lenient enough for «no problem», the auditor's own floor finds the data does not carry it.
const data = synth({ tied: 0.12, paidTied: 4 });
const lenient = { ...data, funnel_targets: { ctr: 0.1, clickToLead: 0.5, leadToClose: 0.5, cpl: 100000, costShare: 100, roas: 0.01 } };
const TECH = /تدقيق|المدقق|مناقَض|أضعف مما يبدو|مؤكَّد|Audit|Contradicted|Weaker than it looks/;

async function open(page: Page, request: import('@playwright/test').APIRequestContext, who: string, path = '/overview/', body: unknown = data) {
  await addSession(page.context(), await login(request, who));
  await page.route('**/api/overview/data*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  await page.goto(path);
  await expect(page.locator('#verdict-h')).not.toBeEmpty();
}

test('the owner sees the audit badge next to the verdict, linking to the audit page', async ({ page, request }) => {
  await open(page, request, 'owner');
  const badge = page.getByTestId('audit-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('تدقيق');
  // one status for the whole screen: the fixture's lead step is weak on some platforms, so the badge is not «confirmed»
  await expect(badge).toContainText('أضعف مما يبدو');
  await expect(badge).toHaveAttribute('href', '/maestro/audit/');
});

test('a «no problem» the data does not carry gets a warning badge', async ({ page, request }) => {
  await open(page, request, 'owner', '/overview/', lenient);
  await expect(page.locator('#verdict-h')).toHaveText('لا توجد مشكلة');
  await expect(page.getByTestId('audit-badge')).toContainText(/أضعف مما يبدو|مناقَض/);
});

test('the badge follows the page language', async ({ page, request }) => {
  await open(page, request, 'owner', '/overview/?lang=en');
  await expect(page.getByTestId('audit-badge')).toContainText('Weaker than it looks');
  await expect(page.getByTestId('audit-badge')).toHaveAttribute('href', '/maestro/audit/?lang=en');
});

test('a normal user sees nothing technical: no badge, no audit wording, and the page and API refuse them', async ({ page, request }) => {
  await open(page, request, 'u-overview');
  await expect(page.getByTestId('audit-badge')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(TECH);
  expect((await page.request.get('/api/maestro/audit')).status()).toBe(403);
  expect((await page.request.post('/api/maestro/critique', { data: {}, headers: { origin: 'http://localhost:8787' } })).status()).toBe(403);
  const res = await page.request.get('/maestro/audit/', { maxRedirects: 0 });
  expect(res.status()).not.toBe(200);
  expect(await res.text()).not.toMatch(TECH);
});

test('the owner opens the audit page: verdict status, findings with what would settle them, back-test counts, log', async ({ page, request }) => {
  await addSession(page.context(), await login(request, 'owner'));
  await page.route('**/api/maestro/audit*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(auditFor()) }));
  await page.goto('/maestro/audit/');
  await expect(page.locator('h1')).toContainText('تدقيق القرارات');
  await expect(page.getByText('القرار مناقَض').first()).toBeVisible();
  await expect(page.getByText('وش يحسمها')).toBeVisible();
  await expect(page.getByText('تجربة على التاريخ')).toBeVisible();
  await expect(page.getByText('سجل الاختلافات')).toBeVisible();
  // 375px: no sideways scroll
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

function auditFor() {
  const f = { id: 'silent_below_floor', kind: 'challenge', effect: 'contradicts', step: 'verdict', text: { ar: 'الحكم «لا مشكلة» لكن حتى لو كل إقفالة من هالإعلانات تبقى تحت الحد.', en: 'No problem, yet even in the best case the rate is under the limit.' }, needs: { ar: 'ربط الإقفالات بإعلاناتها.', en: 'Tie closings to their ads.' } };
  return { period: { from: '2026-10-02', to: '2026-10-31', plat: null }, headline: { ar: { title: 'لا توجد مشكلة واضحة', owner: null }, en: { title: 'No clear problem', owner: null } }, status: 'contradicted', checked: 14,
    verdict: { step: null, level: 'ok', findings: [f] }, steps: { sale: { status: 'contradicted', findings: [f] }, click: { status: 'confirmed', findings: [] } },
    backtest: { windows: 12, said: { problem: 3, ok: 9 }, confirmed: 7, weakened: 2, contradicted: 3, silent: 3, wrong: 0, flips: 2, skipped: 0, byCheck: {} }, critic: true,
    log: [{ at: '2026-11-07T08:00:00Z', to: '2026-10-31', plat: 'all', step: null, status: 'contradicted', checks: ['silent_below_floor'] }] };
}
