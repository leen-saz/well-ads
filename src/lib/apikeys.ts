// Read-only API keys for /api/v1/* (docs/api-v1.md, migration 037). A key is `wad_` + 32 random bytes (base64url), shown once at creation.
// Only a SHA-256 hash (pepper + key) is stored. The pepper is the Worker secret API_KEY_PEPPER: a leaked database alone cannot be used to
// test guesses, and a key cannot be rebuilt from a backup. A key reads what its scopes name, in its own company; it has no write path.
import { sb, json, missingSchema, audit, env, type AuthEnv, type Cfg, type Session } from './auth';

export type KeyEnv = AuthEnv & { API_KEY_PEPPER?: string };
export const KEY_PREFIX = 'wad_';
export const DEFAULT_DAYS = 90;
export const MAX_DAYS = 365;
export const LIMIT_MINUTE = 60;
export const LIMIT_DAY = 5000;
export const MAX_NAME = 80;

// One scope per data area. Names are the contract (docs/api-v1.md); the labels are for the owner's key form.
export const SCOPES = {
  dash: { ar: 'أرقام اللوحة والملخص', en: 'Dashboard numbers and overview' },
  ads: { ar: 'قائمة الإعلانات وأرقامها', en: 'Ads and their numbers' },
  decisions: { ar: 'اقتراحات لوحة القرارات ونتائجها', en: 'Decision-board suggestions and outcomes' },
  campaigns: { ar: 'حملات احلم ومهامها', en: 'Ahlam campaigns and tasks' },
  health: { ar: 'عمر البيانات وحالة الخطوات', en: 'Data freshness and step status' },
} as const;
export type Scope = keyof typeof SCOPES;
export const SCOPE_NAMES = Object.keys(SCOPES) as Scope[];
export const isScope = (s: unknown): s is Scope => typeof s === 'string' && Object.hasOwn(SCOPES, s);

const enc = new TextEncoder();
const b64u = (bytes: Uint8Array): string => {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
// 32 bytes -> 43 base64url characters
export const KEY_SHAPE = /^wad_[A-Za-z0-9_-]{43}$/;
export const newKey = (): string => KEY_PREFIX + b64u(crypto.getRandomValues(new Uint8Array(32)));
export const PEPPER_MIN = 16;
export const pepperOf = (e: KeyEnv): string | null => (typeof e.API_KEY_PEPPER === 'string' && e.API_KEY_PEPPER.trim().length >= PEPPER_MIN ? e.API_KEY_PEPPER.trim() : null);
export async function hashKey(key: string, pepper: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(`${pepper}:${key}`)));
}
// Equal-length strings compared without stopping at the first difference
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// `Authorization: Bearer wad_…` and nothing else (never the query string, never a cookie)
export function bearer(request: Request): string | null {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)\s*$/i);
  return m ? (m[1] as string) : null;
}

export const expiryFrom = (days: unknown, now = Date.now()): { ok: true; at: string } | { ok: false } => {
  const d = days === undefined || days === null || days === '' ? DEFAULT_DAYS : Number(days);
  if (!Number.isInteger(d) || d < 1 || d > MAX_DAYS) return { ok: false };
  return { ok: true, at: new Date(now + d * 86400_000).toISOString() };
};

export interface ApiKey { id: string; company: string; name: string; scopes: Scope[] }
type KeyRow = { id: string; company_id: string; name: string; key_hash: string; scopes: string[] | null; expires_at: string; revoked_at: string | null };
type Fail = { ok: false; res: Response };
const fail = (status: number, code: string, message: string, headers: Record<string, string> = {}): Fail =>
  ({ ok: false, res: json(status, { error: code, message }, { 'cache-control': 'private, no-store', ...headers }) });

// The bearer token to a live key: valid shape, known hash, not revoked, not expired, under the rate limits. Every refusal is a plain
// JSON answer and never says which of "unknown", "revoked" or "expired" it was. Counter errors fail closed (503).
export async function authenticate(request: Request, e: KeyEnv, now = Date.now()): Promise<{ ok: true; key: ApiKey; cfg: Cfg } | Fail> {
  const token = bearer(request);
  if (!token || !KEY_SHAPE.test(token)) return fail(401, 'unauthorized', 'Send a valid API key as: Authorization: Bearer wad_…', { 'www-authenticate': 'Bearer' });
  const pepper = pepperOf(e);
  let cfg: Cfg;
  try { cfg = env(e); } catch { return fail(503, 'unavailable', 'The API is not configured on this server yet.'); }
  if (!pepper) return fail(503, 'unavailable', 'The API is not configured on this server yet.');
  const hash = await hashKey(token, pepper);
  let r;
  try { r = await sb<KeyRow[]>(cfg, `/rest/v1/api_keys?key_hash=eq.${hash}&select=id,company_id,name,key_hash,scopes,expires_at,revoked_at&limit=1`, { admin: true }); } catch { return fail(503, 'unavailable', 'The key store did not answer. Try again shortly.'); }
  if (missingSchema(r)) return fail(503, 'unavailable', 'API keys are not set up on this server yet.');
  if (!r.ok || !Array.isArray(r.data)) return fail(503, 'unavailable', 'The key store did not answer. Try again shortly.');
  const row = r.data[0];
  if (!row || !safeEqual(row.key_hash, hash)) return fail(401, 'unauthorized', 'This API key is not valid.', { 'www-authenticate': 'Bearer' });
  if (row.revoked_at || Date.parse(row.expires_at) <= now) return fail(401, 'unauthorized', 'This API key is not valid.', { 'www-authenticate': 'Bearer' });
  // One atomic count per request (migration 037). If it cannot be counted, the request is refused: no counter, no access.
  let hit;
  try { hit = await sb<{ minute_n: number; day_n: number }[]>(cfg, '/rest/v1/rpc/api_key_hit', { method: 'POST', admin: true, body: { p_key: row.id } }); } catch { return fail(503, 'unavailable', 'Rate limiting is unavailable. Try again shortly.'); }
  const c = hit.ok && Array.isArray(hit.data) ? hit.data[0] : undefined;
  if (!c || typeof c.minute_n !== 'number' || typeof c.day_n !== 'number') return fail(503, 'unavailable', 'Rate limiting is unavailable. Try again shortly.');
  if (c.minute_n > LIMIT_MINUTE) return fail(429, 'rate_limited', `At most ${LIMIT_MINUTE} requests per minute per key.`, { 'retry-after': String(60 - (Math.floor(now / 1000) % 60)) });
  if (c.day_n > LIMIT_DAY) return fail(429, 'rate_limited', `At most ${LIMIT_DAY} requests per day per key.`, { 'retry-after': String(86400 - (Math.floor(now / 1000) % 86400)) });
  return { ok: true, cfg, key: { id: row.id, company: row.company_id, name: row.name, scopes: (row.scopes || []).filter(isScope) } };
}

// ---- Owner side (src/lib/apikeys-admin.ts)
export interface KeyListItem { id: string; name: string; prefix: string; scopes: string[]; created_at: string; expires_at: string; last_used_at: string | null; use_count: number; revoked_at: string | null }
export const LIST_COLUMNS = 'id,name,prefix,scopes,created_at,expires_at,last_used_at,use_count,revoked_at';

export async function createKey(cfg: Cfg, pepper: string, user: Session, input: { name: string; scopes: Scope[]; expires_at: string }): Promise<{ ok: true; key: string; item: KeyListItem } | { ok: false; status: number; missing: boolean }> {
  const key = newKey();
  const r = await sb<KeyListItem[]>(cfg, `/rest/v1/api_keys?select=${LIST_COLUMNS}`, {
    method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, name: input.name, key_hash: await hashKey(key, pepper), prefix: key.slice(0, 8), scopes: input.scopes, created_by: user.uid, expires_at: input.expires_at },
  });
  const item = r.ok && Array.isArray(r.data) ? r.data[0] : undefined;
  if (!item) return { ok: false, status: r.status, missing: missingSchema(r) };
  // The audit row names the key (id, prefix, scopes), never the key itself
  await audit(cfg, user, 'api_key_created', { target: { id: item.id, name: input.name, prefix: item.prefix, scopes: input.scopes, expires_at: input.expires_at } });
  // PostgREST honours select=, but the hash is removed here as well: nothing but the creation answer ever carries the key
  delete (item as { key_hash?: unknown }).key_hash;
  return { ok: true, key, item };
}
