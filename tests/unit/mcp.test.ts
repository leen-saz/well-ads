/* eslint-disable @typescript-eslint/no-explicit-any -- parsed JSON answers are read loosely in assertions */
// Well MCP core (docs/PRD.md §3.0, M9): callTool's order (tool → scope → input → idempotency → run → audit) and the /api/mcp endpoint.
// Fakes only: a fake Supabase and a fake Cache API. The key is made up for the test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/api/index';
import { gate } from '../../src/lib/gate';
import { callTool } from '../../src/mcp/call';
import { TOOLS } from '../../src/mcp/registry';
import { listTools } from '../../src/mcp/http';
import { ToolFail, type Ctx, type Tool } from '../../src/mcp/types';
import { WELL_COMPANY } from '../../src/lib/tenant';

const KEY = 'wad_' + 'TestKeyNotReal0123456789abcdefghijklmnopqr'.slice(0, 43);
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com', READ_API_KEY: KEY };
const cfg = { url: 'https://sb.example', anon: 'anon', service: 'service' } as never;

function fakeCaches() {
  const m = new Map<string, string>();
  vi.stubGlobal('caches', { default: { async match(r: Request) { const v = m.get(r.url); return v === undefined ? undefined : new Response(v); }, async put(r: Request, res: Response) { m.set(r.url, await res.text()); } } });
}
// A fake Supabase: the idempotency table in memory, every write recorded
type Call = { path: string; method: string; body: any };
function world(opts: { idemMissing?: boolean } = {}) {
  const calls: Call[] = [], idem = new Map<string, any>();
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const path = String(u).replace('https://sb.example', ''), method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (path.startsWith('/rest/v1/mcp_idempotency')) {
      if (opts.idemMissing) return j({ code: '42P01', message: 'relation does not exist' }, 404);
      if (method === 'GET') { const k = decodeURIComponent(path.match(/key=eq\.([^&]+)/)![1]!); return j(idem.has(k) ? [idem.get(k)] : []); }
      idem.set(body.key, body); return j([], 201);
    }
    if (path.startsWith('/rest/v1/account_health')) return j([{ platform: 'meta', account_ref: '', status: 'ok', probed: true, last_check_at: '2026-11-20T00:00:00Z' }]);
    return j([]);
  }));
  return { calls, idem };
}

// A write tool that counts its runs, added for the test and removed after
let runs = 0;
const fake: Tool<{ n: number }> = { name: 'test.thing.create', title: 't', description: 't', write: true, money: false, inputSchema: {},
  parse: a => typeof (a as any)?.n === 'number' ? { ok: true, value: { n: (a as any).n } } : { ok: false, error: 'n: a number' },
  async run(_c, i) { runs++; if (i.n < 0) throw new ToolFail('invalid', 'negative'); return { got: i.n, secret: 'post text' }; } };
const money: Tool<{ n: number }> = { ...fake, name: 'test.money.spend', money: true };
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ cfg, env: E, company: WELL_COMPANY, actor: 'agent:buyer', scope: 'read-write', mode: 'approve', ...over });
function withFakes() { TOOLS.set(fake.name, fake as never); TOOLS.set(money.name, money as never); runs = 0; }

afterEach(() => { TOOLS.delete(fake.name); TOOLS.delete(money.name); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('callTool', () => {
  it('an unknown tool, a read scope on a write, and bad input are refused before anything runs or is written', async () => {
    const w = world(); withFakes();
    expect((await callTool(ctx(), 'nope.x.y', {})) as any).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect((await callTool(ctx({ scope: 'read' }), fake.name, { n: 1 }, { idempotencyKey: 'key-12345' })) as any).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect((await callTool(ctx(), fake.name, { n: 'x' })) as any).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect((await callTool(ctx(), fake.name, { n: 1 }, { idempotencyKey: 'bad key!' })) as any).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(runs).toBe(0);
    expect(w.calls).toEqual([]);
  });
  it('a tool that can spend needs an idempotency key', async () => {
    world(); withFakes();
    expect((await callTool(ctx(), money.name, { n: 1 })) as any).toMatchObject({ ok: false, error: { code: 'needs_key' } });
    expect(runs).toBe(0);
    expect((await callTool(ctx(), money.name, { n: 1 }, { idempotencyKey: 'spend-0001' })).ok).toBe(true);
  });
  it('the same key and arguments within 24 hours replay the first answer without running again; other arguments are a conflict', async () => {
    const w = world(); withFakes();
    const now = Date.parse('2026-11-20T10:00:00Z');
    const a = await callTool(ctx(), fake.name, { n: 1 }, { idempotencyKey: 'req-000001', now });
    expect(a).toMatchObject({ ok: true, data: { got: 1 } });
    const b = await callTool(ctx(), fake.name, { n: 1 }, { idempotencyKey: 'req-000001', now: now + 3600_000 });
    expect(b).toMatchObject({ ok: true, data: { got: 1 }, replayed: true });
    expect(runs).toBe(1);
    expect((await callTool(ctx(), fake.name, { n: 2 }, { idempotencyKey: 'req-000001', now })) as any).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(runs).toBe(1);
    // After 24 hours the key is free again
    expect((await callTool(ctx(), fake.name, { n: 2 }, { idempotencyKey: 'req-000001', now: now + 25 * 3600_000 })).ok).toBe(true);
    expect(runs).toBe(2);
    const row = w.idem.get('req-000001');
    expect(row.company_id).toBe(WELL_COMPANY);
    expect(row.request_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('every write leaves one audit row: tool, actor, mode, key, outcome; never the arguments', async () => {
    const w = world(); withFakes();
    await callTool(ctx(), fake.name, { n: 7 }, { idempotencyKey: 'audit-0001' });
    await callTool(ctx(), fake.name, { n: -1 });
    const rows = w.calls.filter(c => c.path === '/rest/v1/audit_log').map(c => c.body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: 'mcp:test.thing.create', company_id: WELL_COMPANY, target: { actor: 'agent:buyer', mode: 'approve', idempotency_key: 'audit-0001' }, result: { ok: true } });
    expect(rows[1]).toMatchObject({ result: { ok: false, code: 'invalid' } });
    expect(JSON.stringify(rows)).not.toContain('post text');
  });
  it('reads leave no audit row and need no key', async () => {
    const w = world();
    const r = await callTool(ctx({ scope: 'read', actor: 'api' }), 'accounts.health.read', {});
    expect(r).toMatchObject({ ok: true, data: { accounts: [{ platform: 'meta', status: 'ok' }] } });
    expect(w.calls.some(c => c.path.startsWith('/rest/v1/audit_log'))).toBe(false);
    expect(w.calls[0]!.path).toContain(`company_id=eq.${WELL_COMPANY}`);
  });
  it('the idempotency table missing (041 not applied): the write does not run', async () => {
    world({ idemMissing: true }); withFakes();
    expect((await callTool(ctx(), fake.name, { n: 1 }, { idempotencyKey: 'miss-0001' })) as any).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(runs).toBe(0);
  });
  it('social.post.create checks its input and is a write', async () => {
    world();
    const t = TOOLS.get('social.post.create')!;
    expect(t.write).toBe(true);
    expect((await callTool(ctx(), 'social.post.create', { body: 'x' })) as any).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect((await callTool(ctx(), 'social.post.create', { platforms: ['x'], body: 'x', company_id: 'other' })) as any).toMatchObject({ ok: false, error: { code: 'invalid', message: 'Unknown field: company_id' } });
  });
  it('every tool name is <domain>.<entity>.<action> or <domain>.<action>, lowercase', () => {
    for (const n of TOOLS.keys()) expect(n).toMatch(/^[a-z]+(\.[a-z]+){1,2}$/);
  });
});

const rpc = (body: unknown, opts: { key?: string | null; method?: string; origin?: string; env?: Record<string, unknown> } = {}) =>
  api.request('https://well.example/api/mcp', { method: opts.method || 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'cf-connecting-ip': '203.0.113.9',
    ...(opts.key !== null ? { authorization: `Bearer ${opts.key ?? KEY}` } : {}), ...(opts.origin ? { origin: opts.origin } : {}) }, ...(opts.method === 'GET' ? {} : { body: JSON.stringify(body) }) }, opts.env ?? E);

describe('/api/mcp', () => {
  it('off (404) without READ_API_KEY; 401 with a WWW-Authenticate header without a key; POST only; other sites refused', async () => {
    fakeCaches(); world();
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { env: { ...E, READ_API_KEY: '' } })).status).toBe(404);
    const no = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { key: null });
    expect(no.status).toBe(401);
    expect(no.headers.get('www-authenticate')).toContain('Bearer');
    expect((await rpc(null, { method: 'GET' })).status).toBe(405);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://well.example' })).status).toBe(200);
  });
  it('the gate lets /api/mcp through without a session (the key check is inside), and nothing else new', async () => {
    const d = await gate(new Request('https://well.example/api/mcp', { method: 'POST' }), E as never);
    expect(d instanceof Response).toBe(false);
    const other = await gate(new Request('https://well.example/api/mcpx', { method: 'POST' }), E as never);
    expect(other instanceof Response && other.status).toBeTruthy();
  });
  it('initialize, a notification (202, no body), ping, unknown methods and malformed messages', async () => {
    fakeCaches(); world();
    const init: any = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json();
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'well-mcp' } });
    const old: any = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json();
    expect(old.result.protocolVersion).toBe('2025-06-18');
    const n = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(n.status).toBe(202);
    expect(await n.text()).toBe('');
    expect(((await (await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' })).json()) as any).result).toEqual({});
    expect(((await (await rpc({ jsonrpc: '2.0', id: 4, method: 'nope' })).json()) as any).error.code).toBe(-32601);
    expect((await rpc([{ jsonrpc: '2.0', id: 5, method: 'ping' }])).status).toBe(400);
  });
  it('a read key lists the read tools only, with readOnlyHint, and cannot call a write tool', async () => {
    fakeCaches(); world();
    const list: any = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toContain('accounts.health.read');
    expect(names).not.toContain('social.post.create');
    expect(list.result.tools.every((t: any) => t.annotations.readOnlyHint === true)).toBe(true);
    expect(listTools('read-write').map(t => t.name)).toContain('social.post.create');
    const w: any = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'social.post.create', arguments: { platforms: ['x'], body: 'hi' } } })).json();
    expect(w.result.isError).toBe(true);
    expect(w.result.content[0].text).toMatch(/^forbidden:/);
  });
  it('tools/call runs a read tool and answers as MCP content', async () => {
    fakeCaches(); world();
    const r: any = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'accounts.health.read', arguments: {} } })).json();
    expect(r.result.isError).toBe(false);
    expect(r.result.structuredContent.accounts[0]).toMatchObject({ platform: 'meta', status: 'ok' });
    expect(JSON.parse(r.result.content[0].text)).toEqual(r.result.structuredContent);
    const u: any = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope.x', arguments: {} } })).json();
    expect(u.error.code).toBe(-32602);
  });
});
