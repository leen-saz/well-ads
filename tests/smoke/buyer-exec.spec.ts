// Media buyer tab: the approved-execution section is there in Arabic and in English, real execution is off by default, the
// emergency stop is one click away, and a member who is not the owner has no limits form and no real-execution switch. Synthetic data only: the smoke Worker has
// no ad-platform key, so nothing here can reach an ad account.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

// The Media buyer is hidden (src/modules/buyer/flag.ts, Leen's decision 2026-11-12), so these tests are skipped. When the tab
// comes back, flip the flag and change `test.describe.skip` below to a plain run (the tests stay as they were).
test.describe.skip('Media buyer (hidden for now)', () => {

const TEXT = {
  ar: { box: 'التنفيذ بموافقتك', stop: 'إيقاف طوارئ', trial: 'تجربة بدون تنفيذ', missing: 'مفتاح التنفيذ ناقص', hand: 'ينفّذ يدوياً' },
  en: { box: 'Execution with your approval', stop: 'Emergency stop', trial: 'Trial without execution', missing: 'Execution key missing', hand: 'Applied by hand' },
} as const;

for (const lang of ['ar', 'en'] as const) {
  test(`owner, ${lang}: the section shows every platform's state, real execution off, key missing, stop button`, async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto(`/buyer/?lang=${lang}`);
    const box = page.locator('#execBox');
    await expect(box).toBeVisible();
    await expect(box).toContainText(TEXT[lang].box);
    await expect(box.locator('.by-plat').first()).toContainText(TEXT[lang].missing);
    await expect(box.locator('.by-plat').first()).toContainText(TEXT[lang].trial);
    await expect(box).toContainText(TEXT[lang].hand);
    await expect(page.locator('#killBtn')).toContainText(TEXT[lang].stop);
    // with no key, the real-execution switch cannot be turned on
    await expect(box.locator('button[data-live="meta"]')).toBeDisabled();
    if (lang === 'en') await expect(box).not.toContainText(/[؀-ۿ]/);
  });
}

test('a member (approver, not the owner) can press the stop but has no limits form and no real-execution switch', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'member'));
  await page.goto('/buyer/');
  await expect(page.locator('#execBox')).toBeVisible();
  await expect(page.locator('#killBtn')).toBeVisible();
  await expect(page.locator('#unkillBtn')).toBeHidden();
  await expect(page.locator('#limitsForm')).toBeHidden();
  await expect(page.locator('button[data-live]')).toHaveCount(0);
});

// The confirmation dialog, with the API answers made up here: figures shown, dry run first, real execution needs the tick, and the
// request carries the figures the dialog showed. Nothing real is called: every buyer API answer is stubbed.
const ACTION = {
  id: '00000000-0000-4000-8000-000000000001', platform: 'meta', level: 'campaign', entity_id: '111', entity_name: 'TEST_C1', kind: 'budget_up', status: 'proposed', mode: 'auto',
  change: { op: 'budget', from: 100, to: 120, pct: 20 }, reason: 'سبب تجريبي كافي', risk: 'خطر تجريبي كافي', success: { metric: 'م', goal: 'ه' }, manual_why: null, dry_run: null, applied_at: null,
  guards: { blocks: [], live: true, impact: { dayDelta: 20, weekDelta: 140, pct: 20, dailyUsed: 0, dailyCap: 50 } },
};
const STATE = { missing: false, actions: [ACTION], usedToday: 0, can: { approve: true, owner: true },
  settings: { kill: false, maxPct: 20, dailyCap: 50, live: { meta: true, snapchat: false, tiktok: false, google: false }, configured: { meta: true, snapchat: false } } };

test('«approve and apply» opens the second confirmation with the money summary; dry run is first and real execution needs the tick', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/buyer/actions*', r => r.fulfill({ json: STATE }));
  await page.route('**/api/buyer/apply', async r => { sent.push(r.request().postDataJSON()); await r.fulfill({ json: { ok: true, dry: true, wrote: false, blocks: [], stale: false } }); });
  await page.goto('/buyer/');
  const card = page.locator('.by-a').first();
  await expect(card).toContainText('TEST_C1');
  await expect(card).toContainText('100');
  await expect(card).toContainText('120');
  await card.locator('[data-apply]').click();
  const dlg = page.locator('#dlg');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('140.00');                       // the week's difference if it stays
  const live = dlg.locator('#dlgLive');
  await expect(live).toBeDisabled();                               // needs the «I understand» tick
  await dlg.locator('#dlgDry').click();
  await expect(dlg.locator('#dlgOut')).toContainText('ما تغيّر شي');
  expect(sent).toEqual([{ id: ACTION.id, confirm: true, mode: 'dry', expect: { from: 100, to: 120 } }]);
  await dlg.locator('#ack').check();
  await expect(live).toBeEnabled();
  await dlg.locator('#dlgCancel').click();
  await expect(dlg).toBeHidden();
  expect(sent).toHaveLength(1);                                    // cancelling sends nothing
});

test('a blocked action shows its guards in the dialog and offers no real execution', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  const blocked = { ...ACTION, guards: { ...ACTION.guards, blocks: [{ code: 'cap_pct', detail: 10 }] } };
  await page.route('**/api/buyer/actions*', r => r.fulfill({ json: { ...STATE, actions: [blocked] } }));
  await page.goto('/buyer/?lang=en');
  await page.locator('.by-a [data-apply]').first().click();
  await expect(page.locator('#dlg')).toContainText('Exceeds the change-rate cap');
  await expect(page.locator('#dlgLive')).toBeHidden();
  await expect(page.locator('#dlg')).not.toContainText(/[؀-ۿ]/);
});
});
