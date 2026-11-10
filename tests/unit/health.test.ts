import { describe, expect, it } from 'vitest';
import { beforeEach } from 'vitest';
import { health, clearHealthCache } from '../../src/lib/health';

const secret = 'synthetic-service-key-value';
const ok = (async () => new Response('[]', { status: 200 })) as typeof fetch;
const env = { APP_ENV: 'staging', BUILD_VERSION: 'abc123', SUPABASE_URL: 'https://sb.example/rest/v1', SUPABASE_SERVICE_ROLE_KEY: secret, FILES: { list: async () => ({}) } };

beforeEach(() => clearHealthCache());

describe('health', () => {
  it('reports the version and every dependency up', async () => {
    const h = await health({ ...env, AI: {} }, ok);
    expect(h).toEqual({ ok: true, version: 'abc123', env: 'staging', checks: { supabase: 'up', storage: 'up', ai: 'up' }, data: { level: 'unknown', warnings: [], dash_age_hours: null, crm_age_hours: null, dispatch: 'unknown', dispatch_at: null } });
  });
  it('a refused Supabase key or an unreachable project is down', async () => {
    expect((await health(env, (async () => new Response('{}', { status: 401 })) as typeof fetch)).checks.supabase).toBe('down');
    expect((await health(env, (async () => { throw new Error('boom'); }) as typeof fetch)).checks.supabase).toBe('down');
  });
  it('a failing bucket is down and ok is false', async () => {
    const h = await health({ ...env, FILES: { list: async () => { throw new Error('r2'); } } }, ok);
    expect(h.checks.storage).toBe('down');
    expect(h.ok).toBe(false);
  });
  it('a hanging Supabase does not hang the health check', async () => {
    const t = Date.now();
    const h = await health(env, (() => new Promise(() => {})) as unknown as typeof fetch, 1);
    expect(h.checks.supabase).toBe('down');
    expect(Date.now() - t).toBeLessThan(4500);
  }, 8000);
  it('never leaks the key or the URL', async () => {
    const text = JSON.stringify(await health(env, ok));
    expect(text).not.toContain(secret);
    expect(text).not.toContain('sb.example');
  });
  it('is kept 10 s: callers inside the window do not touch Supabase or R2', async () => {
    let calls = 0, lists = 0;
    const f = (async () => { calls++; return new Response('[]', { status: 200 }); }) as typeof fetch;
    const e = { ...env, FILES: { list: async () => { lists++; return {}; } } };
    const first = await health(e, f, 1000);
    expect(await health(e, f, 1000 + 9_999)).toBe(first);
    expect([calls, lists]).toEqual([1, 1]);
    await health(e, f, 1000 + 10_000);
    expect([calls, lists]).toEqual([2, 2]);
  });
  it('a new build version is never answered from the old copy', async () => {
    await health(env, ok, 1);
    expect((await health({ ...env, BUILD_VERSION: 'next' }, ok, 2)).version).toBe('next');
  });
});
