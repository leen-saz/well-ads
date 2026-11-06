// Every API route fails as JSON with an Arabic message: signed out, with upstreams unreachable, with a broken body.
// Never a stack trace, never an upstream host or message. Synthetic data only; fetch is stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api, GROUPS } from '../../src/api/index';

const E = { SUPABASE_URL: 'https://secret-host.example', SUPABASE_SERVICE_ROLE_KEY: 'service-key-value', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.test' };
const cfg = A.env(E);
const owner: A.Profile = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', role: 'owner', active: true };
const cookie = async () => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(owner, cfg), cfg.secret))}`;
const AR = /[؀-ۿ]/;
const LEAK = /\bat \S+ \(|\.ts:\d+|node_modules|secret-host|service-key-value|TypeError|ReferenceError/;
// Form posts and redirects that answer with no body by design
const NO_BODY = new Set(['/api/auth/logout', '/api/auth/refresh']);
const calls = Object.entries(GROUPS).flatMap(([g, routes]) => Object.entries(routes).flatMap(([a, m]) => Object.keys(m ?? {}).map(method => ({ path: `/api/${g}/${a}`, method }))));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ask = (c: { path: string; method: string }, headers: Record<string, string>, body?: string) =>
  api.request('https://well.example' + c.path, { method: c.method, headers: { origin: 'https://well.example', 'content-type': 'application/json', ...headers }, ...(body === undefined || c.method === 'GET' ? {} : { body }) }, E);

// null when the response is fine; else what is wrong. A failure is JSON with an Arabic `error` (or, for the routes
// a browser navigates to, a short Arabic page) and nothing that looks like a stack or leaks the upstream.
async function wrong(res: Response): Promise<string | null> {
  const text = await res.text();
  const type = res.headers.get('content-type') ?? '';
  if (LEAK.test(text)) return 'leaks';
  if (type.includes('text/html')) return AR.test(text) ? null : 'html without Arabic';
  if (!type.includes('application/json')) return `content-type ${type || 'none'}`;
  try { const e = (JSON.parse(text) as { error?: unknown }).error; return typeof e === 'string' && AR.test(e) ? null : 'no Arabic error'; } catch { return 'bad json'; }
}

async function sweep(headers: Record<string, string>, body: string): Promise<string[]> {
  const bad: string[] = [];
  for (const c of calls) {
    if (NO_BODY.has(c.path)) continue;
    const res = await ask(c, headers, body);
    if (res.status < 400) continue;
    const w = await wrong(res);
    if (w) bad.push(`${c.method} ${c.path} -> ${res.status}: ${w}`);
  }
  return bad;
}

describe('api errors', () => {
  it('the suite sees every route', () => { expect(calls.length).toBeGreaterThan(80); });

  it('signed out: every route that needs a login answers 401/403 as JSON in Arabic', async () => {
    vi.stubGlobal('fetch', async () => new Response('[]', { status: 200 }));
    expect(await sweep({}, '{}')).toEqual([]);
  });

  // Two outages: everything down (the user's own profile read fails too), and only what a handler needs after sign-in
  const OUTAGES: [string, (u: string) => Promise<Response>][] = [
    ['everything down', async () => { throw new TypeError('fetch failed https://secret-host.example/rest/v1 at Object.fetch (node:internal/x.js:1:1)'); }],
    ['only the data calls down', async u => { if (String(u).includes('/profiles')) return new Response(JSON.stringify([owner]), { status: 200 }); throw new TypeError('fetch failed https://secret-host.example'); }],
  ];
  for (const [name, stub] of OUTAGES) {
    it(`${name}: no route throws or leaks, failures are JSON in Arabic`, async () => {
      vi.stubGlobal('fetch', stub);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await sweep({ cookie: await cookie() }, '{}')).toEqual([]);
    }, 60_000);
  }

  it('a body that is not JSON is a 400 in Arabic, not a server error', async () => {
    vi.stubGlobal('fetch', async (u: string) => new Response(String(u).includes('/profiles') ? JSON.stringify([owner]) : '[]', { status: 200 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await ask({ path: '/api/knowledge/entry', method: 'POST' }, { cookie: await cookie() }, '{not json');
    expect(res.status).toBe(400);
    expect(await wrong(res.clone())).toBeNull();
  });
});
