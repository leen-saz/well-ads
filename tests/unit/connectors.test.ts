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
