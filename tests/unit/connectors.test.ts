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

const TT = { ...ENV, TIKTOK_APP_ID: 'tt-app', TIKTOK_APP_SECRET: 'tt-app-secret' } as AuthEnv;
const TT_TOKEN = 'tt-oauth-test-token';
const TT_CODE = 'test-auth-code';
const WELL_ID = '7532842350553514000';
const ROSE_ID = '6948010864247046146';
const EXTRA_ID = '7011111111111111111';
const OAUTH_COOKIE = '__Secure-well_oauth';

describe('TikTok OAuth', () => {
  it('starts at the TikTok portal and keeps the app secret off the URL', async () => {
    db();
    const res = await call('/api/connectors/start?platform=tiktok', {}, TT);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location') || '');
    expect(`${loc.origin}${loc.pathname}`).toBe('https://business-api.tiktok.com/portal/auth');
    expect(loc.searchParams.get('app_id')).toBe('tt-app');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/connectors/callback`);
    expect(loc.searchParams.get('state')).toBeTruthy();
    expect(loc.searchParams.get('client_id')).toBeNull();
    expect(loc.searchParams.get('response_type')).toBeNull();
    expect(loc.toString()).not.toContain('tt-app-secret');
  });

  it('exchanges auth_code, saves the token, and drops Spring Rose', async () => {
    const nonce = 'n-tiktok';
    const state = await sign({ uid: USER.id, p: 'tiktok', n: nonce, exp: Date.now() + 600_000 }, ENV.SESSION_SECRET as string);
    const calls: { url: string; method: string; body: string | undefined }[] = [];
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => { logs.push(args); });
    const raw = `{"code":0,"message":"OK","data":{"access_token":"${TT_TOKEN}","advertiser_ids":[${ROSE_ID},"${WELL_ID}",${EXTRA_ID},${ROSE_ID}],"scope":[1]}}`;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? init.body : undefined;
      calls.push({ url, method: init.method || 'GET', body });
      if (url.includes('business-api.tiktok.com')) {
        return new Response(raw, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const data = url.includes('/rest/v1/profiles') ? [USER] : [];
      return new Response(JSON.stringify(data), { status: 200 });
    }));
    const u = new URL('/api/connectors/callback', ORIGIN);
    u.searchParams.set('auth_code', TT_CODE);
    u.searchParams.set('state', state);
    const res = await api.request(u.toString(), { headers: { cookie: `${OAUTH_COOKIE}=${encodeURIComponent(nonce)}` } }, TT);
    const text = await res.text();
    const echoed = [text, res.headers.get('set-cookie') || '', JSON.stringify(logs)].join('\n');
    expect(text).toContain('/connectors/?ok=tiktok');
    expect(echoed).not.toContain(TT_TOKEN);
    expect(echoed).not.toContain('tt-app-secret');
    expect(echoed).not.toContain(TT_CODE);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();

    const sent = calls.find(c => c.url.includes('oauth2/access_token'));
    expect(sent?.url).toBe('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/');
    expect(sent?.url).not.toContain(TT_TOKEN);
    expect(JSON.parse(sent?.body || '')).toEqual({ app_id: 'tt-app', secret: 'tt-app-secret', auth_code: TT_CODE });
    const puts = calls.filter(c => c.url.endsWith('/rpc/connector_put')).map(c => JSON.parse(c.body || ''));
    expect(puts).toEqual([
      { p_name: 'TIKTOK_ACCESS_TOKEN', p_value: TT_TOKEN },
      { p_name: 'TIKTOK_ADVERTISER_IDS', p_value: `${WELL_ID},${EXTRA_ID}` },
    ]);
    expect(puts[1].p_value).not.toContain(ROSE_ID);
    expect(puts[1].p_value).not.toContain(String(JSON.parse(EXTRA_ID)));
    const elsewhere = calls.filter(c => !c.url.includes('connector_put') && !c.url.includes('business-api.tiktok.com'));
    expect(JSON.stringify(elsewhere)).not.toContain(TT_TOKEN);
    const row = calls.find(c => c.url.endsWith('/rest/v1/connections') && c.method === 'POST');
    expect(JSON.parse(row?.body || '')).toMatchObject({
      platform: 'tiktok', method: 'oauth', names: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_IDS'], shown: {},
    });
  });

  it('rejects a bad state before calling TikTok or the vault', async () => {
    const state = await sign({ uid: USER.id, p: 'tiktok', n: 'expected', exp: Date.now() + 600_000 }, ENV.SESSION_SECRET as string);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(url.includes('/profiles') ? JSON.stringify([USER]) : '[]', { status: 200 });
    }));
    const res = await api.request(`${ORIGIN}/api/connectors/callback?auth_code=${TT_CODE}&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `${OAUTH_COOKIE}=${encodeURIComponent('other-nonce')}` },
    }, TT);
    expect(await res.text()).toContain('/connectors/?err=state');
    expect(calls.some(u => u.includes('tiktok') || u.includes('connector_put'))).toBe(false);
  });

  it('does not save or log the token when TikTok rejects the code', async () => {
    const nonce = 'n-tiktok-bad';
    const state = await sign({ uid: USER.id, p: 'tiktok', n: nonce, exp: Date.now() + 600_000 }, ENV.SESSION_SECRET as string);
    const calls: string[] = [];
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => { logs.push(args); });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('business-api.tiktok.com')) {
        return new Response(JSON.stringify({ code: 40115, message: `nope ${TT_TOKEN}`, data: { access_token: TT_TOKEN } }), { status: 200 });
      }
      return new Response(url.includes('/profiles') ? JSON.stringify([USER]) : '[]', { status: 200 });
    }));
    const u = new URL('/api/connectors/callback', ORIGIN);
    u.searchParams.set('auth_code', TT_CODE);
    u.searchParams.set('state', state);
    const res = await api.request(u.toString(), { headers: { cookie: `${OAUTH_COOKIE}=${encodeURIComponent(nonce)}` } }, TT);
    const text = await res.text();
    expect(text).toContain('/connectors/?err=exchange');
    expect(text).not.toContain(TT_TOKEN);
    expect(JSON.stringify(logs)).not.toContain(TT_TOKEN);
    expect(calls.some(url => url.includes('connector_put'))).toBe(false);
    spy.mockRestore();
  });

  it('TikTok stays on MCP whatever is saved, and refuses a pasted key', async () => {
    db(url => (url.includes('/connections') ? [{
      platform: 'tiktok', method: 'oauth', names: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_IDS'], shown: {},
    }] : []));
    const ready = await call('/api/connectors/list', {}, TT);
    const { platforms } = await ready.json() as { platforms: { id: string; status: string; oauth: boolean; oauthReady: boolean; mcp: boolean; help: string }[] };
    const tiktok = platforms.find(p => p.id === 'tiktok');
    expect(tiktok).toMatchObject({ status: 'mcp', oauth: true, oauthReady: true, mcp: true });
    expect(JSON.stringify(tiktok)).not.toContain(TT_TOKEN);
    expect(tiktok?.help).toContain('MCP');

    db();
    const fresh = await call('/api/connectors/list', {}, TT);
    const again = (await fresh.json() as { platforms: { id: string; status: string }[] }).platforms.find(p => p.id === 'tiktok');
    expect(again?.status).toBe('mcp');

    const saved = await call('/api/connectors/save', { method: 'POST', body: JSON.stringify({ platform: 'tiktok', values: { TIKTOK_ACCESS_TOKEN: TT_TOKEN } }) }, TT);
    expect(saved.status).toBe(400);
    expect(await saved.text()).not.toContain(TT_TOKEN);
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
