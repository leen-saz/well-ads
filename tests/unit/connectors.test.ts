import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/api/index';
import { PLATFORMS, oauth1 } from '../../src/lib/connectors';
import { sign, SESSION, type AuthEnv } from '../../src/lib/auth';

const ENV: AuthEnv = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', SESSION_SECRET: 's'.repeat(32), OWNER_EMAIL: 'leen@x.co' };
const ORIGIN = 'https://well.test';
const USER = { id: 'u1', email: 'm@x.co', role: 'member', dashboards: ['connectors'], active: true };

async function cookie() {
  const now = Date.now();
  return `${SESSION}=${await sign({ uid: USER.id, email: USER.email, name: '', role: 'member', dash: USER.dashboards, depts: [], exp: now + 3600e3, chk: now }, ENV.SESSION_SECRET as string)}`;
}
function db(rest: (url: string, init: RequestInit) => unknown = () => []) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const data = url.includes('/rest/v1/profiles') ? [USER] : rest(url, init);
    return new Response(data == null ? '' : JSON.stringify(data), { status: 200 });
  }));
  return calls;
}
async function call(path: string, init: RequestInit = {}, env: AuthEnv = ENV) {
  const headers = new Headers(init.headers);
  headers.set('cookie', await cookie());
  if (init.method && init.method !== 'GET') { headers.set('origin', ORIGIN); headers.set('content-type', 'application/json'); }
  return api.request(ORIGIN + path, { ...init, headers }, env);
}
afterEach(() => vi.unstubAllGlobals());

describe('/api/connectors', () => {
  it('lists every platform with its status and never a secret value', async () => {
    db(url => (url.includes('/connections') ? [{ platform: 'meta', names: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'], shown: { META_AD_ACCOUNT_ID: 'act_1' } }] : []));
    const res = await call('/api/connectors/list');
    const { platforms } = await res.json() as { platforms: { id: string; status: string; oauthReady: boolean; fields: { env: string; saved: boolean; shown: string }[] }[] };
    expect(platforms).toHaveLength(PLATFORMS.length);
    const meta = platforms.find(p => p.id === 'meta');
    expect(meta?.status).toBe('ok');
    expect(meta?.oauthReady).toBe(false);
    expect(meta?.fields.find(f => f.env === 'META_ACCESS_TOKEN')).toMatchObject({ saved: true, shown: '' });
    expect(meta?.fields.find(f => f.env === 'META_AD_ACCOUNT_ID')?.shown).toBe('act_1');
  });

  it('the Connect button is ready once the app credentials are Cloudflare secrets', async () => {
    db();
    const res = await call('/api/connectors/list', {}, { ...ENV, META_APP_ID: 'a', META_APP_SECRET: 'b' } as AuthEnv);
    const { platforms } = await res.json() as { platforms: { id: string; oauthReady: boolean }[] };
    expect(platforms.find(p => p.id === 'meta')?.oauthReady).toBe(true);
  });

  it('saves values through the vault RPC and audits names only', async () => {
    const calls = db(() => []);
    const res = await call('/api/connectors/save', { method: 'POST', body: JSON.stringify({ platform: 'heap', values: { HEAP_API_KEY: 'k-123', HEAP_APP_ID: '42' } }) });
    expect(res.status).toBe(200);
    const puts = calls.filter(c => c.url.endsWith('/rpc/connector_put')).map(c => c.body);
    expect(puts).toEqual([{ p_name: 'HEAP_API_KEY', p_value: 'k-123' }, { p_name: 'HEAP_APP_ID', p_value: '42' }]);
    const row = calls.find(c => c.url.endsWith('/rest/v1/connections') && c.method === 'POST')?.body as { shown: Record<string, string> };
    expect(row.shown).toEqual({ HEAP_APP_ID: '42' });
    const log = JSON.stringify(calls.filter(c => c.url.includes('audit_log')).map(c => c.body));
    expect(log).toContain('HEAP_API_KEY');
    expect(log).not.toContain('k-123');
  });

  it('rejects an unknown platform and an empty form', async () => {
    db();
    expect((await call('/api/connectors/save', { method: 'POST', body: '{"platform":"nope","values":{}}' })).status).toBe(400);
    expect((await call('/api/connectors/save', { method: 'POST', body: '{"platform":"heap","values":{}}' })).status).toBe(400);
  });

  it('callback without a valid state goes back with err=state and clears the nonce cookie', async () => {
    db();
    const res = await api.request(ORIGIN + '/api/connectors/callback?state=bad&code=x', {}, ENV);
    expect(await res.text()).toContain('/connectors/?err=state');
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('start without app credentials explains what is missing', async () => {
    db();
    const res = await call('/api/connectors/start?platform=meta');
    expect(res.status).toBe(400);
  });
});

const OAUTH_COOKIE = '__Secure-well_oauth';
const MCP_REFRESH = 'mcp-refresh-test-token';

describe('TikTok MCP sign-in', () => {
  it('registers a client and sends the user to TikTok with PKCE and the MCP resource', async () => {
    const sent: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      sent.push({ url, body: typeof init.body === 'string' ? init.body : '' });
      if (url.endsWith('/oauth/register')) return new Response(JSON.stringify({ client_id: 'cid-1' }), { status: 201 });
      return new Response(JSON.stringify(url.includes('/profiles') ? [USER] : []), { status: 200 });
    }));
    const res = await call('/api/connectors/start?platform=tiktok');
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location') || '');
    expect(`${loc.origin}${loc.pathname}`).toBe('https://business-api.tiktok.com/portal/mcp-tt4b-authorize');
    expect(loc.searchParams.get('client_id')).toBe('cid-1');
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(loc.searchParams.get('resource')).toBe('https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/connectors/callback`);
    const reg = JSON.parse(sent.find(c => c.url.endsWith('/oauth/register'))?.body || '{}');
    expect(reg).toMatchObject({ redirect_uris: [`${ORIGIN}/api/connectors/callback`], token_endpoint_auth_method: 'none' });
    // the verifier rides in the httpOnly nonce cookie, never in the URL
    const cookie = res.headers.get('set-cookie') || '';
    expect(cookie).toContain('HttpOnly');
    const verifier = decodeURIComponent(cookie.split(';')[0]?.split('=')[1] || '').split('.')[1] || '';
    expect(verifier.length).toBeGreaterThan(40);
    expect(loc.toString()).not.toContain(verifier);
  });

  it('exchanges the code with the verifier and saves only names + the refresh token in the vault', async () => {
    const nonce = 'n1', verifier = 'v'.repeat(43);
    const state = await sign({ uid: USER.id, p: 'tiktok', n: nonce, c: 'cid-1', exp: Date.now() + 600_000 }, ENV.SESSION_SECRET as string);
    const calls: { url: string; method: string; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : '';
      calls.push({ url, method: init.method || 'GET', body });
      if (url.endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'a', refresh_token: MCP_REFRESH, expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify(url.includes('/profiles') ? [USER] : []), { status: 200 });
    }));
    const res = await api.request(`${ORIGIN}/api/connectors/callback?code=c-1&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `${OAUTH_COOKIE}=${encodeURIComponent(`${nonce}.${verifier}`)}` },
    }, ENV);
    const text = await res.text();
    expect(text).toContain('/connectors/?ok=tiktok');
    expect(text).not.toContain(MCP_REFRESH);
    const tok = new URLSearchParams(calls.find(c => c.url.endsWith('/oauth/token'))?.body || '');
    expect(Object.fromEntries(tok)).toMatchObject({ grant_type: 'authorization_code', code: 'c-1', client_id: 'cid-1', code_verifier: verifier,
      resource: 'https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat' });
    const puts = calls.filter(c => c.url.endsWith('/rpc/connector_put')).map(c => JSON.parse(c.body));
    expect(puts).toEqual([{ p_name: 'TIKTOK_MCP_CLIENT_ID', p_value: 'cid-1' }, { p_name: 'TIKTOK_MCP_REFRESH_TOKEN', p_value: MCP_REFRESH }]);
    const log = JSON.stringify(calls.filter(c => c.url.includes('audit_log')));
    expect(log).not.toContain(MCP_REFRESH);
  });

  it('rejects a bad state before calling TikTok or the vault', async () => {
    const state = await sign({ uid: USER.id, p: 'tiktok', n: 'expected', c: 'cid', exp: Date.now() + 600_000 }, ENV.SESSION_SECRET as string);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return new Response('[]', { status: 200 }); }));
    const res = await api.request(`${ORIGIN}/api/connectors/callback?code=x&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `${OAUTH_COOKIE}=${encodeURIComponent('other.v')}` },
    }, ENV);
    expect(await res.text()).toContain('/connectors/?err=state');
    expect(calls.some(u => u.includes('tiktok') || u.includes('connector_put'))).toBe(false);
  });

  it('shows MCP until signed in, then connected with an expiry; a pasted key is refused', async () => {
    db();
    const before = (await (await call('/api/connectors/list')).json() as { platforms: { id: string; status: string; oauthReady: boolean }[] }).platforms.find(p => p.id === 'tiktok');
    expect(before).toMatchObject({ status: 'mcp', oauthReady: true });
    db(url => (url.includes('/connections') ? [{ platform: 'tiktok', method: 'oauth', names: ['TIKTOK_MCP_CLIENT_ID', 'TIKTOK_MCP_REFRESH_TOKEN'], shown: {},
      expires_at: new Date(Date.now() + 864e5).toISOString() }] : []));
    const after = (await (await call('/api/connectors/list')).json() as { platforms: { id: string; status: string }[] }).platforms.find(p => p.id === 'tiktok');
    expect(after?.status).toBe('ok');
    const saved = await call('/api/connectors/save', { method: 'POST', body: JSON.stringify({ platform: 'tiktok', values: { TIKTOK_ACCESS_TOKEN: 'x' } }) });
    expect(saved.status).toBe(400);
  });
});

describe('meta_pages exchange', () => {
  it('stores the page token, page id and linked Instagram id from the granted page', async () => {
    const { exchange, byId } = await import('../../src/lib/connectors');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('/oauth/access_token') && url.includes('code=')) return new Response(JSON.stringify({ access_token: 'short' }));
      if (url.includes('fb_exchange_token')) return new Response(JSON.stringify({ access_token: 'long', expires_in: 5184000 }));
      if (url.includes('/me/accounts')) return new Response(JSON.stringify({ data: [{ id: '111', name: 'Well', access_token: 'page-tok', instagram_business_account: { id: '222' } }] }));
      return new Response('{}', { status: 404 });
    }));
    const p = byId('meta_pages');
    expect(p).not.toBeNull();
    const got = await exchange(p!, { code: 'c', redirect: 'https://x/cb', id: 'app', secret: 's' });
    expect(got).toEqual({ values: { META_PAGE_ID: '111', META_PAGE_ACCESS_TOKEN: 'page-tok', IG_USER_ID: '222' }, expiresIn: null });
    expect(urls.some(u => u.includes('/me/accounts') && u.includes('access_token=long'))).toBe(true);
  });
  it('fails when no page was granted', async () => {
    const { exchange, byId } = await import('../../src/lib/connectors');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/me/accounts') ? { data: [] } : { access_token: 't' }))));
    await expect(exchange(byId('meta_pages')!, { code: 'c', redirect: 'r', id: 'a', secret: 's' })).rejects.toThrow('no page');
  });
});

describe('oauth1 (X)', () => {
  it('signs with HMAC-SHA1 and parses the form reply', async () => {
    let auth = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      auth = new Headers(init.headers).get('authorization') || '';
      return new Response('oauth_token=t&oauth_token_secret=s');
    }));
    const r = await oauth1('https://api.x.com/oauth/request_token', { key: 'ck', secret: 'cs', extra: { oauth_callback: 'https://w/cb' } });
    expect(r).toEqual({ oauth_token: 't', oauth_token_secret: 's' });
    expect(auth).toMatch(/^OAuth .*oauth_signature_method="HMAC-SHA1".*oauth_signature="[^"]+"/);
  });
});
