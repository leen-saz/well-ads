// Smoke suite (synthetic data only). The real built Worker, a fake Supabase, no network. See docs/smoke-tests.md.
import { test, expect } from '@playwright/test';
import { login, addSession, emailFor } from './helpers';
import { CORE_KEYS, MODULE_KEYS } from './keys';
import { LIVE } from '../../src/modules/registry';

const BASE = 'http://localhost:8787';
// Each live tab: its page and its main read-only API
const TABS: { key: string; page: string; api: string }[] = [
  { key: 'overview', page: '/overview/', api: '/api/overview/data' },
  { key: 'listening', page: '/listening/', api: '/api/listening/demand' },
  { key: 'design', page: '/design/', api: '/api/design/options' },
  { key: 'copy', page: '/copy/', api: '/api/copy/projects' },
  { key: 'voice', page: '/voice/', api: '/api/voice/guide' },
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

test.describe('health and sign-in', () => {
  test('/api/health answers without a login', async ({ request }) => {
    const r = await request.get('/api/health');
    expect(r.status()).toBe(200);
    const h = await r.json();
    expect(h).toEqual({ ok: true, version: 'smoke-build', env: 'local', checks: { supabase: 'up', storage: 'up', ai: 'unset' } });
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
  test('the sidebar draws an entry per permission, locked ones for the rest', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'u-listening'));
    await page.goto('/listening/');
    await expect(page.locator('a.navi[data-k="listening"]')).toBeVisible();
    await expect(page.locator('a.navi[data-k="design"]')).toHaveCount(0);
    await expect(page.locator('span.navi.locked').first()).toBeVisible();
    await expect(page.locator('a.navi[data-k="admin"]')).toHaveCount(0);
  });
  test('the owner sees every live tab and the permissions page', async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.goto('/today/');
    for (const k of LIVE) await expect(page.locator(`a.navi[data-k="${k}"]`).first(), k).toBeVisible();
    await expect(page.locator('a.navi[data-k="admin"]')).toBeVisible();
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
