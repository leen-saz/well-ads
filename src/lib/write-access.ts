// Write access, checked automatically (docs/PRD.md §7 M12a; Leen: «ليه تعيد الربط مربوطين اصلا / تلقائي»). For every account already
// connected, read what it is allowed to do, with read-only calls, and say per platform «يكتب» or «ناقصه: …». Nobody is asked to
// reconnect except for an account that really lacks a permission, and then the missing permission is named.
// Runs once a day (hourly task 'perms') and with «افحص الحين». Results in account_permissions (044); never a token.
import { sb, missingSchema, type Cfg } from './auth';
import { WELL_COMPANY } from './tenant';
import { tokensOf } from '../mcp/vault';
import { grantedScopes } from '../mcp/adapters/meta-graph';
import { postizStatus } from '../mcp/adapters/postiz';
import { configured, type ExecEnv } from '../mcp/adapters/ads';
import { tiktokSession, TikTokError } from '../mcp/adapters/tiktok';

export type Access = 'write' | 'partial' | 'read_only' | 'not_connected' | 'unknown';
export interface Result { platform: string; state: Access; missing: string[]; code: string | null }

// The write permissions each connection needs (docs/PRD.md §3.0, the write-scopes table)
export const NEED: Record<'meta' | 'meta_pages', string[]> = {
  meta: ['ads_management'],
  meta_pages: ['pages_manage_posts', 'instagram_content_publish'],
};
const WRITE_TOOL = /_(create|update|delete|status_update|enable|disable)$/;

/** Pure: what a list of granted scopes means for one connection. */
export function judgeScopes(platform: 'meta' | 'meta_pages', scopes: string[] | null): Result {
  if (scopes === null) return { platform, state: 'unknown', missing: [], code: 'scopes_unreadable' };
  const missing = NEED[platform].filter(s => !scopes.includes(s));
  const state: Access = !missing.length ? 'write' : missing.length < NEED[platform].length ? 'partial' : 'read_only';
  return { platform, state, missing, code: null };
}
/** Pure: TikTok's own tool list says whether this sign-in can change anything. */
export function judgeTikTok(names: string[]): Result {
  if (!names.length) return { platform: 'tiktok', state: 'unknown', missing: [], code: 'no_tools' };
  return names.some(n => WRITE_TOOL.test(n)) ? { platform: 'tiktok', state: 'write', missing: [], code: null } : { platform: 'tiktok', state: 'read_only', missing: ['write tools on TikTok’s MCP server'], code: null };
}

export async function checkWriteAccess(cfg: Cfg, e: ExecEnv & Record<string, unknown>, f: typeof fetch = fetch, co = WELL_COMPANY): Promise<Result[]> {
  const t = await tokensOf(cfg, co);
  const out: Result[] = [];
  if (t.META_ACCESS_TOKEN) out.push(judgeScopes('meta', await grantedScopes(t.META_ACCESS_TOKEN, f)));
  if (t.META_PAGE_ACCESS_TOKEN) out.push(judgeScopes('meta_pages', await grantedScopes(t.META_PAGE_ACCESS_TOKEN, f)));
  // Snapchat: ad changes use the separate write keys the owner added for execution; whether they are all there is what can be known
  if (t.SNAP_REFRESH_TOKEN || configured(e).snapchat) out.push(configured(e).snapchat ? { platform: 'snap', state: 'write', missing: [], code: 'exec_keys' } : { platform: 'snap', state: 'read_only', missing: ['SNAP_WRITE_*'], code: 'exec_keys' });
  if (t.TIKTOK_MCP_REFRESH_TOKEN) {
    try { out.push(judgeTikTok(await (await tiktokSession(cfg, co, f)).toolNames())); }
    catch (x) { out.push({ platform: 'tiktok', state: 'unknown', missing: [], code: x instanceof TikTokError ? `tiktok_${x.code}` : 'tiktok_error' }); }
  }
  // Postiz publishes for the channels connected in it: each one connected can publish
  const ps = await postizStatus(t, f).catch(() => null);
  if (ps && ps.code !== 'off') {
    if (ps.code !== 'ok') out.push({ platform: 'postiz', state: 'unknown', missing: [], code: `postiz_${ps.code}` });
    else {
      // ok = one account connected there (it can publish); many = several, Postiz cannot tell which one to use; none = not connected
      const ok = ps.channels.filter(c => c.code === 'ok'), many = ps.channels.filter(c => c.code === 'many').map(c => c.platform);
      out.push({ platform: 'postiz', state: ok.length ? (many.length ? 'partial' : 'write') : many.length ? 'partial' : 'not_connected', missing: many, code: many.length ? 'postiz_many' : null });
    }
  }
  return out;
}

/** Check and store. Returns how many connections were checked; nothing stored before 044 is applied. */
export async function runWriteAccess(cfg: Cfg, e: ExecEnv & Record<string, unknown>, f: typeof fetch = fetch, now = Date.now()): Promise<number> {
  const res = await checkWriteAccess(cfg, e, f);
  if (!res.length) return 0;
  const at = new Date(now).toISOString();
  const w = await sb(cfg, '/rest/v1/account_permissions?on_conflict=company_id,platform', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: res.map(r => ({ company_id: WELL_COMPANY, platform: r.platform, state: r.state, missing: r.missing, code: r.code, checked_at: at })) });
  if (!w.ok && !missingSchema(w)) console.warn('write_access_save_failed', w.status);
  return res.length;
}
