// GET /api/health (public, no login): the build version and whether each dependency answers.
// Never any secret, URL, row or figure: only 'up' | 'down' | 'unset' per dependency. The deploy workflow reads it
// after every deploy (.github/workflows/deploy.yml) and uptime checks may poll it.
export type Dep = 'up' | 'down' | 'unset';
export interface HealthEnv {
  APP_ENV?: string;
  BUILD_VERSION?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  FILES?: { list(o: { limit: number }): Promise<unknown> };
  AI?: unknown;
}
export interface Health { ok: boolean; version: string; env: string; checks: Record<'supabase' | 'storage' | 'ai', Dep> }

const within = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function supabase(e: HealthEnv, f: typeof fetch): Promise<Dep> {
  if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) return 'unset';
  const base = e.SUPABASE_URL.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  try {
    // One tiny authenticated read: a wrong key or an unreachable project both fail it
    const r = await within(f(`${base}/rest/v1/profiles?select=id&limit=1`, { headers: { apikey: e.SUPABASE_SERVICE_ROLE_KEY.trim(), Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY.trim()}` } }), 3000);
    return r.ok ? 'up' : 'down';
  } catch { return 'down'; }
}
async function storage(e: HealthEnv): Promise<Dep> {
  if (!e.FILES) return 'unset';
  try { await within(e.FILES.list({ limit: 1 }), 3000); return 'up'; } catch { return 'down'; }
}

// The endpoint is public: the result is kept 10 s per isolate so anonymous callers cannot make every request hit Supabase and R2.
// Nothing per-user is in it. `now` and `cache` are injectable for tests.
export const HEALTH_TTL_MS = 10_000;
let kept: { at: number; version: string; h: Health } | null = null;
export const clearHealthCache = () => { kept = null; };

export async function health(e: HealthEnv, f: typeof fetch = fetch, now = Date.now()): Promise<Health> {
  const version = e.BUILD_VERSION || 'dev';
  if (kept && kept.version === version && now - kept.at >= 0 && now - kept.at < HEALTH_TTL_MS) return kept.h;
  const h = await check(e, f);
  kept = { at: now, version, h };
  return h;
}

async function check(e: HealthEnv, f: typeof fetch): Promise<Health> {
  const [sb, st] = await Promise.all([supabase(e, f), storage(e)]);
  // The AI binding only exists or not; calling it would cost money
  const checks = { supabase: sb, storage: st, ai: (e.AI ? 'up' : 'unset') as Dep };
  return { ok: sb === 'up' && st === 'up', version: e.BUILD_VERSION || 'dev', env: e.APP_ENV || 'local', checks };
}
