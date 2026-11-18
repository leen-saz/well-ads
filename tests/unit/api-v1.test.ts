/* eslint-disable @typescript-eslint/no-explicit-any -- parsed JSON answers are read loosely in assertions */
// The read-only API (/api/v1/*): ONE static key from the Worker variable READ_API_KEY. Off (404) when unset; bearer only; GET/HEAD only;
// wrong keys limited per address; 60 requests a minute, failing closed; no token in logs; every other route still needs a session.
// Fakes only: a fake Supabase, a fake R2 and a fake Cache API hold synthetic data. The key below is made up for the test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { gate, need } from '../../src/lib/gate';
import { FAIL_LIMIT, LIMIT_MINUTE, configuredKey } from '../../src/lib/readkey';

const KEY = 'wad_' + 'TestKeyNotReal0123456789abcdefghijklmnopqr'.slice(0, 43);
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com', READ_API_KEY: KEY } as A.AuthEnv & { READ_API_KEY?: string; FILES?: unknown };
const DASH = {
  generated_at: '2026-11-10T00:00:00Z', range: { start: '2026-11-01', end: '2026-11-10', today: '2026-11-10' },
  ads: { m1: { name: 'Ad one', campaign: 'C1', platform: 'facebook', goal: 'lead', status: 'ACTIVE', live: true, aud: { secret: 'x' } }, s1: { name: 'Ad two', campaign: 'C2', platform: 'snap', goal: 'lead', status: 'PAUSED', live: false } },
  rows_cols: { k: ['m1', 's1'], d: ['2026-11-05', '2026-11-10'], c: [[0, 0, 1], [0, 1, 1], [100, 50, 80], [1000, 500, 900], [20, 10, 15], [5, 2, 4], [0, 0, 0]] },
  crm: { rows: [['m1', '2026-11-05', '2026-11-08', 1, 700], ['m1', '2026-11-06', null, 0, 0], ['s1', '2026-11-10', null, 0, 0]], paid_all: [['2026-11-05', '2026-11-08', 700, 'meta']], unmatched: 4, total: 9, stats: { by_source: { meta: [3, 3, 1] } } },
  funnel_targets: {},
};

// A Cache API that remembers (no expiry needed inside one test); `broken` makes it throw
function fakeCaches(broken = false) {
  const m = new Map<string, string>();
  const cache = {
    async match(r: Request) { if (broken) throw new Error('cache down'); const v = m.get(r.url); return v === undefined ? undefined : new Response(v); },
    async put(r: Request, res: Response) { if (broken) throw new Error('cache down'); m.set(r.url, await res.text()); },
  };
  vi.stubGlobal('caches', { default: cache });
  return m;
}
const log: { url: string; method: string }[] = [];
function world() {
  log.length = 0;
  const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const url = String(u), method = init.method || 'GET';
    log.push({ url, method });
    const path = url.replace('https://sb.example', '');
    if (path.startsWith('/rest/v1/suggestions')) return j(path.includes('status=eq.open') ? [{ id: 1, platform: 'meta', kind: 'pause', reason: 'r', status: 'open' }] : [{ id: 2, platform: 'snap', kind: 'budget_up', reason: 'r', status: 'approved' }]);
    if (path.startsWith('/rest/v1/buyer_outcomes')) return j([{ day: 3, platform: 'meta', result: 'worked' }]);
    if (path.startsWith('/rest/v1/campaigns')) return j([{ id: '99999999-9999-4999-8999-999999999999', title: 'Plan', status: 'running', estimate_usd: 1 }]);
    if (path.startsWith('/rest/v1/campaign_tasks')) return j([{ campaign_id: '99999999-9999-4999-8999-999999999999', position: 1, agent: 'design', title: 'T', status: 'running' }]);
    return j([]);
  }));
}
function files(map: Record<string, unknown>) {
  return { async get(k: string) { return k in map ? { json: async () => JSON.parse(JSON.stringify(map[k])) } : null; }, async head(k: string) { return k in map ? { uploaded: new Date() } : null; } } as unknown as R2Bucket;
}
const ENV = (extra: Record<string, unknown> = {}) => ({ ...E, FILES: files({ 'site/dash.json': DASH }), ...extra });

const v1 = (path: string, key: string | null = KEY, env: Record<string, unknown> = ENV(), init: RequestInit = {}) =>
  api.request('https://well.example/api/v1' + path, { ...init, headers: { 'cf-connecting-ip': '203.0.113.' + (init.headers as any)?.ip, ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.headers as object) } }, env);
const setup = () => { fakeCaches(); world(); };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('off until the key is set', () => {
  it('READ_API_KEY unset, empty or too short: the whole router is 404, with or without a header, for every method', async () => {
    setup();
    for (const k of [undefined, '', '   ', 'wad_short', 'not-a-wad-key-' + 'x'.repeat(40)]) {
      expect(configuredKey({ READ_API_KEY: k } as never)).toBeNull();
      for (const method of ['GET', 'HEAD', 'POST']) for (const p of ['/dash', '/openapi.json', '/anything']) {
        const r = await v1(p, KEY, ENV({ READ_API_KEY: k }), { method });
        expect(r.status, `${method} ${p}`).toBe(404);
        expect(await r.text()).not.toContain('"ads"');
      }
    }
  });
});

describe('auth on /api/v1', () => {
  it('the right key reads; private, uncached, no CORS headers', async () => {
    setup();
    const res = await v1('/dash');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect([...res.headers.keys()].filter(h => h.startsWith('access-control-'))).toEqual([]);
  });
  it('no key, a wrong key, a key in the query string, in a cookie, or with another scheme: 401, always the same answer', async () => {
    setup();
    const none = await v1('/dash', null);
    expect(none.status).toBe(401);
    const body = await none.json();
    const wrong = await v1('/dash', 'wad_' + 'A'.repeat(43));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(body);
    expect((await api.request(`https://well.example/api/v1/dash?key=${KEY}&token=${KEY}&access_token=${KEY}`, {}, ENV())).status).toBe(401);
    expect((await api.request('https://well.example/api/v1/dash', { headers: { cookie: `key=${KEY}; api_key=${KEY}` } }, ENV())).status).toBe(401);
    expect((await api.request('https://well.example/api/v1/dash', { headers: { authorization: `Basic ${KEY}` } }, ENV())).status).toBe(401);
  });
  it('only GET and HEAD: every other method is 405, HEAD answers without a body, nothing is written', async () => {
    setup();
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const r = await v1('/dash', KEY, ENV(), { method: m });
      expect(r.status, m).toBe(405);
      expect(r.headers.get('allow')).toBe('GET, HEAD');
    }
    const head = await v1('/dash', KEY, ENV(), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(log.filter(c => c.method !== 'GET')).toEqual([]);
  });
  it('an unknown path is authenticated first (401), then 404; nothing outside the listed endpoints exists', async () => {
    setup();
    expect((await v1('/nope', null)).status).toBe(401);
    for (const p of ['/nope', '/users', '/admin/users', '/connectors', '/audit', '/vault', '/crm']) expect((await v1(p)).status, p).toBe(404);
  });
});

describe('limits (wrong keys per address, 60 requests a minute, fail closed)', () => {
  it('too many wrong keys from one address: 429, even for the right key afterwards; another address is not affected', async () => {
    setup();
    const ip = (x: string) => ({ headers: { ip: x } });
    for (let i = 0; i < FAIL_LIMIT; i++) expect((await v1('/dash', 'wad_' + 'B'.repeat(43), ENV(), ip('77'))).status).toBe(401);
    const blocked = await v1('/dash', KEY, ENV(), ip('77'));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await v1('/dash', KEY, ENV(), ip('78'))).status).toBe(200);
  });
  it('over 60 requests in a minute: 429 with Retry-After; the 60th still answers', async () => {
    setup();
    for (let i = 0; i < LIMIT_MINUTE; i++) expect((await v1('/health')).status, String(i)).toBe(200);
    const r = await v1('/health');
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  it('the counter is down (no cache, or it throws): 503, the key is not let through', async () => {
    world();
    vi.stubGlobal('caches', undefined);
    expect((await v1('/dash')).status).toBe(503);
    fakeCaches(true);
    const r = await v1('/dash');
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('"ads"');
  });
  it('an incomplete server setup is 503, not open', async () => {
    setup();
    expect((await v1('/dash', KEY, ENV({ SUPABASE_URL: '' }))).status).toBe(503);
  });
});

describe('what the endpoints return', () => {
  it('dash: the dashboard numbers with the CRM as totals only (no lead rows, no audience detail)', async () => {
    setup();
    const d = await (await v1('/dash')).json() as Record<string, any>;
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
    setup();
    const o = await (await v1('/overview?from=2026-11-01&to=2026-11-10')).json() as Record<string, any>;
    expect(o.period).toEqual({ from: '2026-11-01', to: '2026-11-10' });
    expect(o.totals.spend).toBe(230);
    expect(o.totals.leads).toBe(11);
    expect(o.targets).toBeTruthy();
    expect((await v1('/overview?from=nope')).status).toBe(400);
    expect((await v1('/overview?from=2026-11-10&to=2026-11-01')).status).toBe(400);
  });
  it('ads: per-ad metrics for the period, filtered by platform and status', async () => {
    setup();
    const all = await (await v1('/ads?from=2026-11-01&to=2026-11-10')).json() as { ads: any[]; count: number };
    expect(all.count).toBe(2);
    expect(all.ads[0].id).toBe('m1');
    expect(all.ads[0].metrics).toMatchObject({ spend: 150, impressions: 1500, clicks: 30, leads: 7 });
    expect(all.ads[0].aud).toBeUndefined();
    expect(((await (await v1('/ads?platform=snap')).json()) as { ads: any[] }).ads.map(a => a.id)).toEqual(['s1']);
    expect(((await (await v1('/ads?status=ACTIVE')).json()) as { ads: any[] }).ads.map(a => a.id)).toEqual(['m1']);
    const day = await (await v1('/ads?from=2026-11-10&to=2026-11-10')).json() as { ads: any[] };
    expect(day.ads.find(a => a.id === 'm1').metrics.spend).toBe(50);
  });
  it('decisions, campaigns and health; campaigns carry no outputs or author emails, decisions no names of who decided', async () => {
    setup();
    const dec = await (await v1('/decisions')).json() as Record<string, any>;
    expect(dec.open).toHaveLength(1);
    expect(dec.recent).toHaveLength(1);
    expect(dec.outcomes).toHaveLength(1);
    expect(log.find(c => /\/suggestions\?/.test(c.url))!.url).not.toMatch(/decided_by|requested_by|note/);
    const camp = await (await v1('/campaigns')).json() as Record<string, any>;
    expect(camp.campaigns[0].tasks).toHaveLength(1);
    expect(log.some(c => /campaign_outputs/.test(c.url))).toBe(false);
    expect(log.find(c => /\/campaigns\?/.test(c.url))!.url).not.toMatch(/created_by|approved_by|wishes|brief/);
    const h = await (await v1('/health')).json() as Record<string, any>;
    expect(h).toHaveProperty('level');
    expect(h).not.toHaveProperty('migrations');
    expect(h).not.toHaveProperty('env');
  });
  it('nothing is read from tables of users, connections, the Vault or the audit log, and nothing is written', async () => {
    setup();
    for (const p of ['/dash', '/overview', '/ads', '/decisions', '/campaigns', '/health']) await v1(p);
    expect(log.filter(c => /profiles|connections|vault|audit_log|crm_leads|buyer_actions|\/auth\//.test(c.url))).toEqual([]);
    expect(log.filter(c => c.method !== 'GET')).toEqual([]);
  });
  it('openapi.json is valid OpenAPI 3 JSON listing every endpoint, and needs the key too', async () => {
    setup();
    expect((await v1('/openapi.json', null)).status).toBe(401);
    const res = await v1('/openapi.json');
    expect(res.status).toBe(200);
    const doc = JSON.parse(await res.text()) as Record<string, any>;
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths).sort()).toEqual(['/ads', '/campaigns', '/dash', '/decisions', '/health', '/openapi.json', '/overview']);
    for (const p of Object.values(doc.paths) as any[]) { expect(p.get.responses['200']).toBeTruthy(); expect(Object.keys(p)).toEqual(['get']); }
    expect(doc.components.securitySchemes.bearer.scheme).toBe('bearer');
  });
});

describe('the key never leaks', () => {
  it('never in the logs or in any answer, even when something fails inside', async () => {
    setup();
    const spy = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')];
    const bodies: string[] = [];
    for (const p of ['/dash', '/overview', '/ads', '/decisions', '/campaigns', '/health', '/nope']) bodies.push(await (await v1(p)).text());
    bodies.push(await (await v1('/dash', KEY, ENV({ FILES: { get: async () => { throw new Error('boom ' + KEY); } } }))).text());
    bodies.push(await (await v1('/dash', 'wad_' + 'C'.repeat(43))).text());
    for (const b of bodies) expect(b).not.toContain(KEY);
    for (const s of spy) expect(JSON.stringify(s.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(log)).not.toContain(KEY);
  });
});

describe('every other route still needs a session', () => {
  it('the gate exempts /api/v1 and nothing else under /api', () => {
    for (const p of ['/api/v1/dash', '/api/v1/', '/api/v1']) expect(need(p, '')).toBeNull();
    for (const p of ['/api/v10/dash', '/api/v1x', '/api/dash/data', '/api/admin/users', '/api/control/suggestions', '/api/overview/data', '/api/campaigns/list', '/api/connectors/list', '/api/library', '/api/health/details']) expect(need(p, ''), p).not.toBeNull();
  });
  it('the key is no session: every other API route and page is refused without a cookie', async () => {
    setup();
    const paths = ['/api/dash/data', '/api/admin/users', '/api/admin/log', '/api/control/suggestions', '/api/overview/data', '/api/campaigns/list', '/api/connectors/list', '/api/buyer/rules', '/api/library', '/api/health/details', '/api/today/summary', '/api/account/me', '/api/maestro/health', '/', '/admin/', '/control/', '/dash.json', '/control/ads.json'];
    for (const p of paths) for (const method of ['GET', 'POST']) {
      const req = new Request('https://well.example' + p, { method, headers: { authorization: `Bearer ${KEY}`, 'x-api-key': KEY }, ...(method === 'POST' ? { body: '{}' } : {}) });
      const d = await gate(req, E);
      expect(d instanceof Response, `${method} ${p}`).toBe(true);
      expect([301, 302, 401, 403], `${method} ${p}`).toContain((d as Response).status);
      if (p.startsWith('/api/')) expect((d as Response).status, `${method} ${p}`).toBe(401);
    }
  });
  it('even without the gate, the API handlers ignore the bearer key (their own session check answers 401)', async () => {
    setup();
    for (const p of ['/api/dash/data', '/api/admin/users', '/api/control/suggestions', '/api/overview/data', '/api/campaigns/list']) {
      const r = await api.request('https://well.example' + p, { headers: { authorization: `Bearer ${KEY}` } }, ENV());
      expect(r.status, p).toBe(401);
    }
  });
  it('a session cookie is no key: /api/v1 without the bearer is 401', async () => {
    setup();
    const cfg = A.env(E);
    const p: A.Profile = { id: '33333333-3333-3333-3333-333333333333', email: 'owner@example.com', role: 'owner', active: true };
    const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
    expect((await api.request('https://well.example/api/v1/dash', { headers: { cookie } }, ENV())).status).toBe(401);
  });
});
