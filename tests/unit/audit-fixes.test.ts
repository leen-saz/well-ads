// Fixes from the independent audit: typed signed tokens, connector edit level, AI cost caps on every paid call,
// "Supabase hiccup is not a logout", invite/orphan company scoping, pinned workflow actions. Synthetic data, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { gate } from '../../src/lib/gate';
import { api } from '../../src/api/index';
import { grokSearch, openaiImage, IMAGE_USD } from '../../src/lib/llm';
import { clearSnaps, withWaiter, type UsageCtx } from '../../src/lib/usage';
import { users, orphans } from '../../src/api/routes/admin';
import { ROUTES } from '../../src/modules/routes';
import { WELL_COMPANY } from '../../src/lib/tenant';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com' };
const cfg = A.env(E);
const ACME = '22222222-2222-2222-2222-222222222222';
const viewer: A.Profile = { id: '11111111-1111-4111-8111-111111111111', email: 'v@example.com', role: 'member', active: true, company_id: WELL_COMPANY, access: { connectors: 'view', voice: 'edit', creative: 'view' } };
const editor: A.Profile = { ...viewer, id: '12121212-1212-4212-8212-121212121212', email: 'e@example.com', access: { connectors: 'edit', voice: 'edit', creative: 'view' } };
const cookieOf = async (p: A.Profile, typ?: A.TokenType) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret, typ))}`;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('1. signed tokens carry a type', () => {
  const state = () => A.sign({ uid: viewer.id, p: 'meta', n: 'n1', exp: Date.now() + 600_000 }, cfg.secret, 'oauth');
  it('an OAuth state is not a session cookie, and a session is not an OAuth state', async () => {
    expect(await A.verify(await state(), cfg.secret)).toBeNull();
    expect(await A.verify(await A.sign(A.sessionFor(viewer, cfg), cfg.secret), cfg.secret, Date.now(), 'oauth')).toBeNull();
    expect(await A.verify(await state(), cfg.secret, Date.now(), 'oauth')).toMatchObject({ uid: viewer.id });
    expect(await A.verify(await A.sign(A.sessionFor(viewer, cfg), cfg.secret), cfg.secret)).toMatchObject({ uid: viewer.id });
  });
  it('every token has its typ in the payload, and a payload cannot choose another one', async () => {
    const t = await A.sign({ uid: 'u', exp: Date.now() + 1e5, typ: 'session' }, cfg.secret, 'oauth');
    expect(JSON.parse(atob(t.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/'))).typ).toBe('oauth');
  });
  it('a session cookie issued before types existed keeps working; an old state-shaped token does not', async () => {
    // signed by hand without typ, the way the previous release did
    const old = (o: object) => crypto.subtle.importKey('raw', new TextEncoder().encode(cfg.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(async k => { const b = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); const p = b(new TextEncoder().encode(JSON.stringify(o))); return `${p}.${b(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(p))))}`; });
    const bare = A.sessionFor(viewer, cfg); // sessionFor itself adds no typ; sign() does
    expect(await A.verify(await old(bare), cfg.secret)).toMatchObject({ uid: viewer.id });
    expect(await A.verify(await old({ uid: viewer.id, p: 'meta', n: 'n', exp: Date.now() + 1e5 }), cfg.secret)).toBeNull();
  });
  it('the connectors callback refuses a session cookie value as state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]')));
    const sessionAsState = await A.sign({ ...A.sessionFor(editor, cfg), p: 'meta', n: 'n1' }, cfg.secret);
    const res = await api.request(`https://well.example/api/connectors/callback?code=c&state=${encodeURIComponent(sessionAsState)}`, { headers: { cookie: '__Secure-well_oauth=n1' } }, E);
    expect(await res.text()).toContain('err=state');
  });
});

describe('2. connecting a platform needs approve level', () => {
  const fake = (p: A.Profile) => { const calls: string[] = []; vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return new Response(JSON.stringify(String(u).includes('/profiles?id=eq.') ? [p] : [])); })); return calls; };
  const start = async (p: A.Profile) => api.request('https://well.example/api/connectors/start?platform=meta', { headers: { cookie: await cookieOf(p), 'sec-fetch-site': 'same-origin' } }, E);
  it('start: view-only and edit-only users are refused, an approver gets past the permission check', async () => {
    fake(viewer);
    expect((await start(viewer)).status).toBe(403);
    fake(editor);
    expect((await start(editor)).status).toBe(403);   // changing an ad platform's keys is an approval, not an edit
    const approver = { ...editor, id: '66666666-6666-6666-6666-666666666666', email: 'approver@example.com', access: { connectors: 'approve' } } as A.Profile;
    fake(approver);
    expect((await start(approver)).status).toBe(400); // no app keys in this test env: past the permission check
  });
  it('callback: a view-only user with a valid state saves nothing', async () => {
    const calls = fake(viewer);
    const state = await A.sign({ uid: viewer.id, p: 'meta', n: 'n1', exp: Date.now() + 600_000 }, cfg.secret, 'oauth');
    const res = await api.request(`https://well.example/api/connectors/callback?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie: '__Secure-well_oauth=n1' } }, E);
    expect(await res.text()).toContain('err=access');
    expect(calls.some(u => u.includes('/rpc/') || u.includes('vault'))).toBe(false);
  });
});

describe('3. paid AI calls are under the monthly cap and recorded', () => {
  let rows: Record<string, unknown>[], seen: string[], spend: number;
  beforeEach(() => {
    rows = []; seen = []; spend = 0; clearSnaps();
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
      const url = String(u); seen.push(url);
      if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([editor]));
      if (url.includes('/rpc/ai_spend')) return new Response(JSON.stringify(spend ? [{ module: 'voice', cost_usd: spend }, { module: 'design', cost_usd: spend }, { module: 'listening', cost_usd: spend }] : []));
      if (url.includes('/ai_budgets')) return new Response('[]');
      if (url.includes('/ai_usage')) { rows.push(JSON.parse(String(init.body))); return new Response(''); }
      if (url.includes('generativelanguage')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: 'QUJD' } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } }));
      if (url.includes('api.openai.com')) return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }));
      if (url.includes('api.x.ai')) return new Response(JSON.stringify({ output_text: '[]', usage: { input_tokens: 100, output_tokens: 50 } }));
      return new Response('[]');
    }));
  });
  const ctx: UsageCtx = { cfg, co: WELL_COMPANY, uid: 'u1' };
  const settle = async <T,>(run: () => Promise<T>): Promise<T> => { const jobs: Promise<unknown>[] = []; const out = await withWaiter(p => jobs.push(p), run); await Promise.all(jobs); return out; };
  const speak = async () => settle(async () => ROUTES.voice.speak.POST!(new Request('https://well.example/api/voice/speak', { method: 'POST', body: JSON.stringify({ text: 'مرحبا' }),
    headers: { cookie: await cookieOf(editor), origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } }), { ...E, GEMINI_API_KEY: 'k' } as never));

  it('voice/speak records the cost; at the cap it answers a plain sentence and never calls Gemini', async () => {
    const ok = await speak();
    expect(ok.status).toBe(200);
    expect(rows).toMatchObject([{ module: 'voice', provider: 'gemini' }]);
    clearSnaps(); seen = []; spend = 50;
    const blocked = await speak();
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/[؀-ۿ]/);
    expect(seen.some(u => u.includes('generativelanguage'))).toBe(false);
  });
  it('the picture (OpenAI Images): recorded with a flat estimate; at the cap no call is made', async () => {
    expect(await settle(() => openaiImage({ OPENAI_API_KEY: 'k' }, 'bg', fetch, undefined, ctx))).toMatch(/^data:image/);
    expect(rows).toMatchObject([{ module: 'design', provider: 'openai', cost_usd: IMAGE_USD, estimated: true }]);
    clearSnaps(); seen = []; spend = 50;
    expect(await openaiImage({ OPENAI_API_KEY: 'k' }, 'bg', fetch, undefined, ctx)).toBeNull();
    expect(seen.some(u => u.includes('api.openai.com'))).toBe(false);
  });
  it('Grok search (Listening, also from cron): recorded under the Listening tab; at the cap it is not called', async () => {
    expect(await settle(() => grokSearch({ XAI_API_KEY: 'k' }, [{ role: 'user', content: 'q' }], ['x'], 100, fetch, ctx))).toBe('[]');
    expect(rows).toMatchObject([{ module: 'listening', provider: 'xai', estimated: true }]);
    expect(Number(rows[0]!.cost_usd)).toBeGreaterThan(0);
    clearSnaps(); seen = []; spend = 50;
    expect(await grokSearch({ XAI_API_KEY: 'k' }, [{ role: 'user', content: 'q' }], ['x'], 100, fetch, ctx)).toBeNull();
    expect(seen.some(u => u.includes('api.x.ai'))).toBe(false);
  });
});

describe('4. a Supabase hiccup does not log anyone out', () => {
  const reply = (status: number, body: unknown = {}) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
  it('readProfile tells "no such user" from "Supabase could not answer"', async () => {
    reply(200, []); expect(await A.readProfile(cfg, viewer.id)).toEqual({ kind: 'missing' });
    reply(200, [viewer]); expect(await A.readProfile(cfg, viewer.id)).toMatchObject({ kind: 'ok' });
    for (const s of [500, 502, 503, 429]) { reply(s); expect(await A.readProfile(cfg, viewer.id)).toEqual({ kind: 'error' }); }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); })); expect(await A.readProfile(cfg, viewer.id)).toEqual({ kind: 'error' });
  });
  it('API: a 5xx answers 503 and keeps the cookie; a missing profile still clears it', async () => {
    const c = await cookieOf(viewer);
    const hit = () => api.request('https://well.example/api/connectors/list', { headers: { cookie: c, 'sec-fetch-site': 'same-origin' } }, E);
    reply(503); const a = await hit(); expect(a.status).toBe(503); expect(a.headers.get('set-cookie')).toBeNull();
    reply(200, []); const b = await hit(); expect(b.status).toBe(401); expect(b.headers.get('set-cookie')).toContain('Max-Age=0');
  });
  it('pages: a stale session with Supabase answering 500/429 passes with the old session and no cookie change', async () => {
    const c = await cookieOf(viewer);
    const stale = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(viewer, cfg, Date.now() - 11 * 60e3), cfg.secret))}`;
    for (const s of [500, 429]) {
      reply(s);
      const d = await gate(new Request('https://well.example/creative/', { headers: { cookie: stale } }), E);
      expect(d instanceof Response ? d.status : 200).toBe(200);
      expect(d instanceof Response ? '' : d.cookie ?? '').toBe('');
    }
    expect(c).toBeTruthy();
  });
  it('renew: error is its own result; a missing profile is still a login', async () => {
    const s = A.sessionFor(viewer, cfg);
    reply(500); expect(await A.renew(cfg, s)).toEqual({ kind: 'error' });
    reply(200, []); expect(await A.renew(cfg, s)).toEqual({ kind: 'login' });
  });
});

describe('5. invites and accounts without a profile stay inside the company', () => {
  const acmeOwner: A.Profile = { id: '33333333-3333-4333-8333-333333333333', email: 'boss@acme.example', role: 'owner', active: true, company_id: ACME };
  const wellOwner: A.Profile = { id: '44444444-4444-4444-8444-444444444444', email: 'boss@example.com', role: 'owner', active: true, company_id: WELL_COMPANY };
  const INVITED = 'a1a1a1a1-0000-4000-8000-000000000001', MINE = '55555555-5555-4555-8555-555555555555', THEIRS = '66666666-6666-4666-8666-666666666666', HAND = '77777777-7777-4777-8777-777777777777';
  let calls: { url: string; method: string; body?: Record<string, unknown> }[], existing: Set<string>, conflict: boolean;
  beforeEach(() => {
    calls = []; existing = new Set(); conflict = false;
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
      const url = String(u), method = init.method || 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const path = url.replace('https://sb.example', '');
      const who = path.match(/profiles\?id=eq\.([0-9a-f-]{36})/);
      if (who && [acmeOwner.id, wellOwner.id].includes(who[1]!)) return new Response(JSON.stringify([who[1] === acmeOwner.id ? acmeOwner : wellOwner]));
      if (path.startsWith('/auth/v1/invite')) return new Response(JSON.stringify({ id: INVITED }));
      if (who) return new Response(JSON.stringify(existing.has(who[1]!) ? [{ id: who[1] }] : []));
      if (path.startsWith('/rest/v1/profiles?select=id')) return new Response('[]');
      if (path.startsWith('/auth/v1/admin/users?')) return new Response(JSON.stringify({ users: [
        { id: MINE, email: 'mine@acme.example', user_metadata: { company_id: ACME } },
        { id: THEIRS, email: 'theirs@other.example', user_metadata: { company_id: WELL_COMPANY } },
        { id: HAND, email: 'by-hand@example.com' }] }));
      const one = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
      if (one) return new Response(JSON.stringify({ id: one[1], email: `${one[1]!.slice(0, 4)}@x.example`, user_metadata: one[1] === MINE ? { company_id: ACME } : one[1] === THEIRS ? { company_id: WELL_COMPANY } : {} }));
      if (path === '/rest/v1/profiles' && method === 'POST') return conflict ? new Response('{}', { status: 409 }) : new Response(JSON.stringify([body]));
      return new Response('[]');
    }));
  });
  const post = async (h: typeof users.POST, who: A.Profile, body: unknown) => h!(new Request('https://well.example/api/admin/x', { method: 'POST', body: JSON.stringify(body),
    headers: { cookie: await cookieOf(who), origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } }), E);
  const list = async (who: A.Profile) => ((await (await orphans.GET!(new Request('https://well.example/api/admin/orphans', { headers: { cookie: await cookieOf(who) } }), E)).json()) as { accounts: { id: string }[] }).accounts.map(a => a.id);

  it('the invite never merges: no write when the id already has a profile (any company), and the invite is stamped with the company', async () => {
    existing.add(INVITED);
    const res = await post(users.POST, acmeOwner, { email: 'new@acme.example', access: { creative: 'view' } });
    expect(res.status).toBe(409);
    expect(calls.some(c => c.url.endsWith('/rest/v1/profiles') && c.method === 'POST')).toBe(false);
    expect(calls.find(c => c.url.includes('/auth/v1/invite'))!.body).toMatchObject({ data: { company_id: ACME } });
  });
  it('a conflict on insert fails; a fresh id inserts without merge-duplicates', async () => {
    conflict = true;
    expect((await post(users.POST, acmeOwner, { email: 'new@acme.example', access: { creative: 'view' } })).status).toBe(409);
    conflict = false; calls = [];
    expect((await post(users.POST, acmeOwner, { email: 'new@acme.example', access: { creative: 'view' } })).status).toBe(200);
    const w = calls.find(c => c.url.endsWith('/rest/v1/profiles') && c.method === 'POST')!;
    expect(JSON.stringify(w)).not.toContain('merge-duplicates');
  });
  it('the list shows a company only its own accounts; unstamped accounts are the platform owner\'s', async () => {
    expect(await list(acmeOwner)).toEqual([MINE]);
    expect(await list(wellOwner)).toEqual([THEIRS, HAND]);
  });
  it('another company\'s pending account cannot be given a profile; one\'s own can', async () => {
    expect((await post(orphans.POST, acmeOwner, { id: THEIRS, access: { creative: 'view' } })).status).toBe(404);
    expect((await post(orphans.POST, acmeOwner, { id: HAND, access: { creative: 'view' } })).status).toBe(404);
    expect(calls.some(c => c.url.endsWith('/rest/v1/profiles') && c.method === 'POST')).toBe(false);
    expect((await post(orphans.POST, acmeOwner, { id: MINE, access: { creative: 'view' } })).status).toBe(200);
  });
});

describe('6. workflow actions are pinned to a full commit SHA', () => {
  it('every external `uses:` in .github/workflows is a 40-character SHA (local and reusable ./ paths are fine)', () => {
    const files = Object.entries(import.meta.glob('../../.github/workflows/*.yml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
    expect(files.length).toBeGreaterThan(5);
    for (const [f, txt] of files) {
      for (const m of txt.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
        if (m[1]!.startsWith('./')) continue;
        expect(m[1], `${f}: ${m[1]}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });
});
