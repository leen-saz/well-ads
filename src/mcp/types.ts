// Well MCP (docs/PRD.md §3.0, milestone M9): the one execution layer for every platform action. Every caller (a page's server route, a
// scheduled job, one of Well's agents, an outside client over /mcp) runs the same tool through callTool (call.ts), so the scope check,
// the input check, the 24-hour idempotency and the audit row are the same for all of them.
import type { Cfg, Session } from '../lib/auth';

export type Scope = 'read' | 'read-write';
export type Actor = 'human' | 'cron' | 'api' | `agent:${string}`;
// approve: a write becomes a request in the approvals center (the default). auto: an agent Leen switched to «تلقائي» acts within its
// caps (milestone M13). Nothing in M9 acts on a platform; the field is carried so every tool sees the same context.
export type Mode = 'approve' | 'auto';

export interface Ctx {
  cfg: Cfg;
  env: Record<string, unknown>;
  company: string;            // set by the server from the session or the key, never from the arguments
  actor: Actor;
  scope: Scope;               // Well's own agents and pages: read-write; an outside key: read (Leen, 2026-11-20)
  mode: Mode;
  user?: Session;             // the signed-in person, when there is one
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
export interface Tool<T = Record<string, unknown>> {
  name: string;               // <domain>.<entity>.<action>
  title: string;
  description: string;
  write: boolean;             // needs the read-write scope, an idempotency key, and leaves an audit row
  money?: boolean;            // spends or can spend: the idempotency key is required
  inputSchema: Record<string, unknown>;   // JSON Schema shown to MCP clients
  parse(args: unknown): Parsed<T>;
  run(ctx: Ctx, input: T): Promise<unknown>;
}

export type ToolError = { code: 'not_found' | 'forbidden' | 'invalid' | 'conflict' | 'needs_key' | 'unavailable' | 'failed'; message: string };
export type ToolResult = { ok: true; data: unknown; replayed?: boolean } | { ok: false; error: ToolError };

/** A tool's own refusal with a plain message (thrown inside run). */
export class ToolFail extends Error {
  constructor(public code: ToolError['code'], message: string) { super(message); }
}
