// The read-only API's one static key (/api/v1/*, docs/api-v1.md): the Worker variable READ_API_KEY, `wad_` + random characters, set by the
// owner (GitHub environment secret, passed by deploy.yml). Nothing is stored in the database. With it unset the whole API is off (404).
// Counters (failures per address, requests per key) live in the Cache API; if they cannot be read or written the request is refused.
import { json, env, type AuthEnv, type Cfg } from './auth';

export type KeyEnv = AuthEnv & { READ_API_KEY?: string };
export const KEY_PREFIX = 'wad_';
export const KEY_MIN = 32;
export const LIMIT_MINUTE = 60;
export const FAIL_LIMIT = 10;       // wrong keys per address ...
export const FAIL_WINDOW_S = 600;   // ... in ten minutes

const enc = new TextEncoder();
export const configuredKey = (e: KeyEnv): string | null => {
  const k = typeof e.READ_API_KEY === 'string' ? e.READ_API_KEY.trim() : '';
  return k.startsWith(KEY_PREFIX) && k.length >= KEY_MIN ? k : null;
};
const sha256 = async (s: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
// Digests have one length; every byte is compared whatever the first difference is
export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= (a[i] as number) ^ (b[i] as number);
  return d === 0;
}
// `Authorization: Bearer wad_…` and nothing else (never the query string, never a cookie)
export function bearer(request: Request): string | null {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)\s*$/i);
  return m ? (m[1] as string) : null;
}

// ---- counters in the Cache API (per data centre, which is enough for a limit this small). Not atomic; good enough to stop hammering.
type CacheLike = { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> };
const cacheOf = (): CacheLike => {
  const c = (globalThis as { caches?: { default?: CacheLike } }).caches?.default;
  if (!c) throw new Error('no cache');
  return c;
};
const slot = (name: string) => new Request(`https://counters.well.internal/${name}`);
async function count(name: string, ttl: number, add: boolean): Promise<number> {
  const c = cacheOf(), req = slot(name);
  const hit = await c.match(req);
  const n = hit ? Number(await hit.text()) || 0 : 0;
  if (!add) return n;
  await c.put(req, new Response(String(n + 1), { headers: { 'cache-control': `max-age=${ttl}` } }));
  return n + 1;
}
const ipOf = (r: Request) => (r.headers.get('cf-connecting-ip') || 'unknown').replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || 'unknown';

type Fail = { ok: false; res: Response };
const fail = (status: number, code: string, message: string, headers: Record<string, string> = {}): Fail =>
  ({ ok: false, res: json(status, { error: code, message }, { 'cache-control': 'private, no-store', ...headers }) });

// 404 off · 405 method · 429 too many wrong keys / too many requests · 401 wrong or missing key · 503 counters or config unavailable
export async function authenticate(request: Request, e: KeyEnv, now = Date.now()): Promise<{ ok: true; cfg: Cfg } | Fail> {
  const key = configuredKey(e);
  if (!key) return fail(404, 'not_found', 'Not found.');
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'method_not_allowed', 'This API is read-only: GET and HEAD only.', { allow: 'GET, HEAD' });
  return checkBearer(request, e, key, now);
}

// The key, the wrong-key counter and the per-minute limit, without the method rule: shared with the Well MCP endpoint (/mcp, src/mcp/http.ts),
// whose JSON-RPC calls are POSTs. The key there gives the `read` scope only.
export async function authenticateKey(request: Request, e: KeyEnv, now = Date.now()): Promise<{ ok: true; cfg: Cfg } | Fail> {
  const key = configuredKey(e);
  if (!key) return fail(404, 'not_found', 'Not found.');
  return checkBearer(request, e, key, now);
}

async function checkBearer(request: Request, e: KeyEnv, key: string, now: number): Promise<{ ok: true; cfg: Cfg } | Fail> {
  const ip = ipOf(request);
  const minute = Math.floor(now / 60000);
  try {
    if (await count(`fail/${ip}`, FAIL_WINDOW_S, false) >= FAIL_LIMIT) return fail(429, 'rate_limited', 'Too many wrong keys. Try again later.', { 'retry-after': String(FAIL_WINDOW_S) });
    const token = bearer(request);
    const same = token ? safeEqual(await sha256(token), await sha256(key)) : false;
    if (!same) {
      await count(`fail/${ip}`, FAIL_WINDOW_S, true);
      return fail(401, 'unauthorized', 'Send the API key as: Authorization: Bearer wad_…', { 'www-authenticate': 'Bearer' });
    }
    if (await count(`min/${minute}`, 120, true) > LIMIT_MINUTE) return fail(429, 'rate_limited', `At most ${LIMIT_MINUTE} requests per minute.`, { 'retry-after': String(60 - (Math.floor(now / 1000) % 60)) });
  } catch {
    return fail(503, 'unavailable', 'Rate limiting is unavailable. Try again shortly.');
  }
  let cfg: Cfg;
  try { cfg = env(e); } catch { return fail(503, 'unavailable', 'The API is not configured on this server yet.'); }
  return { ok: true, cfg };
}
