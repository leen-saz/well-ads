// English means English: the decisions board (inbox, a suggestion's panel, history, learning, rules), Social, Permissions (users and the
// action log, every action name) and the Debugger (every kind of finding) leave no Arabic on the page in ?lang=en, except the user's own
// data (marked data-user-text). Synthetic data; the API answers are made up here.
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { login, addSession } from './helpers';

const sug = (id: number, o: Record<string, unknown> = {}) => ({ id, platform: 'meta', level: 'ad', kind: 'budget_up', target_id: `9${id}`, target_name: 'Smoke ad', campaign: 'Smoke campaign', params: { pct: 20 },
  evidence: { spend: 1840.5, leads: 61, cpl: 30.17, target_cpl: 45, ctr: 2.31, metric: 'leads' }, source: 'rule', status: 'open', created_at: '2026-11-10T08:00:00Z', critic: { ok: false, issues: ['smoke'] }, ...o });
const OPEN = [sug(1), sug(2, { kind: 'pause', params: {} }), sug(3, { source: 'claude' }), sug(4, { source: 'manual', requested_by: 'x@y.z', target_id: '91' }), sug(5, { target_id: '91', kind: 'budget_down' })];
const DONE = ['approved', 'rejected', 'modified', 'executed', 'failed', 'expired'].map((st, i) => ({ ...sug(20 + i, { kind: i % 2 ? 'pause' : 'budget_up' }), status: st, decided_by: 'a@b.c', decided_at: '2026-11-10T09:00:00Z', note: '' }));

const posts = [
  { id: 'p1', platforms: ['instagram'], body: 'x', publish_at: new Date(Date.now() + 36e5).toISOString(), status: 'scheduled', approved_at: null, results: {}, compliance: [] },
  { id: 'p2', platforms: ['facebook', 'instagram'], body: 'x', publish_at: new Date(Date.now() - 36e5).toISOString(), status: 'partial', approved_at: '2026-11-10T08:00:00Z', approved_by: 'a@b.c', results: { facebook: { ok: true, id: '1_2' }, instagram: { ok: false, code: 'no_media' } }, compliance: [] },
];
const platforms = { facebook: { name: 'فيسبوك', max: 99, live: true }, instagram: { name: 'انستقرام', max: 99, live: true }, snapchat: { name: 'سناب شات', max: 99, live: false } };

const FINDINGS = [
  ['critical', 'بيانات ميتا واقفة من 6 أيام', 'آخر يوم فيه أرقام: 2026-11-04.', 'افتح صفحة الربط وتأكد إن الربط شغال، أو أعد الربط. بعدها التحديث القادم يسحب الأيام الناقصة.'],
  ['critical', 'ميتا: صرف على الليدز وصفر ليدز من المنصة كلها', 'آخر 7 أيام: 1,200 ر.س. أمثلة: Smoke ad A، Smoke ad B.', 'غالباً حدث التحويل ما يوصل: افحص البكسل أو النموذج في مدير الإعلانات، وتأكد إن الحدث المختار في الحملة هو نفسه اللي يطلع من الموقع.'],
  ['warn', '3 إعلان ليدز في سناب شات صرف بدون ولا ليد', 'آخر 7 أيام: 400 ر.س. أمثلة: Smoke ad A.', 'راجع هالإعلانات: لو الفورم أو الرابط شغال والمشكلة بالأداء، وقفها من لوحة القرارات. لو الليدز توصل للـ CRM بس ما تنحسب، المشكلة بالتتبع.'],
  ['warn', 'ميتا: تعذّر مطابقة الليدز مع الـ CRM', 'المنصة سجلت 50 ليد آخر 7 أيام، وما لقينا ولا ليد في الـ CRM بمصدر من مصادر ميتا.', 'تأكد من اسم المصدر في الـ CRM لهالمنصة (مثل snapchat_form)، ومن إن ربط النماذج بالـ CRM شغال. لين نتأكد، ما نقدر نقول إن الليدز ضاعت.'],
  ['warn', 'تيك توك: الليدز في المنصة 40 وفي الـ CRM 12', 'فرق 70% آخر 7 أيام.', 'ليدز تضيع بين المنصة والـ CRM: تأكد إن ربط النماذج (Lead forms) بالـ CRM شغال لكل حملة.'],
  ['warn', '45% من ليدز meta_form بدون رقم إعلان', '90 من 200 ليد آخر 30 يوم ما نقدر نربطها بإعلانها.', 'خل نموذج الليد أو رابط الواتساب يمرر رقم الإعلان (ad_id) للـ CRM، مثل {{ad.id}} في ميتا و __CID__ في سناب.'],
  ['info', 'جوجل: ما فيه تحويلات من السيرفر (CAPI)', 'المنصة تعتمد على البكسل بالمتصفح بس، واللي يحجب الكوكيز ما ينحسب.', 'اربط Conversions API من صفحة الربط عشان المنصة تتعلم من الليدز الحقيقية.'],
  ['warn', 'ربط ميتا ينتهي بعد 5 أيام', 'تاريخ الانتهاء: 2026-11-15.', 'افتح صفحة الربط واضغط "أعد الربط".'],
  ['critical', 'ربط snap منتهي', 'تاريخ الانتهاء: 2026-11-01.', 'افتح صفحة الربط واضغط "أعد الربط".'],
  ['warn', '7 إعلان نشط رابطه بدون UTM', 'أمثلة: Smoke ad A، Smoke ad B.', 'أضف utm_source و utm_medium و utm_campaign لرابط الإعلان (أو Tracking template في جوجل).'],
  ['critical', 'ما قدرت أقرأ أرقام الإعلانات', 'ما وصلتنا الأرقام اليومية للإعلانات.', 'بلّغ الإدارة تتأكد إن التحديث كل ساعة شغال.'],
].map(([level, title, detail, fix], i) => ({ id: 'f' + i, level, title, detail, fix }));

// The action names the Permissions page can show
const ACTIONS = [...readFileSync('public/assets/admin.js', 'utf8').match(/const ACT = \{([^}]*)\}/)![1]!.matchAll(/(\w+):/g)].map(m => m[1]!);

const arabicLeft = (page: Page) => page.evaluate(() => {
  const out = new Set<string>(); const A = /[؀-ۿ]/;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const p = n.parentElement!; if (/^(SCRIPT|STYLE|TEXTAREA)$/.test(p.tagName) || p.closest('[data-user-text]')) continue; const v = (n.nodeValue || '').trim(); if (A.test(v)) out.add(v); }
  for (const el of document.querySelectorAll('*')) { if (el.closest('[data-user-text]')) continue; for (const a of ['placeholder', 'aria-label', 'data-tip', 'title']) { const v = el.getAttribute(a); if (v && A.test(v)) out.add(`${a}: ${v}`); } }
  out.delete('عربي');                                  // the language button names itself
  return [...out].map(s => s.slice(0, 120));
});

test.describe('English leaves no Arabic', () => {
  test.beforeEach(async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.setViewportSize({ width: 1500, height: 900 });
  });

  test('decisions board: inbox, panel, history, learning, rules', async ({ page }) => {
    await page.route('**/api/control/suggestions', r => r.request().method() === 'GET' ? r.fulfill({ json: { open: OPEN, done: DONE } }) : r.continue());
    await page.route('**/api/control/settings', r => r.fulfill({ json: { settings: [], owner: true } }));
    await page.route('**/control/ads.json', r => r.fulfill({ json: { ads: {}, generated_at: '2026-11-10T08:00:00Z' } }));
    await page.route('**/api/control/kill', r => r.fulfill({ json: { kill: true, by: 'a@b.c', at: '2026-11-10T08:00:00Z', canary: ['Smoke campaign'] } }));
    await page.goto('/control/?lang=en');
    await page.locator('#inbox tbody tr').first().waitFor();
    expect(await arabicLeft(page), 'inbox').toEqual([]);
    await page.locator('#inbox tbody tr').first().click();
    await page.waitForTimeout(400);
    expect(await arabicLeft(page), 'a suggestion opened').toEqual([]);
    await page.keyboard.press('Escape');
    for (const tab of ['log', 'learn', 'rules']) {
      await page.goto(`/control/?tab=${tab}&lang=en`);
      await page.waitForTimeout(900);
      expect(await arabicLeft(page), `tab ${tab}`).toEqual([]);
    }
  });

  test('social: form, chips, calendar', async ({ page }) => {
    await page.route('**/api/social/posts*', r => r.fulfill({ json: { posts, platforms, ready: { facebook: '', instagram: 'x', snapchat: 'النشر التلقائي لهالمنصة قريباً: بينحفظ كتذكير' }, account: { page: 'p', instagram: null, pick: false } } }));
    await page.route('**/api/social/approvers*', r => r.fulfill({ json: { approvers: ['a@b.c'], canApprove: true, owner: true, people: [{ email: 'a@b.c', name: 'Ali' }] } }));
    await page.goto('/social/?lang=en');
    await page.locator('#plats .so-pl').first().waitFor();
    expect(await arabicLeft(page)).toEqual([]);
  });

  test('permissions: users and every action name in the log', async ({ page }) => {
    await page.route('**/api/admin/log*', r => r.fulfill({ json: { log: ACTIONS.map((a, i) => ({ at: '2026-11-10T08:00:00Z', email: 'a@b.c', action: a, target: { email: 'u@b.c' }, note: '', id: i })) } }));
    await page.goto('/admin/?lang=en');
    await page.locator('#log table').waitFor();
    expect(await arabicLeft(page)).toEqual([]);
  });

  test('debugger: every kind of finding', async ({ page }) => {
    await page.route('**/api/debugger/report', r => r.fulfill({ json: { summary: { critical: 4, warn: 5, info: 1 }, counts: { leads: 120 }, linked: { leadsPct: 60, linked: 72, leads: 120, closingsPct: 40, closingsLinked: 4, closings: 10, closingsUnlinked: 6 },
      platforms: { meta: { spend7: 100, leads7: 5, crm7: 4, lastDay: '2026-11-09' } }, findings: FINDINGS, checked_at: '2026-11-10T08:00:00Z' } }));
    await page.goto('/debugger/?lang=en');
    await page.locator('.dg-f').first().waitFor();
    expect(await arabicLeft(page)).toEqual([]);
  });
});
