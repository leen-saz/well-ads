// Smoke suite (synthetic data only). The real built Worker, a fake Supabase, no network. See docs/smoke-tests.md.
import { test, expect } from '@playwright/test';
import { login, addSession, emailFor } from './helpers';
import { CORE_KEYS, MODULE_KEYS } from './keys';
import { LIVE, MODULES } from '../../src/modules/registry';

const BASE = `http://localhost:${process.env['SMOKE_PORT'] || 8787}`;
// Each live tab: its page and its main read-only API
const TABS: { key: string; page: string; api: string }[] = [
  { key: 'overview', page: '/overview/', api: '/api/overview/data' },
  { key: 'listening', page: '/listening/', api: '/api/listening/demand' },
  { key: 'design', page: '/design/', api: '/api/design/options' },
  { key: 'video', page: '/voice/?tab=video', api: '/api/video/engines' },
  { key: 'copy', page: '/content/?tab=copy', api: '/api/copy/projects' },
  { key: 'voice', page: '/voice/', api: '/api/voice/guide' },
  { key: 'transcribe', page: '/voice/?tab=transcribe', api: '/api/transcribe/jobs' },
  { key: 'vision', page: '/design/?tab=vision', api: '/api/vision/recent' },
  { key: 'voiceover', page: '/voice/?tab=voiceover', api: '/api/voiceover/guide' },
  { key: 'social', page: '/social/', api: '/api/social/posts' },
  { key: 'content', page: '/content/', api: '/api/content/plans' },
  { key: 'journeys', page: '/journeys/', api: '/api/journeys/list' },
  { key: 'compliance', page: '/compliance/', api: '/api/compliance/scan' },
  { key: 'maestro', page: '/maestro/', api: '/api/maestro/state' },
  { key: 'knowledge', page: '/knowledge/', api: '/api/knowledge/list' },
  { key: 'debugger', page: '/debugger/', api: '/api/debugger/report' },
];
const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

test('the suite covers every live module', () => {
  expect([...MODULE_KEYS].sort()).toEqual([...LIVE].sort());
  expect(TABS.map(t => t.key).sort()).toEqual([...LIVE].sort());
});

test('the old addresses of the sections open them inside Design, Voice and Content', async ({ request }) => {
  const cookie = (await login(request, 'owner')).header;
  for (const [old, now] of [['/voiceover/', '/voice/?tab=voiceover'], ['/copy/', '/content/?tab=copy'], ['/vision/', '/design/?tab=vision'], ['/transcribe/', '/voice/?tab=transcribe'], ['/video/', '/voice/?tab=video']]) {
    const r = await request.get(old, { headers: { cookie }, maxRedirects: 0 });
    expect(r.status(), old).toBe(302);
    expect(r.headers()['location'], old).toContain(now);
  }
});

test.describe('health and sign-in', () => {
  test('/api/health answers without a login', async ({ request }) => {
    const r = await request.get('/api/health');
    expect(r.status()).toBe(200);
    const h = await r.json();
    // Public answer is only ok + version; the details and the sources probe need a login
    expect(h).toEqual({ ok: true, version: 'smoke-build' });
    expect((await request.get('/api/health/details')).status()).toBe(401);
    expect((await request.get('/api/listening/probe', { headers: { 'x-probe-secret': 'wrong' } })).status()).toBe(401);
  });
  test('signed out: pages go to the login page, the API answers 401 JSON', async ({ request }) => {
    const p = await request.get('/overview/', { maxRedirects: 0 });
    expect(p.status()).toBe(302);
    expect(p.headers()['location']).toContain('/login/?next=');
    const a = await request.get('/api/listening/demand');
    expect(a.status()).toBe(401);
    expect(hasArabic((await a.json()).error)).toBe(true);
  });
  test('wrong password is refused with an Arabic JSON error, no cookie', async ({ request }) => {
    const r = await request.post('/api/auth/login', { data: { email: emailFor('owner'), password: 'wrong-synthetic' }, headers: { origin: BASE } });
    expect(r.status()).toBe(401);
    expect(hasArabic((await r.json()).error)).toBe(true);
    expect(r.headers()['set-cookie']).toBeUndefined();
  });
  test('login from another origin is refused', async ({ request }) => {
    const r = await request.post('/api/auth/login', { data: { email: emailFor('owner'), password: 'x' }, headers: { origin: 'https://evil.example' } });
    expect(r.status()).toBe(403);
  });
  test('a tampered cookie is not a session', async ({ request }) => {
    const c = await login(request, 'owner');
    const bad = c.header.slice(0, -3) + 'AAA';
    const r = await request.get('/api/listening/demand', { headers: { cookie: bad } });
    expect(r.status()).toBe(401);
  });
  test('the login page opens', async ({ request }) => {
    const r = await request.get('/login/');
    expect(r.status()).toBe(200);
    expect(await r.text()).toContain('<html');
  });
});

test.describe('each live tab, by permission', () => {
  for (const t of TABS) {
    test(`${t.key}: allowed user opens page and API`, async ({ request }) => {
      const cookie = (await login(request, `u-${t.key}`)).header;
      const page = await request.get(t.page, { headers: { cookie }, maxRedirects: 0 });
      expect(page.status(), `page ${t.page}`).toBe(200);
      expect(await page.text()).toContain('<html');
      const api = await request.get(t.api, { headers: { cookie } });
      expect(api.status(), `api ${t.api}`).toBe(200);
      expect(api.headers()['content-type']).toContain('application/json');
    });
    test(`${t.key}: a user without it is refused (page goes to /today/, API 403 in Arabic)`, async ({ request }) => {
      const cookie = (await login(request, 'nobody')).header;
      const page = await request.get(t.page, { headers: { cookie }, maxRedirects: 0 });
      expect(page.status()).toBe(302);
      expect(page.headers()['location']).toContain('/today/');
      const api = await request.get(t.api, { headers: { cookie } });
      expect(api.status()).toBe(403);
      expect(hasArabic((await api.json()).error)).toBe(true);
    });
    test(`${t.key}: another tab's permission does not open it`, async ({ request }) => {
      const other = t.key === 'knowledge' ? 'listening' : 'knowledge';
      const cookie = (await login(request, `u-${other}`)).header;
      const api = await request.get(t.api, { headers: { cookie } });
      expect(api.status()).toBe(403);
    });
  }
  test('the owner opens every tab', async ({ request }) => {
    const cookie = (await login(request, 'owner')).header;
    for (const t of TABS) {
      expect((await request.get(t.page, { headers: { cookie }, maxRedirects: 0 })).status(), t.page).toBe(200);
      expect((await request.get(t.api, { headers: { cookie } })).status(), t.api).toBe(200);
    }
    expect((await request.get('/admin/', { headers: { cookie }, maxRedirects: 0 })).status()).toBe(200);
  });
  test('the permissions page is the owner only', async ({ request }) => {
    const cookie = (await login(request, 'u-control')).header;
    expect((await request.get('/api/admin/users', { headers: { cookie } })).status()).toBe(403);
    // The performance card of the data-health page is the owner's too
    expect((await request.get('/api/maestro/vitals', { headers: { cookie } })).status()).toBe(403);
    const owner = (await login(request, 'owner')).header;
    const v = await request.get('/api/maestro/vitals', { headers: { cookie: owner } });
    expect(v.status()).toBe(200);
    expect(await v.json()).toMatchObject({ hours: 24, pages: [] });
  });
});

test.describe('core dashboards', () => {
  const CORE = [{ key: 'control', page: '/control/' }, { key: 'connectors', page: '/connectors/' }, { key: 'ceo', page: '/' }];
  for (const c of CORE) {
    test(`${c.key}: allowed opens, others are sent to /today/`, async ({ request }) => {
      const ok = (await login(request, `u-${c.key}`)).header;
      const got = await request.get(c.page, { headers: { cookie: ok }, maxRedirects: 0 });
      expect(got.status()).toBe(200);
      expect(await got.text()).toContain('<html');
      const no = (await login(request, 'nobody')).header;
      const r = await request.get(c.page, { headers: { cookie: no }, maxRedirects: 0 });
      expect(r.status()).toBe(302);
      expect(r.headers()['location']).toContain('/today/');
    });
  }
  test('every signed-in user opens the start page', async ({ request }) => {
    const cookie = (await login(request, 'nobody')).header;
    expect((await request.get('/today/', { headers: { cookie } })).status()).toBe(200);
    expect(CORE_KEYS.length).toBeGreaterThan(0);
  });
});

test.describe('old URLs redirect', () => {
  const REDIRECTS: [string, string][] = [
    ['/maestro/video', '/design/?type=motion'],
    ['/design/video', '/design/?type=motion'],
    ['/history', '/control/?tab=log'],
    ['/review/history', '/control/?tab=log'],
    ['/analytics', '/'],
    ['/home', '/today/'],
    ['/start', '/today/'],
    ['/permissions', '/admin/'],
  ];
  for (const [from, to] of REDIRECTS) {
    test(`${from} → ${to}`, async ({ request }) => {
      const cookie = (await login(request, 'nobody')).header;
      const r = await request.get(from, { headers: { cookie }, maxRedirects: 0 });
      expect(r.status()).toBe(302);
      expect(r.headers()['location']).toBe(BASE + to);
    });
  }
  test('an old link keeps its ?id=', async ({ request }) => {
    const cookie = (await login(request, 'nobody')).header;
    const r = await request.get('/maestro/video?id=abc', { headers: { cookie }, maxRedirects: 0 });
    expect(r.headers()['location']).toBe(`${BASE}/design/?type=motion&id=abc`);
  });
  test('destination links open the first tool the user may open', async ({ request }) => {
    const l = (await login(request, 'u-listening')).header;
    expect((await request.get('/performance/', { headers: { cookie: l }, maxRedirects: 0 })).headers()['location']).toBe(`${BASE}/listening/`);
    const n = (await login(request, 'nobody')).header;
    expect((await request.get('/system/', { headers: { cookie: n }, maxRedirects: 0 })).headers()['location']).toBe(`${BASE}/today/`);
  });
});

test.describe('sidebar and language (browser)', () => {
  test('the sidebar draws only what the user may open, with no locked rows', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'u-listening'));
    await page.goto('/listening/');
    // One accessible tool in the group: a plain entry (no expander). The Production entry opens the one tool this user may open (the library).
    await expect(page.locator('a.navi.nv-p[data-grp="measure"][aria-current="page"]')).toHaveAttribute('href', '/listening/');
    await expect(page.locator('.nv-h')).toHaveCount(0);
    await expect(page.locator('[data-gtabs]')).toHaveCount(0);
    await expect(page.locator('a.navi[data-grp="produce"]')).toHaveAttribute('href', '/library/');
    await expect(page.locator('a.navi[data-grp="optimize"], a.navi[data-grp="distribute"]')).toHaveCount(0);
    // No locked rows: what the user cannot open is not shown
    await expect(page.locator('span.navi.locked')).toHaveCount(0);
    await expect(page.locator('a.navi[data-grp="system"]')).toHaveCount(0);
  });
  test('Production hosts its sections: ?tab= opens the section and the old addresses go there', async ({ page, context, request }) => {
    const o = await login(request, 'owner');
    await addSession(context, o);
    for (const [from, to] of [['/vision/', '/design/?tab=vision'], ['/transcribe/', '/voice/?tab=transcribe'], ['/video/', '/voice/?tab=video'], ['/voiceover/', '/voice/?tab=voiceover'], ['/copy/', '/content/?tab=copy']] as const) {
      const r = await request.get(from, { headers: { cookie: o.header }, maxRedirects: 0 });
      expect(r.headers()['location'], from).toBe(`${BASE}${to}`);
    }
    await page.goto('/voice/?tab=video');
    await expect(page.locator('#tabsw .sec-tab[aria-current="page"]')).toBeVisible();
    await expect(page.locator('#tabsw .sec-tab')).toHaveCount(4);
    await expect(page.locator('a.navi[data-grp="produce"][aria-current="page"]')).toBeVisible();
    await expect(page.locator('.nv-i[data-k="voice"][aria-current="page"]')).toBeVisible();
    await expect(page.locator('[data-gtabs]')).toHaveCount(0);
  });
  test('the owner sees every live tab and the permissions page', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto('/today/');
    // Every live tool is a sub-tab of a group (sections, voiceover, transcribe, video, vision, copy, are tabs inside Voice, Design and Content)
    await expect(page.locator('[data-nv] [data-ks]')).toHaveCount(6);
    const ks = (await page.locator('[data-nv] [data-ks]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset['ks']!.split(',')))).flat();
    for (const k of LIVE.filter(k => !MODULES.find(m => m.key === k)?.into)) expect(ks, k).toContain(k);
    for (const k of LIVE.filter(k => MODULES.find(m => m.key === k)?.into)) expect(ks, k).not.toContain(k);
    expect(ks).toContain('admin');
  });
  for (const lang of ['ar', 'en'] as const) {
    test(`${lang}: without analytics access the Measure group offers no page that answers 403, and the summary explains instead of leaking the refusal`, async ({ page, context, request }) => {
      await addSession(context, await login(request, 'ovnoceo'));
      await page.goto(`/listening/?lang=${lang}`);
      await expect(page.locator('#nv-measure .nv-i')).toHaveText(lang === 'en' ? ['Creatives', 'Social listening'] : ['المواد الإعلانية', 'الرصد']);
      await page.goto(`/overview/?lang=${lang}`);
      const msg = page.locator('.no-ceo-msg');
      await expect(msg).toBeVisible();
      await expect(msg).toContainText(lang === 'en' ? 'needs access to the analytics numbers' : 'يحتاج صلاحية أرقام التحليلات');
      await expect(page.locator('#content')).not.toContainText('ما عندك صلاحية على أرقام التحليلات');
    });
    test(`${lang}: the owner's Measure group lists overview, platforms and campaigns, departments, creatives and listening under it`, async ({ page, context, request }) => {
      await addSession(context, await login(request, 'owner'));
      await page.goto(`/overview/?lang=${lang}`);
      await expect(page.locator('#nv-measure .nv-i')).toHaveText(lang === 'en' ? ['Overview', 'Platforms and campaigns', 'Departments', 'Creatives', 'Social listening'] : ['نظرة عامة', 'المنصات والحملات', 'الأقسام', 'المواد الإعلانية', 'الرصد']);
      await expect(page.locator('.nv-h[data-grp="measure"]')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#nv-measure .nv-i[aria-current="page"]')).toHaveAttribute('href', '/overview/');
      await expect(page.locator('[data-nv] > a.navi, [data-nv] .nv-g > .nv-h')).toHaveCount(6);   // six groups: no second entry for these pages
      await expect(page.locator('[data-gtabs], .gtabs, nav.settings-tabs')).toHaveCount(0);   // no tab strip inside the page
    });
  }
  test('a group expands and collapses (click and keys), remembers it on this device, and opens while one of its pages is open', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto('/today/');
    const head = (g: string) => page.locator(`.nv-h[data-grp="${g}"]`);
    await expect(page.locator('a.nv-p[data-grp="home"]')).toHaveText('أحلم');
    await expect(head('produce')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#nv-produce')).toBeHidden();
    await head('produce').click();
    await expect(head('produce')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#nv-produce .nv-i')).toHaveText(['نص', 'التصميم', 'صوت وفيديو', 'المكتبة']);
    // remembered after a reload
    await page.reload();
    await expect(head('produce')).toHaveAttribute('aria-expanded', 'true');
    // keys: Space/Enter toggle, arrows move (right-to-left: the left arrow opens, the right arrow closes)
    await head('produce').focus();
    await page.keyboard.press('ArrowRight');
    await expect(head('produce')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowLeft');
    await expect(head('produce')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#nv-produce .nv-i').first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(head('produce')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(head('produce')).toHaveAttribute('aria-expanded', 'false');
    // opening a page of a closed group opens the group and marks the page
    await page.goto('/design/');
    await expect(head('produce')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#nv-produce .nv-i[data-k="design"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-gtabs]')).toHaveCount(0);
  });
  test('English: the group header and its sub-items are English and open left to right', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto('/overview/?lang=en');
    await expect(page.locator('.nv-h[data-grp="measure"] span')).toHaveText('Measure');
    await page.keyboard.press('Tab');
    await page.locator('.nv-h[data-grp="measure"]').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.nv-h[data-grp="measure"]')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.nv-h[data-grp="measure"]')).toHaveAttribute('aria-expanded', 'true');
  });
  test('the board views open from the sidebar as views of the one board, and the old addresses land on them', async ({ page, context, request }) => {
    const o = await login(request, 'owner');
    await addSession(context, o);
    const r = await request.get('/overview/creative/?lang=en', { headers: { cookie: o.header }, maxRedirects: 0 });
    expect(r.headers()['location']).toBe(`${BASE}/?view=creative&lang=en`);
    await page.goto('/overview/');
    await page.locator('#nv-measure .nv-i[href="/?p=channels"]').click();
    await expect(page).toHaveURL(/\/\?p=channels/);
    // (the board page is a stub in the smoke setup: its sidebar and its hidden tab row are not exercised here)
  });
  test('the language switch flips the page to English, left to right, and back', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto('/today/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('[data-lang="en"]').first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.locator('[data-lang="ar"]').first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });
});

test.describe('connectors: a platform pulled through GitHub secrets is not «not connected»', () => {
  test('the list says github for Meta (ad written) and Snapchat (metric day), none for Google, and carries no figures', async ({ request }) => {
    const c = await login(request, 'owner');
    const r = await request.get('/api/connectors/list', { headers: { cookie: c.header } });
    expect(r.status()).toBe(200);
    const { platforms } = await r.json() as { platforms: { id: string; status: string; lastPull: string | null }[] };
    const st = Object.fromEntries(platforms.map(p => [p.id, p.status]));
    expect(st).toMatchObject({ meta: 'github', snap: 'github', google_ads: 'none' });
    expect(platforms.find(p => p.id === 'meta')?.lastPull).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(platforms.find(p => p.id === 'google_ads')?.lastPull).toBeNull();
  });
  for (const [lang, on, off] of [['ar', 'يشتغل تلقائياً', 'مو مربوط'], ['en', 'Runs automatically', 'Not connected']] as const) {
    test(`the page shows the chip in ${lang}, distinct from the not-connected one`, async ({ page, context, request }) => {
      await addSession(context, await login(request, 'owner'));
      await page.goto(`/connectors/?lang=${lang}`);
      await expect(page.locator('.chip', { hasText: on }).first()).toBeVisible();
      await expect(page.locator('.chip', { hasText: off }).first()).toBeVisible();
    });
  }
});
