// /api/mcp: the Well MCP over Streamable HTTP (JSON-RPC 2.0, one JSON answer per POST, no server-sent stream).
// Auth in M9: the read API key (src/lib/readkey.ts) → scope read, company Well, actor api. OAuth 2.1 + PKCE for read-write clients is M9b.
// Well's own pages, jobs and agents do not come through here: they call callTool directly with their own context (scope read-write).
import { json, type Cfg } from '../lib/auth';
import { authenticateKey, type KeyEnv } from '../lib/readkey';
import { WELL_COMPANY } from '../lib/tenant';
import { callTool } from './call';
import { TOOLS } from './registry';
import type { Ctx, Scope } from './types';

export const PROTOCOLS = ['2025-06-18', '2025-03-26'] as const;
const SERVER = { name: 'well-mcp', version: '0.1.0' };
type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const NO_STORE = { 'cache-control': 'private, no-store' };

const reply = (id: unknown, result: unknown) => json(200, { jsonrpc: '2.0', id, result }, NO_STORE);
const rpcError = (id: unknown, code: number, message: string, status = 200) => json(status, { jsonrpc: '2.0', id: id ?? null, error: { code, message } }, NO_STORE);

// The tools this scope may call, as MCP lists them. A read key sees the read tools only.
export function listTools(scope: Scope) {
  return [...TOOLS.values()].filter(t => scope === 'read-write' || !t.write).map(t => ({
    name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
    annotations: { readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: !!t.write },
  }));
}

// A browser page on another site must not drive the endpoint with the visitor's network (MCP spec: validate Origin)
function sameOrigin(request: Request): boolean {
  const o = request.headers.get('origin');
  if (!o) return true;
  try { return new URL(o).host === new URL(request.url).host; } catch { return false; }
}

export async function handleMcp(request: Request, e: KeyEnv & Record<string, unknown>, now = Date.now()): Promise<Response> {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden', message: 'Origin not allowed.' }, NO_STORE);
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed', message: 'POST only: this server sends no stream.' }, { ...NO_STORE, allow: 'POST' });
  const a = await authenticateKey(request, e, now);
  if (!a.ok) {
    if (a.res.status !== 401) return a.res;
    const h = new Headers(a.res.headers); h.set('www-authenticate', 'Bearer realm="well-mcp"');
    return new Response(a.res.body, { status: 401, headers: h });
  }
  let msg: Rpc;
  try { msg = await request.json() as Rpc; } catch { return rpcError(null, -32700, 'Parse error', 400); }
  if (Array.isArray(msg) || !msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError((msg as Rpc)?.id, -32600, 'Invalid request', 400);
  // A notification (no id) gets no body
  if (msg.id === undefined || msg.id === null) return new Response(null, { status: 202, headers: NO_STORE });

  const ctx: Ctx = { cfg: a.cfg as Cfg, env: e, company: WELL_COMPANY, actor: 'api', scope: 'read', mode: 'approve' };
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;
  switch (msg.method) {
    case 'initialize': {
      const asked = String(params.protocolVersion || '');
      return reply(msg.id, { protocolVersion: (PROTOCOLS as readonly string[]).includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER,
        instructions: 'Well marketing data. Read tools only with this key. Writes (when allowed) always wait for approval in Well.' });
    }
    case 'ping': return reply(msg.id, {});
    case 'tools/list': return reply(msg.id, { tools: listTools(ctx.scope) });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      const meta = (params._meta && typeof params._meta === 'object' ? params._meta : {}) as Record<string, unknown>;
      const key = typeof meta.idempotency_key === 'string' ? meta.idempotency_key : null;
      if (!TOOLS.has(name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      const r = await callTool(ctx, name, params.arguments ?? {}, { idempotencyKey: key, now });
      return r.ok
        ? reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(r.data) }], structuredContent: r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : { value: r.data }, isError: false, ...(r.replayed ? { _meta: { replayed: true } } : {}) })
        : reply(msg.id, { content: [{ type: 'text', text: `${r.error.code}: ${r.error.message}` }], isError: true });
    }
    default: return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
