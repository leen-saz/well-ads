/* eslint-disable @typescript-eslint/no-explicit-any -- recorded request bodies are read loosely in assertions */
// TikTok adapter (M14): TikTok's MCP server, read-only, one configured advertiser, the rotated refresh token saved before use.
// Fakes only: a fake vault and a fake TikTok MCP server; every token below is made up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIKTOK_MCP, TikTokMcp, accessToken, advertiserOf, rpcMessage, _clearTokenCache } from '../../src/mcp/adapters/tiktok';
import { callTool } from '../../src/mcp/call';
import { parsePeriod } from '../../src/mcp/tools/tiktok';
import { WELL_COMPANY } from '../../src/lib/tenant';

const cfg = { url: 'https://sb.example', anon: 'anon', service: 'service' } as never;
type Call = { url: string; method: string; body: any; headers: Record<string, string> };
function world(o: { rotate?: string | null; saveFails?: boolean; tokenStatus?: number; vault?: Record<string, string>; tool?: (name: string, args: any) => unknown } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const url = String(u), method = init.method || 'GET', raw = init.body ? String(init.body) : '';
    let body: any = raw; try { body = JSON.parse(raw); } catch { /* form or empty */ }
    calls.push({ url, method, body, headers: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()) });
    const j = (v: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: h });
    if (url.endsWith('/rpc/connector_env')) return j(Object.entries(o.vault ?? { TIKTOK_MCP_CLIENT_ID: 'cid', TIKTOK_MCP_REFRESH_TOKEN: 'r1' }).map(([name, value]) => ({ name, value })));
    if (url.endsWith('/rpc/connector_put')) return o.saveFails ? j({}, 500) : j(null);
    if (url === TIKTOK_MCP.token) return o.tokenStatus ? j({ error: 'invalid_grant' }, o.tokenStatus) : j({ access_token: 'acc', expires_in: 86400, ...(o.rotate ? { refresh_token: o.rotate } : {}) });
    if (url === TIKTOK_MCP.resource) {
      if (body.method === 'initialize') return j({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }, 200, { 'mcp-session-id': 'sess1' });
      if (!body.id) return new Response(null, { status: 202 });
      const data = o.tool ? o.tool(body.params.name, body.params.arguments) : { list: [], page_info: { total_page: 1 } };
      // answered as server-sent events, as TikTok's server may
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { code: 0, data } } })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return j([]);
  }));
  return calls;
}
const E = { TIKTOK_ADVERTISER_ID: '7000000000000000001' };
const ctx = (env: Record<string, unknown> = E) => ({ cfg, env, company: WELL_COMPANY, actor: 'agent:buyer' as const, scope: 'read' as const, mode: 'approve' as const });
beforeEach(() => _clearTokenCache());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the one advertiser', () => {
  it('needs TIKTOK_ADVERTISER_ID, and never an excluded one', () => {
    expect(advertiserOf(E)).toBe('7000000000000000001');
    expect(() => advertiserOf({})).toThrow('no_advertiser');
    expect(() => advertiserOf({ TIKTOK_ADVERTISER_ID: 'abc' })).toThrow('no_advertiser');
    expect(() => advertiserOf({ ...E, TIKTOK_EXCLUDED_ADVERTISER_IDS: '1, 7000000000000000001' })).toThrow('excluded');
  });
});

describe('accessToken', () => {
  it('a rotated refresh token is saved before the access token is used, and kept in memory until it expires', async () => {
    const calls = world({ rotate: 'r2' });
    expect(await accessToken(cfg, WELL_COMPANY)).toBe('acc');
    const grant = calls.find(c => c.url === TIKTOK_MCP.token)!;
    expect(String(grant.body)).toContain('grant_type=refresh_token');
    expect(calls.find(c => c.url.endsWith('/rpc/connector_put'))!.body).toEqual({ p_name: 'TIKTOK_MCP_REFRESH_TOKEN', p_value: 'r2' });
    await accessToken(cfg, WELL_COMPANY);
    expect(calls.filter(c => c.url === TIKTOK_MCP.token)).toHaveLength(1);
  });
  it('a rotation that cannot be saved stops everything; not connected and a refused grant are plain codes', async () => {
    world({ rotate: 'r2', saveFails: true });
    await expect(accessToken(cfg, WELL_COMPANY)).rejects.toThrow('rotated_not_saved');
    world({ vault: {} });
    await expect(accessToken(cfg, WELL_COMPANY)).rejects.toThrow('not_connected');
    world({ tokenStatus: 400 });
    await expect(accessToken(cfg, WELL_COMPANY)).rejects.toMatchObject({ code: 'token' });
  });
});

describe('TikTokMcp', () => {
  it('starts a session, keeps its id, and reads answers sent as events', async () => {
    const calls = world({ tool: () => ({ list: [{ campaign_id: '1' }], page_info: { total_page: 1 } }) });
    const m = new TikTokMcp('acc');
    await m.start();
    expect(await m.read('campaign_get', { advertiser_id: '7' })).toEqual({ list: [{ campaign_id: '1' }], page_info: { total_page: 1 } });
    const last = calls[calls.length - 1]!;
    expect(last.headers['mcp-session-id']).toBe('sess1');
    expect(last.headers.authorization).toBe('Bearer acc');
  });
  it('refuses any tool that is not a read (_get or _list) without calling TikTok', async () => {
    const calls = world();
    const m = new TikTokMcp('acc');
    for (const n of ['campaign_create', 'ad_update', 'adgroup_status_update', 'get_everything']) await expect(m.read(n, {})).rejects.toMatchObject({ code: 'refused' });
    expect(calls).toEqual([]);
  });
  it('follows pages', async () => {
    world({ tool: (_n, a) => ({ list: [{ p: a.page }], page_info: { total_page: 3 } }) });
    expect(await new TikTokMcp('acc').pages('ad_get', {})).toEqual([{ p: 1 }, { p: 2 }, { p: 3 }]);
  });
  it('rpcMessage takes JSON or the last event', () => {
    expect(rpcMessage('{"a":1}')).toEqual({ a: 1 });
    expect(rpcMessage('data: {"a":1}\n\ndata: {"a":2}\n')).toEqual({ a: 2 });
    expect(rpcMessage('garbage')).toEqual({});
  });
});

describe('Well MCP TikTok tools', () => {
  it('tiktok.report.read asks for the configured advertiser and the asked days only', async () => {
    const calls = world({ tool: () => ({ list: [{ dimensions: { ad_id: '1', stat_time_day: '2026-11-20' }, metrics: { spend: '10' } }], page_info: { total_page: 1 } }) });
    const r = await callTool(ctx(), 'tiktok.report.read', { from: '2026-11-14', to: '2026-11-20' });
    expect(r).toMatchObject({ ok: true, data: { from: '2026-11-14', to: '2026-11-20', rows: [{ metrics: { spend: '10' } }] } });
    const call = calls.find(c => c.body?.method === 'tools/call')!;
    expect(call.body.params).toMatchObject({ name: 'report_integrated_get', arguments: { advertiser_id: '7000000000000000001', start_date: '2026-11-14', end_date: '2026-11-20' } });
  });
  it('no advertiser set or not connected: a plain unavailable, TikTok never called', async () => {
    const calls = world();
    expect(await callTool(ctx({}), 'tiktok.ads.list', {})).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(calls.some(c => c.url.startsWith('https://business-api'))).toBe(false);
  });
  it('the period: default 7 days, at most 30, from before to', () => {
    expect(parsePeriod({}, Date.parse('2026-11-21T10:00:00Z'))).toEqual({ ok: true, value: { from: '2026-11-15', to: '2026-11-21' } });
    expect(parsePeriod({ from: '2026-10-01', to: '2026-11-20' }).ok).toBe(false);
    expect(parsePeriod({ from: '2026-11-20', to: '2026-11-19' }).ok).toBe(false);
    expect(parsePeriod({ from: '20-11-2026' }).ok).toBe(false);
  });
});
