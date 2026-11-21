/* eslint-disable @typescript-eslint/no-explicit-any -- recorded request bodies are read loosely in assertions */
// Write access checked automatically (M12a, 044_account_permissions.sql): read-only calls on the accounts already connected.
// Fakes only; every token below is made up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkWriteAccess, judgeScopes, judgeTikTok, runWriteAccess } from '../../src/lib/write-access';
import { TIKTOK_MCP, _clearTokenCache } from '../../src/mcp/adapters/tiktok';
import { hourlyTasks } from '../../src/lib/cron';

const cfg = { url: 'https://sb.example', anon: 'anon', service: 'service' } as never;
function world(vault: Record<string, string>, scopes: Record<string, string[] | 'invalid' | 'error'>, tiktokTools: string[] = []) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const url = String(u), method = init.method || 'GET';
    let body: any = init.body ? String(init.body) : null; try { body = JSON.parse(body); } catch { /* form */ }
    calls.push({ url, method, body });
    const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (url.endsWith('/rpc/connector_env')) return j(Object.entries(vault).map(([name, value]) => ({ name, value })));
    if (url.includes('graph.facebook.com') && url.includes('/debug_token')) {
      const tok = new URL(url).searchParams.get('input_token')!;
      const s = scopes[tok];
      if (s === 'error') return j({ error: { code: 1, message: 'x' } }, 500);
      return j({ data: s === 'invalid' ? { is_valid: false } : { is_valid: true, scopes: s } });
    }
    if (url === TIKTOK_MCP.token) return j({ access_token: 'acc', expires_in: 3600 });
    if (url === TIKTOK_MCP.resource) {
      if (body?.method === 'initialize') return j({ jsonrpc: '2.0', id: body.id, result: {} });
      if (!body?.id) return new Response(null, { status: 202 });
      return j({ jsonrpc: '2.0', id: body.id, result: { tools: tiktokTools.map(name => ({ name })) } });
    }
    return j([]);
  }));
  return calls;
}
beforeEach(() => _clearTokenCache());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('judging', () => {
  it('Meta scopes: write, partial, read only, unknown', () => {
    expect(judgeScopes('meta', ['ads_read', 'ads_management'])).toMatchObject({ state: 'write', missing: [] });
    expect(judgeScopes('meta', ['ads_read'])).toMatchObject({ state: 'read_only', missing: ['ads_management'] });
    expect(judgeScopes('meta_pages', ['pages_manage_posts'])).toMatchObject({ state: 'partial', missing: ['instagram_content_publish'] });
    expect(judgeScopes('meta_pages', null)).toMatchObject({ state: 'unknown', code: 'scopes_unreadable' });
  });
  it('TikTok: a sign-in whose tool list has a write tool can write', () => {
    expect(judgeTikTok(['ad_get', 'campaign_create']).state).toBe('write');
    expect(judgeTikTok(['ad_get', 'report_integrated_get']).state).toBe('read_only');
    expect(judgeTikTok([]).state).toBe('unknown');
  });
});

describe('checkWriteAccess', () => {
  it('checks only what is connected, with read calls only, and never returns a token', async () => {
    const calls = world({ META_ACCESS_TOKEN: 'ADS-SECRET-1', META_PAGE_ACCESS_TOKEN: 'PAGE-SECRET-1', TIKTOK_MCP_CLIENT_ID: 'c', TIKTOK_MCP_REFRESH_TOKEN: 'r' },
      { 'ADS-SECRET-1': ['ads_read'], 'PAGE-SECRET-1': ['pages_manage_posts', 'instagram_content_publish'] }, ['ad_get', 'campaign_create']);
    const r = await checkWriteAccess(cfg, {} as never);
    expect(r).toEqual([
      { platform: 'meta', state: 'read_only', missing: ['ads_management'], code: null },
      { platform: 'meta_pages', state: 'write', missing: [], code: null },
      { platform: 'tiktok', state: 'write', missing: [], code: null },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/SECRET|acc/);
    // Graph: debug_token reads only; TikTok: only tools/list besides the session start (no tools/call)
    expect(calls.filter(c => c.url.includes('graph.facebook.com')).every(c => c.method === 'GET')).toBe(true);
    expect(calls.some(c => (c.body as any)?.method === 'tools/call')).toBe(false);
  });
  it('nothing connected: nothing checked, nothing stored', async () => {
    const calls = world({}, {});
    expect(await runWriteAccess(cfg, {} as never)).toBe(0);
    expect(calls.some(c => c.url.includes('account_permissions'))).toBe(false);
  });
  it('an invalid or unreadable token is "unknown", not a demand to reconnect; Snapchat follows its write keys', async () => {
    world({ META_ACCESS_TOKEN: 'bad', SNAP_REFRESH_TOKEN: 's' }, { bad: 'invalid' });
    expect(await checkWriteAccess(cfg, {} as never)).toEqual([
      { platform: 'meta', state: 'unknown', missing: [], code: 'scopes_unreadable' },
      { platform: 'snap', state: 'read_only', missing: ['SNAP_WRITE_*'], code: 'exec_keys' },
    ]);
  });
  it('stores one row per connection for Well', async () => {
    const calls = world({ META_ACCESS_TOKEN: 'ADS-SECRET-1' }, { 'ADS-SECRET-1': ['ads_management'] });
    expect(await runWriteAccess(cfg, {} as never, fetch, Date.parse('2026-11-21T01:07:00Z'))).toBe(1);
    const w = calls.find(c => c.url.includes('/account_permissions?on_conflict=company_id,platform'))!;
    expect(w.body).toEqual([{ company_id: '00000000-0000-0000-0000-000000000001', platform: 'meta', state: 'write', missing: [], code: null, checked_at: '2026-11-21T01:07:00.000Z' }]);
  });
});

describe('schedule', () => {
  it('runs once a day, at 01:xx UTC', () => {
    const at = (h: number) => hourlyTasks(new Date(Date.UTC(2026, 10, 18, h, 7)));
    expect(at(1)).toContain('perms');
    for (const h of [0, 2, 13, 23]) expect(at(h)).not.toContain('perms');
  });
});
