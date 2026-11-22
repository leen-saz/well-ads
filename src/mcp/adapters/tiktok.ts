// TikTok adapter (docs/PRD.md §3.0, M14): TikTok for Business through TikTok's own hosted MCP server, the same server and calls as the
// hourly pull (pipeline/tiktok/mcp.py), so TikTok stays on MCP (Leen's rule). Read-only: only tools whose name ends in _get or _list are
// ever called; this file refuses any other name. One advertiser only, the one set in TIKTOK_ADVERTISER_ID, so another company's
// account that the same sign-in can see is never read (the pull's exclusion rule, applied here by never asking for anything else).
// The refresh token rotates: a new one is saved to the vault before it is used, exactly as the pull does. No token is logged or returned.
import type { Cfg } from '../../lib/auth';
import { tokensOf, putToken } from '../vault';

export const TIKTOK_MCP = {
  resource: 'https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat',
  authorize: 'https://business-api.tiktok.com/portal/mcp-tt4b-authorize',
  token: 'https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat/oauth/token',
  register: 'https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat/oauth/register',
  scope: 'mcp:tt4b',
} as const;
export const PROTOCOL = '2025-06-18';
const READ_ONLY = /_(get|list)$/;
const TIMEOUT_MS = 30_000;

export class TikTokError extends Error { constructor(public code: 'not_connected' | 'no_advertiser' | 'excluded' | 'token' | 'refused' | 'platform' | 'rotated_not_saved', detail = '') { super(detail || code); } }
export interface TikTokEnv { TIKTOK_ADVERTISER_ID?: string; TIKTOK_EXCLUDED_ADVERTISER_IDS?: string }

/** The one advertiser this Worker may read, or why not. */
export function advertiserOf(e: TikTokEnv): string {
  const adv = String(e.TIKTOK_ADVERTISER_ID ?? '').trim();
  if (!/^\d{6,25}$/.test(adv)) throw new TikTokError('no_advertiser');
  const excluded = String(e.TIKTOK_EXCLUDED_ADVERTISER_IDS ?? '').split(/[\s,]+/).filter(Boolean);
  if (excluded.includes(adv)) throw new TikTokError('excluded');
  return adv;
}

// Access tokens kept in this isolate's memory until a minute before they expire: fewer refresh grants means fewer rotations racing
// the hourly pull for the same refresh token. Never written anywhere.
const CACHE = new Map<string, { token: string; until: number }>();
export const _clearTokenCache = () => CACHE.clear();
/** After TikTok refuses a token: the next call asks for a new one. */
export const forgetToken = (company: string) => { CACHE.delete(company); };

/** refresh_token grant (public client). The rotated refresh token is saved first; if that fails nothing is called with it. */
export async function accessToken(cfg: Cfg, company: string, f: typeof fetch = fetch, now = Date.now()): Promise<string> {
  const hit = CACHE.get(company);
  if (hit && hit.until > now) return hit.token;
  const t = await tokensOf(cfg, company);
  const client = t.TIKTOK_MCP_CLIENT_ID, refresh = t.TIKTOK_MCP_REFRESH_TOKEN;
  if (!client || !refresh) throw new TikTokError('not_connected');
  let r: Response;
  try {
    r = await f(TIKTOK_MCP.token, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: client, resource: TIKTOK_MCP.resource }) });
  } catch { throw new TikTokError('platform', 'token request failed'); }
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!r.ok || !d.access_token) throw new TikTokError('token', `token ${r.status}`);
  if (d.refresh_token && d.refresh_token !== refresh) {
    try { await putToken(cfg, company, 'TIKTOK_MCP_REFRESH_TOKEN', d.refresh_token); }
    catch { throw new TikTokError('rotated_not_saved'); }
  }
  const life = Number(d.expires_in) > 120 ? Number(d.expires_in) * 1000 - 60_000 : 0;
  if (life) CACHE.set(company, { token: d.access_token, until: now + life });
  return d.access_token;
}

/** Streamable HTTP answers as JSON or as server-sent events: the last JSON-RPC message. */
export function rpcMessage(text: string): Record<string, unknown> {
  const t = text.trim();
  if (t.startsWith('{')) { try { return JSON.parse(t); } catch { return {}; } }
  const msgs = t.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(l => l.startsWith('{'));
  try { return msgs.length ? JSON.parse(msgs[msgs.length - 1]!) : {}; } catch { return {}; }
}

export class TikTokMcp {
  private session: string | null = null;
  private n = 0;
  constructor(private token: string, private f: typeof fetch = fetch) {}

  private async rpc(method: string, params?: unknown, notify = false): Promise<Record<string, unknown>> {
    const msg: Record<string, unknown> = { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
    if (!notify) msg.id = ++this.n;
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL };
    if (this.session) headers['mcp-session-id'] = this.session;
    let r: Response;
    try { r = await this.f(TIKTOK_MCP.resource, { method: 'POST', headers, body: JSON.stringify(msg), signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch { throw new TikTokError('platform', `${method} failed`); }
    const sid = r.headers.get('mcp-session-id');
    if (sid) this.session = sid;
    if (notify) return {};
    if (r.status >= 400) throw new TikTokError(r.status === 401 ? 'token' : 'platform', `${method} ${r.status}`);
    const d = rpcMessage(await r.text());
    if (d.error) throw new TikTokError('platform', `${method} error`);
    return (d.result as Record<string, unknown>) || {};
  }

  async start(): Promise<void> {
    await this.rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'well-mcp', version: '1' } });
    await this.rpc('notifications/initialized', undefined, true);
  }

  /** The names of the tools TikTok's server offers this sign-in (at most 10 pages). */
  async toolNames(): Promise<string[]> {
    const out: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const r = await this.rpc('tools/list', cursor ? { cursor } : {});
      out.push(...((r.tools as { name?: string }[] | undefined) || []).map(t => String(t.name || '')).filter(Boolean));
      cursor = typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    return out;
  }

  /** One read tool. Returns TikTok's data block (list, page_info …). */
  async read(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!READ_ONLY.test(name)) throw new TikTokError('refused', name);
    const r = await this.rpc('tools/call', { name, arguments: args });
    if (r.isError) throw new TikTokError('platform', `${name} error`);
    let d = r.structuredContent as unknown;
    if (d === undefined) {
      const text = ((r.content as { type?: string; text?: string }[] | undefined) || []).filter(c => c.type === 'text').map(c => c.text || '').join('');
      try { d = /^\s*[[{]/.test(text) ? JSON.parse(text) : {}; } catch { d = {}; }
    }
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const o = d as Record<string, unknown>;
      if (o.code !== undefined && o.code !== null && o.code !== 0) throw new TikTokError('platform', `${name} code ${o.code}`);
      return (o.data && typeof o.data === 'object' ? o.data : o) as Record<string, unknown>;
    }
    return { list: Array.isArray(d) ? d : [] };
  }

  /** Every page of a list tool, at most `max` pages. */
  async pages(name: string, args: Record<string, unknown>, size = 1000, max = 10): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let page = 1; page <= max; page++) {
      const d = await this.read(name, { ...args, page, page_size: size });
      out.push(...((d.list as Record<string, unknown>[]) || []));
      if (page >= Number((d.page_info as { total_page?: number } | undefined)?.total_page || 1)) break;
    }
    return out;
  }
}

/** A started session for the company's TikTok sign-in. */
export async function tiktokSession(cfg: Cfg, company: string, f: typeof fetch = fetch): Promise<TikTokMcp> {
  const m = new TikTokMcp(await accessToken(cfg, company, f), f);
  await m.start();
  return m;
}
