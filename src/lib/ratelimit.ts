// A small in-memory sliding-window limiter, for the doors anyone can knock on (login, forgot, reset) and for chatty signed-in
// endpoints (web vitals). It lives in one Worker isolate, so it is a brake, not a wall: a flood spread over many isolates is
// still a Cloudflare job (a rate-limiting rule on /api/auth/*). What it does guarantee is that one isolate never writes an
// unbounded number of rows or Supabase calls for the same caller. Nothing here is stored or logged.
const BUCKETS = new Map<string, number[]>();
const MAX_KEYS = 5000;

// true = this call is allowed (and is counted); false = the caller is over `limit` calls in the last `windowMs`
export function hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const from = now - windowMs;
  const list = (BUCKETS.get(key) ?? []).filter(t => t > from);
  if (list.length >= limit) { BUCKETS.set(key, list); return false; }
  list.push(now);
  BUCKETS.delete(key); BUCKETS.set(key, list);   // most recently used last, so the oldest keys are the ones dropped
  if (BUCKETS.size > MAX_KEYS) for (const k of BUCKETS.keys()) { if (BUCKETS.size <= MAX_KEYS / 2) break; BUCKETS.delete(k); }
  return true;
}

export const clearLimits = (): void => BUCKETS.clear();

// Cloudflare puts the caller's address in this header; without it (tests, local dev) every caller shares one bucket
export const clientIp = (request: Request): string => request.headers.get('cf-connecting-ip')?.trim().slice(0, 64) || 'unknown';
