// Routes of the Social tab that touch the platform connection: retry (approver only), what each role sees of a failure,
// choosing the page, and the dry-run check. The database is a small stub; the Graph API is graph-mock.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WELL_COMPANY } from '../../lib/tenant';
import { graphMock } from './graph-mock';
import { META_PENDING } from '../../lib/connectors';
import { postizMock } from './postiz-mock';
import { _clearStatusCache } from './postiz';

const SECRET = 's'.repeat(32);
const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', SESSION_SECRET: SECRET, OWNER_EMAIL: 'leen@x.co' };
afterEach(() => { vi.unstubAllGlobals(); });

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Db = { pz?: ReturnType<typeof postizMock>; post?: Record<string, unknown>; approvers?: string[]; vault?: { name: string; value: string }[]; connection?: Record<string, unknown> | null; graph?: typeof fetch };
async function call(method: string, path: string, who: { email: string; role: string }, db: Db, body: unknown = {}) {
  const { api } = await import('../../api/index');
  const { sign, SESSION } = await import('../../lib/auth');
  const p = { id: 'u1', email: who.email, role: who.role, dashboards: ['social'], access: { social: 'approve' }, departments: [], company_id: WELL_COMPANY, active: true };
  const writes: { url: string; body: unknown }[] = [], rpc: { fn: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.startsWith('https://pz.test') && db.pz) return db.pz.f(url, init);
    if (url.startsWith('https://graph.facebook.com') && db.graph) return db.graph(url, init);
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify([p]));
    if (url.includes('/rest/v1/companies')) return new Response(JSON.stringify([{ social_approvers: db.approvers ?? [] }]));
    if (url.includes('/rpc/connector_env')) return new Response(JSON.stringify(db.vault ?? []));
    if (url.includes('/rpc/')) { rpc.push({ fn: url.split('/rpc/')[1]!, body: JSON.parse(String(init.body)) }); return new Response('null'); }
    if (url.includes('/rest/v1/connections') && (init.method || 'GET') === 'GET') return new Response(JSON.stringify(db.connection ? [db.connection] : []));
    if (url.includes('/rest/v1/social_posts')) {
      if (init.method === 'PATCH') { writes.push({ url, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify([db.post])); }
      return new Response(JSON.stringify(db.post ? [db.post] : []));
    }
    if (init.method === 'POST' || init.method === 'PATCH') writes.push({ url, body: JSON.parse(String(init.body || '{}')) });
    return new Response('null');
  }));
  const now = Date.now();
  const token = await sign({ uid: p.id, email: who.email, name: '', role: who.role, dash: ['social'], lvl: { social: 'approve' }, depts: [], co: WELL_COMPANY, exp: now + 3600e3, chk: now }, SECRET);
  const res = await api.request('https://well.test' + path, { method, headers: { cookie: `${SESSION}=${token}`, origin: 'https://well.test', 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }, ENV);
  return { status: res.status, json: await res.json().catch(() => null) as Json | null, writes, rpc };
}
const failed = { id: 7, status: 'partial', platforms: ['facebook', 'instagram'], retried_at: null, publish_at: '2026-11-01T11:00:00Z', body: 'b', media: [],
  results: { facebook: { ok: true, id: 'p1_9' }, instagram: { ok: false, code: 'token', detail: 'Error validating access token (#190)', creation_id: 'c1' } } };
const OWNER = { email: 'leen@x.co', role: 'owner' }, MEMBER = { email: 'fahad@x.co', role: 'member' }, SARA = { email: 'sara@x.co', role: 'member' };

describe('failure state per role', () => {
  it('a member sees the reason as a code only; the owner also gets the platform text', async () => {
    const m = await call('GET', '/api/social/posts', MEMBER, { post: failed });
    const mr = m.json!.posts[0].results;
    expect(mr.instagram).toEqual({ ok: false, code: 'token' });
    expect(JSON.stringify(m.json)).not.toContain('#190');
    const o = await call('GET', '/api/social/posts', OWNER, { post: failed });
    expect(o.json!.posts[0].results.instagram).toMatchObject({ code: 'token', detail: expect.stringContaining('#190') });
    expect(JSON.stringify(o.json)).not.toContain('creation_id');
  });
});

describe('PATCH retry', () => {
  it('only a named approver; it clears just the failed platform, marks the one retry, and approves again', async () => {
    expect((await call('PATCH', '/api/social/posts', MEMBER, { post: failed, approvers: ['sara@x.co'] }, { id: 7, action: 'retry' })).status).toBe(403);
    const r = await call('PATCH', '/api/social/posts', SARA, { post: failed, approvers: ['sara@x.co'] }, { id: 7, action: 'retry' });
    expect(r.status).toBe(200);
    const w = r.writes.find(x => x.url.includes('retried_at=is.null'))!;
    expect(w.body).toMatchObject({ status: 'scheduled', approved_by: 'sara@x.co', claimed_at: null });
    expect((w.body as Json).results).toEqual({ facebook: { ok: true, id: 'p1_9' } });
    expect((w.body as Json).retried_at).toBeTruthy();
  });
  it('a second retry, a post that did not fail and a post with nothing to retry are refused', async () => {
    expect((await call('PATCH', '/api/social/posts', OWNER, { post: { ...failed, retried_at: '2026-11-01T12:00:00Z' } }, { id: 7, action: 'retry' })).status).toBe(409);
    expect((await call('PATCH', '/api/social/posts', OWNER, { post: { ...failed, status: 'published' } }, { id: 7, action: 'retry' })).status).toBe(409);
    expect((await call('PATCH', '/api/social/posts', OWNER, {}, { id: 7, action: 'retry' })).status).toBe(404);
  });
});

describe('choosing the page', () => {
  const pending = (age = 0) => [{ name: META_PENDING, value: JSON.stringify({ at: Date.now() - age, pages: [
    { id: 'p1', name: 'Well Care', token: 'tok-1', ig: { id: 'ig1', name: 'well.care' } }, { id: 'p2', name: 'Well Kids', token: 'tok-2' }] }) }];
  it('lists names only (no tokens) to the owner, nothing to anyone else', async () => {
    const o = await call('GET', '/api/social/pages', OWNER, { vault: pending(), connection: { shown: {}, names: [META_PENDING] } });
    expect(o.json!.choices).toEqual([{ id: 'p1', name: 'Well Care', instagram: 'well.care' }, { id: 'p2', name: 'Well Kids', instagram: null }]);
    expect(o.json!.account.pick).toBe(true);
    expect(JSON.stringify(o.json)).not.toContain('tok-');
    expect((await call('GET', '/api/social/pages', MEMBER, { vault: pending() })).status).toBe(403);
  });
  it('the owner binds the chosen page; a page without Instagram drops the old Instagram id', async () => {
    const r = await call('POST', '/api/social/pages', OWNER, { vault: pending(), connection: { shown: {}, names: [] } }, { id: 'p2' });
    expect(r.status).toBe(200);
    expect(r.rpc.filter(x => x.fn === 'connector_put').map(x => x.body.p_name).sort()).toEqual(['META_PAGE_ACCESS_TOKEN', 'META_PAGE_ID']);
    expect(r.rpc.find(x => x.fn === 'connector_put' && x.body.p_name === 'META_PAGE_ID')!.body.p_value).toBe('p2');
    expect(r.rpc.find(x => x.fn === 'connector_drop')!.body.p_names).toEqual(['IG_USER_ID', META_PENDING]);
    const conn = r.writes.find(x => x.url.includes('/rest/v1/connections'))!.body as Json;
    expect(conn.shown).toMatchObject({ META_PAGE_NAME: 'Well Kids', IG_ACCOUNT_NAME: '' });
    const withIg = await call('POST', '/api/social/pages', OWNER, { vault: pending(), connection: { shown: {}, names: [] } }, { id: 'p1' });
    expect(withIg.rpc.filter(x => x.fn === 'connector_put').map(x => x.body.p_name)).toContain('IG_USER_ID');
  });
  it('a member, an unknown page and a choice left for over an hour are refused', async () => {
    expect((await call('POST', '/api/social/pages', MEMBER, { vault: pending() }, { id: 'p1' })).status).toBe(403);
    expect((await call('POST', '/api/social/pages', OWNER, { vault: pending() }, { id: 'nope' })).status).toBe(409);
    expect((await call('POST', '/api/social/pages', OWNER, { vault: pending(2 * 3600e3) }, { id: 'p1' })).status).toBe(409);
  });
  it('the connected account shows as names on the posts list', async () => {
    const r = await call('GET', '/api/social/posts', MEMBER, { connection: { shown: { META_PAGE_NAME: 'Well Care', IG_ACCOUNT_NAME: 'well.care' }, names: ['META_PAGE_ID', 'IG_USER_ID', 'META_PAGE_ACCESS_TOKEN'] } });
    expect(r.json!.account).toEqual({ page: 'Well Care', instagram: 'well.care', pick: false });
  });
});

describe('GET /api/social/connection (test post, nothing posted)', () => {
  it('the owner gets the readiness; others do not', async () => {
    const g = graphMock();
    const vault = [{ name: 'META_PAGE_ACCESS_TOKEN', value: g.cfg.token }, { name: 'META_PAGE_ID', value: 'p1' }, { name: 'IG_USER_ID', value: 'ig1' }];
    const r = await call('GET', '/api/social/connection', OWNER, { vault, graph: g.f });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ page: 'Well Care', instagram: 'well.care' });
    expect(g.st.calls.filter(c => c.method === 'POST')).toHaveLength(0);
    expect((await call('GET', '/api/social/connection', MEMBER, { vault, graph: g.f })).status).toBe(403);
  });
});

describe('the extra publishing engine on the Social tab', () => {
  const pz = () => postizMock({ channels: [{ id: 'c-x', name: 'Well X', identifier: 'x' }] });
  const vault = (m: ReturnType<typeof postizMock>) => Object.entries(m.tokens).map(([name, value]) => ({ name, value }));
  afterEach(() => _clearStatusCache());
  it('GET /api/social/engine: owner only; channel names, no key', async () => {
    const m = pz();
    const o = await call('GET', '/api/social/engine', OWNER, { vault: vault(m), pz: m });
    expect(o.status).toBe(200);
    expect(o.json!.status).toBe('ok');
    expect(o.json!.channels).toContainEqual({ platform: 'x', code: 'ok', names: ['Well X'] });
    expect(JSON.stringify(o.json)).not.toContain('pz-key');
    expect((await call('GET', '/api/social/engine', MEMBER, { vault: vault(m), pz: m })).status).toBe(403);
    expect(m.st.calls.filter(c => c.path === '/posts')).toHaveLength(0);   // a check never posts
  });
  it('the post list: a platform is live only when connected in the engine; everyone sees the same short words, the owner gets the reasons from the check', async () => {
    const m = pz();
    for (const who of [OWNER, MEMBER]) {
      const r = await call('GET', '/api/social/posts', who, { vault: vault(m), pz: m });
      expect(r.json!.platforms.x.live).toBe(true);
      expect(r.json!.platforms.tiktok.live).toBe(false);
      expect(r.json!.ready.x).toBe('');
      expect(r.json!.ready.tiktok).toBe('غير متاح الحين: بينحفظ كتذكير');
      expect(JSON.stringify(r.json)).not.toMatch(/postiz|pz-key|channel/i);
    }
    _clearStatusCache();
    const off = await call('GET', '/api/social/posts', MEMBER, { vault: [], pz: m });
    expect(off.json!.platforms.x.live).toBe(false);
  });
});
