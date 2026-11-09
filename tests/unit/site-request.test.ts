// The public request form: field checks (src/lib/site-request.ts) and the route (src/api/routes/site.ts).
// Synthetic people and numbers only; fetch is stubbed, so nothing leaves the test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { need } from '../../src/lib/gate';
import { cleanRequest, phone, ipKey, LIMIT_PER_HOUR } from '../../src/lib/site-request';

const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.test' };
const cfg = A.env(E);
const owner: A.Profile = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', role: 'owner', active: true };
const member: A.Profile = { id: '22222222-2222-4222-8222-222222222222', email: 'm@example.test', role: 'member', dashboards: ['creative'], active: true };
const good = { kind: 'security', name: 'سارة', company: 'شركة تجربة', phone: '٠٥٠١٢٣٤٥٦٧', email: 'Test@Example.com', scope: ['web', 'nope', 'web'], message: 'نبي فحص', consent: true, page: '/security/', lang: 'ar', t: 9000 };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('request fields', () => {
  it('Saudi mobiles in any shape become +9665…, other countries keep their code', () => {
    for (const v of ['0501234567', '501234567', '966501234567', '+966 50 123 4567', '00966501234567', '٠٥٠١٢٣٤٥٦٧']) expect(phone(v)).toBe('+966501234567');
    expect(phone('+971501234567')).toBe('+971501234567');
    for (const v of ['0401234567', '05012345', 'abc', '', '+966401234567']) expect(phone(v)).toBeNull();
  });
  it('a good request is cleaned: email lowercased, scope deduped and limited to known values', () => {
    const c = cleanRequest(good);
    expect(c).toEqual({ ok: true, data: { kind: 'security', name: 'سارة', company: 'شركة تجربة', phone: '+966501234567', email: 'test@example.com', scope: ['web'], message: 'نبي فحص', page: '/security/', lang: 'ar' } });
  });
  it('scope only for audits, unknown kind and page fall back', () => {
    const c = cleanRequest({ ...good, kind: 'hack', page: '/admin/' });
    expect(c.ok && c.data).toMatchObject({ kind: 'other', scope: [], page: '/' });
  });
  it('every problem comes back keyed by field', () => {
    const c = cleanRequest({ name: 'x', phone: '123', email: 'bad', consent: false, t: 9000 });
    expect(c.ok).toBe(false);
    expect(Object.keys((c as { errors: object }).errors).sort()).toEqual(['consent', 'email', 'name', 'phone']);
  });
  it('the honeypot and a too-fast submit are treated as a bot', () => {
    expect(cleanRequest({ ...good, website: 'http://spam' })).toEqual({ ok: false, bot: true });
    expect(cleanRequest({ ...good, t: 300 })).toEqual({ ok: false, bot: true });
  });
  it('the visitor key is not the address, and changes by day', async () => {
    const a = await ipKey('203.0.113.9', cfg.secret, '2026-11-09');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain('203');
    expect(await ipKey('203.0.113.9', cfg.secret, '2026-11-09')).toBe(a);
    expect(await ipKey('203.0.113.9', cfg.secret, '2026-11-10')).not.toBe(a);
  });
});

type Seen = { url: string; method: string; body?: string };
function world({ who = null as A.Profile | null, recent = 0, rows = [] as unknown[], storeStatus = 201 } = {}) {
  const seen: Seen[] = [];
  vi.stubGlobal('fetch', async (u: string | URL, init?: RequestInit) => {
    const url = String(u), method = init?.method ?? 'GET';
    seen.push({ url, method, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    if (url.includes('/profiles')) return new Response(JSON.stringify(who ? [who] : []), { status: 200 });
    if (url.includes('/site_requests') && method === 'GET' && url.includes('ip_key=eq.')) return new Response(JSON.stringify(Array.from({ length: recent }, (_, i) => ({ id: i }))), { status: 200 });
    if (url.includes('/site_requests') && method === 'GET') return new Response(JSON.stringify(rows), { status: 200 });
    if (url.includes('/site_requests') && method === 'POST') return new Response('', { status: storeStatus });
    return new Response(null, { status: 204 });
  });
  return seen;
}
const send = (body: unknown, headers: Record<string, string> = {}, env: Record<string, string> = E) =>
  api.request('https://well.example/api/site/request', { method: 'POST', body: JSON.stringify(body), headers: { origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...headers } }, env);
const asUser = async (p: A.Profile, path: string, init: RequestInit = {}) =>
  api.request('https://well.example' + path, { ...init, headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } }, E);

describe('POST /api/site/request', () => {
  it('is public in the gate; the inbox is the owner\'s', () => {
    expect(need('/api/site/request', '')).toBeNull();
    expect(need('/api/site/requests', '')).toBe('owner');
    expect(need('/admin/requests/', '')).toBe('owner');
  });
  it('stores the request with consent time and a visitor key, never the address; the log has no phone', async () => {
    const seen = world();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await send(good);
    expect(r.status).toBe(200);
    const post = seen.find(s => s.url.endsWith('/rest/v1/site_requests') && s.method === 'POST')!;
    const row = JSON.parse(post.body!);
    expect(row).toMatchObject({ kind: 'security', phone: '+966501234567', scope: ['web'] });
    expect(row.consent_at).toMatch(/^\d{4}-/);
    expect(row.ip_key).toMatch(/^[0-9a-f]{32}$/);
    expect(post.body).not.toContain('203.0.113.9');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/9665|سارة|example\.com/);
  });
  it('a cross-site post is refused before anything is read or stored', async () => {
    const seen = world();
    expect((await send(good, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(seen).toEqual([]);
  });
  it('a bot gets OK and nothing is stored', async () => {
    const seen = world();
    expect((await send({ ...good, website: 'spam' })).status).toBe(200);
    expect(seen.some(s => s.method === 'POST')).toBe(false);
  });
  it('field errors come back per field, nothing stored', async () => {
    const seen = world();
    const r = await send({ ...good, phone: '12', consent: false });
    expect(r.status).toBe(400);
    expect(Object.keys((await r.json() as { fields: object }).fields).sort()).toEqual(['consent', 'phone']);
    expect(seen.some(s => s.method === 'POST')).toBe(false);
  });
  it(`the ${LIMIT_PER_HOUR + 1}th request from one visitor in an hour waits`, async () => {
    const seen = world({ recent: LIMIT_PER_HOUR });
    expect((await send(good)).status).toBe(429);
    expect(seen.some(s => s.method === 'POST')).toBe(false);
  });
  it('a store that fails says so (and points to WhatsApp)', async () => {
    world({ storeStatus: 500 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await send(good);
    expect(r.status).toBe(503);
    expect((await r.json() as { error: string }).error).toContain('واتساب');
  });
  it('the webhook note says what was asked and where to read it, without phone or email', async () => {
    const seen = world();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await send(good, {}, { ...E, REQUESTS_WEBHOOK: 'https://hooks.example/abc' });
    const hook = seen.find(s => s.url === 'https://hooks.example/abc')!;
    expect(JSON.parse(hook.body!).text).toContain('فحص أمني');
    expect(JSON.parse(hook.body!).text).toContain('/admin/requests/');
    expect(hook.body).not.toMatch(/9665|example\.com|0501/);
  });
});

describe('/api/site/requests (owner inbox)', () => {
  it('the owner reads, filters, updates and deletes', async () => {
    const seen = world({ who: owner, rows: [{ id: 1, kind: 'board', name: 'x', phone: '+966501234567', status: 'new' }] });
    const g = await asUser(owner, '/api/site/requests?status=new');
    expect(g.status).toBe(200);
    expect((await g.json() as { requests: unknown[] }).requests).toHaveLength(1);
    expect(seen.find(s => s.url.includes('/site_requests?select='))!.url).toContain('status=eq.new');
    expect((await asUser(owner, '/api/site/requests', { method: 'PATCH', body: JSON.stringify({ id: 1, status: 'contacted' }) })).status).toBe(200);
    expect(JSON.parse(seen.find(s => s.method === 'PATCH')!.body!)).toMatchObject({ status: 'contacted' });
    expect((await asUser(owner, '/api/site/requests', { method: 'PATCH', body: JSON.stringify({ id: 1, status: 'deleted' }) })).status).toBe(400);
    expect((await asUser(owner, '/api/site/requests', { method: 'DELETE', body: JSON.stringify({ id: 1 }) })).status).toBe(200);
    expect(seen.find(s => s.method === 'DELETE')!.url).toContain('id=eq.1');
  });
  it('a member never sees them', async () => {
    world({ who: member });
    expect((await asUser(member, '/api/site/requests')).status).toBe(403);
  });
  it('before the migration, the owner is told which file to run', async () => {
    vi.stubGlobal('fetch', async (u: string) => String(u).includes('/profiles')
      ? new Response(JSON.stringify([owner]), { status: 200 })
      : new Response(JSON.stringify({ code: '42P01' }), { status: 404 }));
    const j = await (await asUser(owner, '/api/site/requests')).json() as { missing?: string };
    expect(j.missing).toContain('027_site_requests.sql');
  });
});
