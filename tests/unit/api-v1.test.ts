/* eslint-disable @typescript-eslint/no-explicit-any -- parsed JSON answers are read loosely in assertions */
// The read-only API (/api/v1/*): keys made by the owner, shown once, stored as a hash only; bearer auth, scopes, expiry, revocation,
// GET/HEAD only, rate limits that fail closed, no token in logs, and every other route still asks for a session.
// A fake Supabase and a fake R2 hold synthetic data only; the keys here are made by the code under test, none is real.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { api } from '../../src/api/index';
import { gate, need } from '../../src/lib/gate';
import { hashKey, KEY_SHAPE, LIMIT_DAY, LIMIT_MINUTE, MAX_DAYS } from '../../src/lib/apikeys';
import { keys, keyrevoke } from '../../src/lib/apikeys-admin';

const PEPPER = 'pepper-for-tests-0123456789abcdef';
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com', API_KEY_PEPPER: PEPPER } as A.AuthEnv & { API_KEY_PEPPER?: string; FILES?: unknown };
const cfg = A.env(E);
const ACME = '22222222-2222-2222-2222-222222222222';
const owner: A.Profile = { id: '33333333-3333-3333-3333-333333333333', email: 'owner@example.com', role: 'owner', active: true, company_id: WELL_COMPANY };
const member: A.Profile = { id: '44444444-4444-4444-4444-444444444444', email: 'm@example.com', role: 'member', active: true, company_id: WELL_COMPANY, access: { ceo: 'view' } };
const acmeOwner: A.Profile = { ...owner, id: '55555555-5555-5555-5555-555555555555', email: 'boss@acme.example', company_id: ACME };
const cookieFor = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const adminReq = async (path: string, p: A.Profile, method = 'GET', body?: unknown) => new Request('https://well.example' + path,
  { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { cookie: await cookieFor(p), origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } });

// ---- synthetic dashboard data (dash.json shape: ads, columnar daily rows, a CRM block with lead rows)
const DASH = {
  generated_at: '2026-11-10T00:00:00Z', range: { start: '2026-11-01', end: '2026-11-10', today: '2026-11-10' },
  ads: { m1: { name: 'Ad one', campaign: 'C1', platform: 'facebook', goal: 'lead', status: 'ACTIVE', live: true, aud: { secret: 'x' } }, s1: { name: 'Ad two', campaign: 'C2', platform: 'snap', goal: 'lead', status: 'PAUSED', live: false } },
  rows_cols: { k: ['m1', 's1'], d: ['2026-11-05', '2026-11-10'], c: [[0, 0, 1], [0, 1, 1], [100, 50, 80], [1000, 500, 900], [20, 10, 15], [5, 2, 4], [0, 0, 0]] },
  crm: { rows: [['m1', '2026-11-05', '2026-11-08', 1, 700], ['m1', '2026-11-06', null, 0, 0], ['s1', '2026-11-10', null, 0, 0]], paid_all: [['2026-11-05', '2026-11-08', 700, 'meta']], unmatched: 4, total: 9, stats: { by_source: { meta: [3, 3, 1] } } },
  funnel_targets: {},
};

type KeyRow = { id: string; company_id: string; name: string; key_hash: string; prefix: string; scopes: string[]; created_by: string | null; created_at: string; expires_at: string; last_used_at: string | null; use_count: number; revoked_at: string | null };
interface Opts { noTable?: boolean; failCounter?: boolean; profiles?: A.Profile[]; hits?: { m: number; d: number } }
const omitHash = (r: KeyRow): Omit<KeyRow, 'key_hash'> => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'key_hash')) as Omit<KeyRow, 'key_hash'>;
function world(opts: Opts = {}) {
  const store: KeyRow[] = [];
  const audits: Record<string, unknown>[] = [];
  const log: { url: string; method: string; body?: unknown }[] = [];
  const hits = { m: opts.hits?.m ?? 0, d: opts.hits?.d ?? 0 };
  const profiles = opts.profiles ?? [owner, acmeOwner, member];
  const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const url = String(u), method = init.method || 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    log.push({ url, method, body });
    const path = url.replace('https://sb.example', '');
    const missing = () => j({ code: 'PGRST205', message: 'no table' }, 404);
    const pm = path.match(/^\/rest\/v1\/profiles\?id=eq\.([0-9a-f-]{36})/);
    if (pm) return j(profiles.filter(p => p.id === pm[1]));
    if (path.startsWith('/rest/v1/audit_log')) { audits.push(body); return j({}, 201); }
    if (path.startsWith('/rest/v1/rpc/api_key_hit')) {
      if (opts.noTable) return missing();
      if (opts.failCounter) return j({ message: 'down' }, 500);
      const k = store.find(x => x.id === body.p_key); if (!k) return j([]);
      k.use_count++; k.last_used_at = new Date().toISOString(); hits.m++; hits.d++;
      return j([{ minute_n: hits.m, day_n: hits.d }]);
    }
    if (path.startsWith('/rest/v1/api_keys')) {
      if (opts.noTable) return missing();
      if (method === 'POST') {
        const row: KeyRow = { id: crypto.randomUUID(), created_at: new Date().toISOString(), last_used_at: null, use_count: 0, revoked_at: null, ...body };
        store.push(row);
        return j([omitHash(row)], 201);   // select= names the list columns: the hash is not among them
      }
      if (method === 'PATCH') {
        const id = path.match(/id=eq\.([0-9a-f-]{36})/)![1]; const co = path.match(/company_id=eq\.([0-9a-f-]{36})/)?.[1];
        const k = store.find(x => x.id === id && !x.revoked_at && (!co || x.company_id === co));
        if (!k) return j([]);
        k.revoked_at = body.revoked_at; return j([k]);
      }
      const h = path.match(/key_hash=eq\.([0-9a-f]+)/)?.[1];
      if (h) return j(store.filter(x => x.key_hash === h));
      const co = path.match(/company_id=eq\.([0-9a-f-]{36})/)?.[1];
      return j(store.filter(x => !co || x.company_id === co).map(omitHash));
    }
    if (path.startsWith('/rest/v1/suggestions')) return j(path.includes('status=eq.open') ? [{ id: 1, platform: 'meta', kind: 'pause', reason: 'r', status: 'open' }] : [{ id: 2, platform: 'snap', kind: 'budget_up', reason: 'r', status: 'approved' }]);
    if (path.startsWith('/rest/v1/buyer_outcomes')) return j([{ day: 3, platform: 'meta', result: 'worked' }]);
    if (path.startsWith('/rest/v1/campaigns')) return j([{ id: '99999999-9999-4999-8999-999999999999', title: 'Plan', status: 'running', estimate_usd: 1 }]);
    if (path.startsWith('/rest/v1/campaign_tasks')) return j([{ campaign_id: '99999999-9999-4999-8999-999999999999', position: 1, agent: 'design', title: 'T', status: 'running' }]);
    return j([]);
  }));
  return { store, audits, log, hits };
}
function files(map: Record<string, unknown>) {
  const f = {
    async get(k: string) { return k in map ? { json: async () => JSON.parse(JSON.stringify(map[k])), text: async () => JSON.stringify(map[k]) } : null; },
    async head(k: string) { return k in map ? { uploaded: new Date() } : null; },
  };
  return f as unknown as R2Bucket;
}
const ENV = (extra: Record<string, unknown> = {}) => ({ ...E, FILES: files({ 'site/dash.json': DASH }), ...extra });

// Owner makes a key through the real admin handler; returns the key as the owner would copy it
async function makeKey(w: ReturnType<typeof world>, body: Record<string, unknown> = { name: 'Reports', scopes: ['dash', 'ads', 'decisions', 'campaigns', 'health'] }, as: A.Profile = owner) {
  const res = await keys.POST!(await adminReq('/api/admin/keys', as, 'POST', body), E);
  const out = await res.json() as { key?: string; item?: KeyRow };
  return { res, key: out.key as string, item: out.item as KeyRow, w };
}
const v1 = (path: string, key: string | null, env: Record<string, unknown> = ENV(), init: RequestInit = {}) =>
  api.request('https://well.example/api/v1' + path, { ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.headers as object) } }, env);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('making a key (owner only, shown once, hash only)', () => {
  it('returns the key once in wad_ + 32 random bytes form, and stores only a peppered hash and the 8-character prefix', async () => {
    const w = world();
    const { res, key, item } = await makeKey(w);
    expect(res.status).toBe(201);
    expect(key).toMatch(KEY_SHAPE);
    expect(w.store).toHaveLength(1);
    const row = w.store[0]!;
    expect(row.key_hash).toBe(await hashKey(key, PEPPER));
    expect(row.key_hash).not.toBe(await hashKey(key, 'another-pepper-0123456789'));
    expect(row.prefix).toBe(key.slice(0, 8));
    expect(JSON.stringify(w.store)).not.toContain(key);
    expect(JSON.stringify(item)).not.toContain('key_hash');
    expect(row.company_id).toBe(WELL_COMPANY);
    // 90 days by default
    expect(Math.round((Date.parse(row.expires_at) - Date.now()) / 86400_000)).toBe(90);
    // the audit row names the key without its secret
    expect(w.audits).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({ action: 'api_key_created', target: { id: row.id, prefix: row.prefix } });
    expect(JSON.stringify(w.audits)).not.toContain(key);
  });
  it('the list shows prefix, name, scopes, last use and expiry, and never the key or its hash', async () => {
    const w = world();
    const { key } = await makeKey(w);
    const res = await keys.GET!(await adminReq('/api/admin/keys', owner), E);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(key);
    expect(text).not.toContain('key_hash');
    const l = JSON.parse(text) as { keys: KeyRow[] };
    expect(l.keys[0]).toMatchObject({ name: 'Reports', prefix: key.slice(0, 8), last_used_at: null });
    expect(l.keys[0]!.scopes).toContain('dash');
  });
  it('expiry: default 90, at most 365 days; bad name, scopes or days are refused', async () => {
    const w = world();
    expect((await makeKey(w, { name: 'a', scopes: ['dash'], days: MAX_DAYS })).res.status).toBe(201);
    for (const bad of [{ name: 'a', scopes: ['dash'], days: MAX_DAYS + 1 }, { name: 'a', scopes: ['dash'], days: 0 }, { name: 'a', scopes: ['dash'], days: 1.5 },
      { name: '', scopes: ['dash'] }, { name: 'a', scopes: [] }, { name: 'a', scopes: ['dash', 'admin'] }, { name: 'a', scopes: ['everything'] }, { name: 'x'.repeat(81), scopes: ['dash'] }]) {
      expect((await makeKey(w, bad)).res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(w.store).toHaveLength(1);
  });
  it('only the owner: a member and an anonymous call are refused, and another company\'s key belongs to that company', async () => {
    const w = world();
    expect((await keys.POST!(await adminReq('/api/admin/keys', member, 'POST', { name: 'a', scopes: ['dash'] }), E)).status).toBe(403);
    expect((await keys.GET!(new Request('https://well.example/api/admin/keys'), E)).status).toBe(401);
    expect(w.store).toHaveLength(0);
    const { item } = await makeKey(w, { name: 'Acme', scopes: ['dash'] }, acmeOwner);
    expect(item.company_id).toBe(ACME);
    const mine = await (await keys.GET!(await adminReq('/api/admin/keys', owner), E)).json() as { keys: unknown[] };
    expect(mine.keys).toHaveLength(0);
  });
  it('revoking stops the key at once, is audited, and another company cannot revoke it', async () => {
    const w = world();
    const { key, item } = await makeKey(w);
    expect((await v1('/dash', key)).status).toBe(200);
    expect((await keyrevoke.POST!(await adminReq('/api/admin/keyrevoke', acmeOwner, 'POST', { id: item.id }), E)).status).toBe(404);
    expect((await v1('/dash', key)).status).toBe(200);
    expect((await keyrevoke.POST!(await adminReq('/api/admin/keyrevoke', owner, 'POST', { id: item.id }), E)).status).toBe(200);
    expect((await v1('/dash', key)).status).toBe(401);
    expect(w.audits.map(a => a.action)).toEqual(['api_key_created', 'api_key_revoked']);
    expect((await keyrevoke.POST!(await adminReq('/api/admin/keyrevoke', owner, 'POST', { id: item.id }), E)).status).toBe(404);
  });
  it('without API_KEY_PEPPER nothing is created (503)', async () => {
    const w = world();
    const res = await keys.POST!(await adminReq('/api/admin/keys', owner, 'POST', { name: 'a', scopes: ['dash'] }), { ...E, API_KEY_PEPPER: '' });
    expect(res.status).toBe(503);
    expect(w.store).toHaveLength(0);
  });
});

describe('auth on /api/v1', () => {
  it('a valid key reads; the answer is private, uncached and has no CORS headers', async () => {
    const w = world();
    const { key } = await makeKey(w);
    const res = await v1('/dash', key);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect([...res.headers.keys()].filter(h => h.startsWith('access-control-'))).toEqual([]);
    expect(w.store[0]!.use_count).toBe(1);
    expect(w.store[0]!.last_used_at).not.toBeNull();
  });
  it('no key, a malformed key, an unknown key, a key in the query string or in a cookie: 401', async () => {
    const w = world();
    const { key } = await makeKey(w);
    expect((await v1('/dash', null)).status).toBe(401);
    expect((await v1('/dash', 'wad_short')).status).toBe(401);
    expect((await v1('/dash', 'wad_' + 'A'.repeat(43))).status).toBe(401);
    expect((await api.request(`https://well.example/api/v1/dash?key=${key}&token=${key}&access_token=${key}`, {}, ENV())).status).toBe(401);
    expect((await api.request('https://well.example/api/v1/dash', { headers: { cookie: `key=${key}; api_key=${key}` } }, ENV())).status).toBe(401);
    expect((await api.request('https://well.example/api/v1/dash', { headers: { authorization: `Basic ${key}` } }, ENV())).status).toBe(401);
  });
  it('an expired key and a revoked key are refused, with the same plain answer as an unknown one', async () => {
    const w = world();
    const { key } = await makeKey(w);
    const unknown = await (await v1('/dash', 'wad_' + 'B'.repeat(43))).json();
    w.store[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    const expired = await v1('/dash', key);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual(unknown);
    w.store[0]!.expires_at = new Date(Date.now() + 86400_000).toISOString();
    w.store[0]!.revoked_at = new Date().toISOString();
    const revoked = await v1('/dash', key);
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toEqual(unknown);
  });
  it('a key without the scope gets 403 and nothing is read', async () => {
    const w = world();
    const { key } = await makeKey(w, { name: 'Only health', scopes: ['health'] });
    expect((await v1('/health', key)).status).toBe(200);
    for (const p of ['/dash', '/overview', '/ads', '/decisions', '/campaigns']) expect((await v1(p, key)).status, p).toBe(403);
    expect(w.log.some(c => /suggestions|campaigns/.test(c.url))).toBe(false);
  });
  it('only GET and HEAD: every other method is 405 (even without a key), and HEAD answers without a body', async () => {
    const w = world();
    const { key } = await makeKey(w);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const r = await v1('/dash', key, ENV(), { method: m });
      expect(r.status, m).toBe(405);
      expect(r.headers.get('allow')).toBe('GET, HEAD');
    }
    expect((await v1('/dash', null, ENV(), { method: 'POST' })).status).toBe(405);
    const head = await v1('/dash', key, ENV(), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    // nothing was written through the Supabase REST API by any of this
    expect(w.log.filter(c => c.method !== 'GET' && !/\/rpc\/api_key_hit|audit_log|\/api_keys/.test(c.url))).toEqual([]);
  });
  it('an unknown path under /api/v1 is authenticated first (401), then 404', async () => {
    const w = world();
    const { key } = await makeKey(w);
    expect((await v1('/nope', null)).status).toBe(401);
    expect((await v1('/nope', key)).status).toBe(404);
    expect((await v1('/users', key)).status).toBe(404);
    expect((await v1('/admin/users', key)).status).toBe(404);
  });
  it('before migration 037 is applied: 503 with a plain message, never a crash', async () => {
    const w = world({ noTable: true });
    const key = 'wad_' + 'C'.repeat(43);
    const r = await v1('/dash', key);
    expect(r.status).toBe(503);
    expect(((await r.json()) as { message: string }).message).toMatch(/not set up/i);
    expect(w.log.length).toBeGreaterThan(0);
    // and the owner's list says so too
    expect((await keys.GET!(await adminReq('/api/admin/keys', owner), E)).status).toBe(503);
  });
  it('a missing pepper or Supabase config is 503, not open', async () => {
    const w = world();
    const { key } = await makeKey(w);
    expect((await v1('/dash', key, ENV({ API_KEY_PEPPER: '' }))).status).toBe(503);
    expect((await v1('/dash', key, ENV({ SUPABASE_URL: '' }))).status).toBe(503);
  });
});

describe('rate limits (60 a minute, 5,000 a day, fail closed)', () => {
  it('over the minute limit: 429 with Retry-After; at the limit it still answers', async () => {
    const w = world({ hits: { m: LIMIT_MINUTE - 2, d: 0 } });
    const { key } = await makeKey(w);
    expect((await v1('/dash', key)).status).toBe(200);   // 59th
    expect((await v1('/dash', key)).status).toBe(200);   // 60th
    const r = await v1('/dash', key);                    // 61st
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  it('over the day limit: 429', async () => {
    const w = world({ hits: { m: 0, d: LIMIT_DAY } });
    const { key } = await makeKey(w);
    expect((await v1('/dash', key)).status).toBe(429);
  });
  it('the counter is down: 503, the key is not let through', async () => {
    const w = world({ failCounter: true });
    const { key } = await makeKey(w);
    expect((await v1('/dash', key)).status).toBe(503);
  });
});

describe('what the endpoints return', () => {
  it('dash: the dashboard numbers with the CRM as totals only (no lead rows, no audience detail)', async () => {
    const w = world();
    const { key } = await makeKey(w);
    const d = await (await v1('/dash', key)).json() as Record<string, any>;
    expect(d.rows).toHaveLength(3);
    expect(d.rows[0]).toEqual(['m1', '2026-11-05', 100, 1000, 20, 5, 0]);
    expect(d.rows_cols).toBeUndefined();
    expect(d.crm.rows).toBeUndefined();
    expect(d.crm.paid_all).toBeUndefined();
    expect(d.crm.by_ad.m1).toEqual({ leads: 2, paid: 1, paid_sar: 700 });
    expect(d.crm.unmatched).toBe(4);
    expect(JSON.stringify(d)).not.toContain('secret');
  });
  it('overview: totals and the judge for a period', async () => {
    const w = world();
    const { key } = await makeKey(w);
    const o = await (await v1('/overview?from=2026-11-01&to=2026-11-10', key)).json() as Record<string, any>;
    expect(o.period).toEqual({ from: '2026-11-01', to: '2026-11-10' });
    expect(o.totals.spend).toBe(230);
    expect(o.totals.leads).toBe(11);
    expect(o.targets).toBeTruthy();
    expect((await v1('/overview?from=nope', key)).status).toBe(400);
    expect((await v1('/overview?from=2026-11-10&to=2026-11-01', key)).status).toBe(400);
  });
  it('ads: per-ad metrics for the period, filtered by platform and status', async () => {
    const w = world();
    const { key } = await makeKey(w);
    const all = await (await v1('/ads?from=2026-11-01&to=2026-11-10', key)).json() as { ads: any[]; count: number };
    expect(all.count).toBe(2);
    expect(all.ads[0].id).toBe('m1');
    expect(all.ads[0].metrics).toMatchObject({ spend: 150, impressions: 1500, clicks: 30, leads: 7 });
    expect(all.ads[0].aud).toBeUndefined();
    const snap = await (await v1('/ads?platform=snap', key)).json() as { ads: any[] };
    expect(snap.ads.map(a => a.id)).toEqual(['s1']);
    const active = await (await v1('/ads?status=ACTIVE', key)).json() as { ads: any[] };
    expect(active.ads.map(a => a.id)).toEqual(['m1']);
    const day = await (await v1('/ads?from=2026-11-10&to=2026-11-10', key)).json() as { ads: any[] };
    expect(day.ads.find(a => a.id === 'm1').metrics.spend).toBe(50);
  });
  it('decisions, campaigns and health answer for Well; campaigns carry no outputs or author emails', async () => {
    const w = world();
    const { key } = await makeKey(w);
    const dec = await (await v1('/decisions', key)).json() as Record<string, any>;
    expect(dec.open).toHaveLength(1);
    expect(dec.recent).toHaveLength(1);
    expect(dec.outcomes).toHaveLength(1);
    const dl = w.log.find(c => /\/suggestions\?/.test(c.url))!.url;
    expect(dl).not.toMatch(/decided_by|requested_by|note/);
    const camp = await (await v1('/campaigns', key)).json() as Record<string, any>;
    expect(camp.campaigns[0].tasks).toHaveLength(1);
    expect(w.log.some(c => /campaign_outputs/.test(c.url))).toBe(false);
    expect(w.log.find(c => /\/campaigns\?/.test(c.url))!.url).not.toMatch(/created_by|approved_by|wishes|brief/);
    const h = await (await v1('/health', key)).json() as Record<string, any>;
    expect(h).toHaveProperty('level');
    expect(h).not.toHaveProperty('migrations');
    expect(h).not.toHaveProperty('env');
  });
  it('another company: its own data only, and 404 where the data is Well\'s alone', async () => {
    const w = world();
    const { key } = await makeKey(w, { name: 'Acme', scopes: ['dash', 'decisions', 'health', 'campaigns'] }, acmeOwner);
    // Well's file is never served to another company; with no copy of its own it gets 404
    expect((await v1('/dash', key)).status).toBe(404);
    const own = ENV({ FILES: files({ 'site/dash.json': DASH, [`companies/${ACME}/data/all.json`]: { ...DASH, generated_at: 'acme' } }) });
    expect(((await (await v1('/dash', key, own)).json()) as { generated_at: string }).generated_at).toBe('acme');
    expect((await v1('/decisions', key)).status).toBe(404);
    expect((await v1('/health', key)).status).toBe(404);
    await v1('/campaigns', key);
    expect(w.log.filter(c => /\/campaigns\?/.test(c.url)).every(c => c.url.includes(`company_id=eq.${ACME}`))).toBe(true);
  });
  it('openapi.json is valid OpenAPI 3 JSON listing every endpoint, and needs a key too', async () => {
    const w = world();
    const { key } = await makeKey(w, { name: 'doc', scopes: ['health'] });
    expect((await v1('/openapi.json', null)).status).toBe(401);
    const res = await v1('/openapi.json', key);
    expect(res.status).toBe(200);
    const doc = JSON.parse(await res.text()) as Record<string, any>;
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths).sort()).toEqual(['/ads', '/campaigns', '/dash', '/decisions', '/health', '/openapi.json', '/overview']);
    for (const p of Object.values(doc.paths) as any[]) { expect(p.get.responses['200']).toBeTruthy(); expect(Object.keys(p)).toEqual(['get']); }
    expect(doc.components.securitySchemes.bearer.scheme).toBe('bearer');
  });
});

describe('the key never leaks', () => {
  it('never in the logs, in any answer, or in any request except the Authorization header', async () => {
    const w = world();
    const spy = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')];
    const { key } = await makeKey(w);
    const bodies: string[] = [];
    for (const p of ['/dash', '/overview', '/ads', '/decisions', '/campaigns', '/health', '/nope']) bodies.push(await (await v1(p, key)).text());
    bodies.push(await (await v1('/dash', key, ENV({ FILES: { get: async () => { throw new Error('boom ' + key); } } }))).text());
    for (const b of bodies) expect(b).not.toContain(key);
    for (const s of spy) expect(JSON.stringify(s.mock.calls)).not.toContain(key);
    expect(JSON.stringify(w.log)).not.toContain(key);   // only its hash went to Supabase
    expect(JSON.stringify(w.log)).toContain(await hashKey(key, PEPPER));
  });
});

describe('every other route still needs a session', () => {
  it('the gate exempts /api/v1 and nothing else under /api', async () => {
    for (const p of ['/api/v1/dash', '/api/v1/', '/api/v1']) expect(need(p, '')).toBeNull();
    for (const p of ['/api/v10/dash', '/api/v1x', '/api/dash/data', '/api/admin/users', '/api/admin/keys', '/api/control/suggestions', '/api/overview/data', '/api/campaigns/list', '/api/connectors/list', '/api/library', '/api/health/details']) expect(need(p, ''), p).not.toBeNull();
  });
  it('a key in Authorization is no session: every other API route and page is refused without a cookie', async () => {
    const w = world();
    const { key } = await makeKey(w);
    const paths = ['/api/dash/data', '/api/admin/users', '/api/admin/keys', '/api/admin/log', '/api/control/suggestions', '/api/overview/data', '/api/campaigns/list', '/api/connectors/list', '/api/buyer/rules', '/api/library', '/api/health/details', '/api/today/summary', '/api/account/me', '/api/maestro/health', '/', '/admin/', '/control/', '/dash.json', '/control/ads.json', '/site/dash.json'];
    for (const p of paths) {
      for (const method of ['GET', 'POST']) {
        const req = new Request('https://well.example' + p, { method, headers: { authorization: `Bearer ${key}`, 'x-api-key': key }, ...(method === 'POST' ? { body: '{}' } : {}) });
        const d = await gate(req, E);
        expect(d instanceof Response, `${method} ${p}`).toBe(true);
        expect([301, 302, 401, 403], `${method} ${p}`).toContain((d as Response).status);
        if (p.startsWith('/api/')) expect((d as Response).status, `${method} ${p}`).toBe(401);
      }
    }
  });
  it('even without the gate, the API handlers themselves ignore the bearer key (their own session check answers 401)', async () => {
    const w = world();
    const { key } = await makeKey(w);
    for (const p of ['/api/dash/data', '/api/admin/users', '/api/admin/keys', '/api/control/suggestions', '/api/overview/data', '/api/campaigns/list']) {
      const r = await api.request('https://well.example' + p, { headers: { authorization: `Bearer ${key}` } }, ENV());
      expect(r.status, p).toBe(401);
    }
  });
  it('with a session cookie but no key, /api/v1 is still refused (a session is not a key)', async () => {
    world();
    const r = await api.request('https://well.example/api/v1/dash', { headers: { cookie: await cookieFor(owner) } }, ENV());
    expect(r.status).toBe(401);
  });
});
