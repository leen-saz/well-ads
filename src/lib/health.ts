// GET /api/health (public, no login): the build version and whether each dependency answers.
// Never any secret, URL, row or figure: only 'up' | 'down' | 'unset' per dependency. The deploy workflow reads it
// after every deploy (.github/workflows/deploy.yml) and uptime checks may poll it.
import { dataStatus, type DataStatus, type StatusBucket } from './datastatus';
import { MIGRATIONS, TRACKED_AFTER } from './migrations-list';
export type Dep = 'up' | 'down' | 'unset';
export interface HealthEnv {
  APP_ENV?: string;
  BUILD_VERSION?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  FILES?: { list(o: { limit: number }): Promise<unknown> } & StatusBucket;
  AI?: unknown;
  // '1' makes a missing migration fail the check (and so the production deploy). Off by default: it is only reported.
  MIGRATIONS_STRICT?: string;
}
// ok = every tracked migration has a row; missing = some do not; untracked = the schema_migrations table itself is not applied yet
export type MigrationState = 'ok' | 'missing' | 'untracked' | 'unknown';
export interface MigrationCheck { state: MigrationState; missing: string[] }
export interface Health { ok: boolean; version: string; env: string; checks: Record<'supabase' | 'storage' | 'ai', Dep>; migrations: MigrationCheck; data: DataStatus }

// Files after TRACKED_AFTER that the table has no row for. Names only (the repo is public): never a row or a count of data.
export const trackedMigrations = (): string[] => MIGRATIONS.slice(MIGRATIONS.indexOf(TRACKED_AFTER) + 1);
export async function migrations(e: HealthEnv, f: typeof fetch): Promise<MigrationCheck> {
  if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) return { state: 'unknown', missing: [] };
  const base = e.SUPABASE_URL.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), key = e.SUPABASE_SERVICE_ROLE_KEY.trim();
  try {
    const r = await within(f(`${base}/rest/v1/schema_migrations?select=name&limit=1000`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }), 3000);
    if (r.status === 404) return { state: 'untracked', missing: trackedMigrations() };   // PostgREST: relation does not exist
    if (!r.ok) return { state: 'unknown', missing: [] };
    const rows = (await r.json()) as { name?: unknown }[];
    const have = new Set(Array.isArray(rows) ? rows.map(x => String(x.name)) : []);
    const missing = trackedMigrations().filter(n => !have.has(n));
    return { state: missing.length ? 'missing' : 'ok', missing };
  } catch { return { state: 'unknown', missing: [] }; }
}

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
  const h = await check(e, f, now);
  kept = { at: now, version, h };
  return h;
}

async function check(e: HealthEnv, f: typeof fetch, now: number): Promise<Health> {
  const [sb, st, mig, data] = await Promise.all([supabase(e, f), storage(e), migrations(e, f), within(dataStatus(e.FILES, now), 3000).catch(() => dataStatus(undefined))]);
  // `ok` stays about the dependencies; `data` says how old the numbers are and whether the hourly refresh could be started
  // The AI binding only exists or not; calling it would cost money
  const checks = { supabase: sb, storage: st, ai: (e.AI ? 'up' : 'unset') as Dep };
  // A missing migration is only a warning here; MIGRATIONS_STRICT=1 (a Worker variable) turns it into a failed check
  const strict = e.MIGRATIONS_STRICT === '1' && (mig.state === 'missing' || mig.state === 'untracked');
  return { ok: sb === 'up' && st === 'up' && !strict, version: e.BUILD_VERSION || 'dev', env: e.APP_ENV || 'local', checks, migrations: mig, data };
}
