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

export async function health(e: HealthEnv, f: typeof fetch = fetch): Promise<Health> {
  const [sb, st] = await Promise.all([supabase(e, f), storage(e)]);
  // The AI binding only exists or not; calling it would cost money
  const checks = { supabase: sb, storage: st, ai: (e.AI ? 'up' : 'unset') as Dep };
  return { ok: sb === 'up' && st === 'up', version: e.BUILD_VERSION || 'dev', env: e.APP_ENV || 'local', checks };
}
