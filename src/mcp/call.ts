// callTool: the single way a tool runs (docs/PRD.md §3.0). Order: find the tool → scope → input → idempotency (writes) → run → audit (writes).
import { sb, audit, missingSchema } from '../lib/auth';
import { TOOLS } from './registry';
import { ToolFail, type Ctx, type ToolResult } from './types';

export const IDEM_HOURS = 24;
const KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Keys sorted at every level, so the same request always gives the same fingerprint
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, stable((v as Record<string, unknown>)[k])])) : v;

export async function callTool(ctx: Ctx, name: string, args: unknown, opts: { idempotencyKey?: string | null; now?: number } = {}): Promise<ToolResult> {
  const tool = TOOLS.get(name);
  if (!tool) return { ok: false, error: { code: 'not_found', message: `No tool named ${name}` } };
  if (tool.write && ctx.scope !== 'read-write') return { ok: false, error: { code: 'forbidden', message: 'This key can only read. Writing needs the read-write scope.' } };
  const p = tool.parse(args ?? {});
  if (!p.ok) return { ok: false, error: { code: 'invalid', message: p.error } };

  const key = opts.idempotencyKey?.trim() || null;
  if (key && !KEY.test(key)) return { ok: false, error: { code: 'invalid', message: 'idempotency_key: 8 to 128 letters, digits or _ . : -' } };
  if (tool.money && !key) return { ok: false, error: { code: 'needs_key', message: 'This tool can spend money: send an idempotency_key.' } };
  const now = opts.now ?? Date.now();
  let hash = '';
  if (tool.write && key) {
    hash = await sha256(JSON.stringify({ tool: name, args: stable(p.value) }));
    const prev = await sb<{ request_hash: string; response: ToolResult; expires_at: string }[]>(ctx.cfg,
      `/rest/v1/mcp_idempotency?company_id=eq.${ctx.company}&key=eq.${encodeURIComponent(key)}&select=request_hash,response,expires_at`, { admin: true });
    if (!prev.ok) {
      if (missingSchema(prev)) return { ok: false, error: { code: 'unavailable', message: 'Part of the system is not set up yet.' } };
      return { ok: false, error: { code: 'failed', message: 'Something went wrong. Try again shortly.' } };
    }
    const hit = Array.isArray(prev.data) ? prev.data[0] : undefined;
    if (hit && Date.parse(hit.expires_at) > now) {
      if (hit.request_hash !== hash) return { ok: false, error: { code: 'conflict', message: 'This idempotency_key was used for a different request.' } };
      return { ...(hit.response as ToolResult), ...(hit.response.ok ? { replayed: true } : {}) } as ToolResult;
    }
  }

  let result: ToolResult;
  try { result = { ok: true, data: await tool.run(ctx, p.value) }; }
  catch (e) {
    result = e instanceof ToolFail ? { ok: false, error: { code: e.code, message: e.message } }
      : { ok: false, error: { code: 'failed', message: 'Something went wrong. Try again shortly.' } };
    if (!(e instanceof ToolFail)) console.error('mcp_tool_error', name, e instanceof Error ? e.name : 'unknown');
  }

  if (tool.write) {
    if (key) await sb(ctx.cfg, '/rest/v1/mcp_idempotency?on_conflict=company_id,key', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { company_id: ctx.company, key, tool: name, request_hash: hash, response: result, expires_at: new Date(now + IDEM_HOURS * 3600_000).toISOString() } });
    // Who, which tool, through what, and the outcome. The arguments themselves are not logged (they can hold post text).
    await audit(ctx.cfg, ctx.user ? { ...ctx.user, co: ctx.company } : { email: ctx.actor, co: ctx.company }, `mcp:${name}`,
      { target: { actor: ctx.actor, mode: ctx.mode, idempotency_key: key }, result: result.ok ? { ok: true } : { ok: false, code: result.error.code } });
  }
  return result;
}
