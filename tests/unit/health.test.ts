import { describe, expect, it } from 'vitest';
import { health } from '../../src/lib/health';

const secret = 'synthetic-service-key-value';
const ok = (async () => new Response('[]', { status: 200 })) as typeof fetch;
const env = { APP_ENV: 'staging', BUILD_VERSION: 'abc123', SUPABASE_URL: 'https://sb.example/rest/v1', SUPABASE_SERVICE_ROLE_KEY: secret, FILES: { list: async () => ({}) } };

describe('health', () => {
  it('reports the version and every dependency up', async () => {
    const h = await health({ ...env, AI: {} }, ok);
    expect(h).toEqual({ ok: true, version: 'abc123', env: 'staging', checks: { supabase: 'up', storage: 'up', ai: 'up' } });
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
    const h = await health(env, (() => new Promise(() => {})) as unknown as typeof fetch);
    expect(h.checks.supabase).toBe('down');
    expect(Date.now() - t).toBeLessThan(4500);
  }, 8000);
  it('never leaks the key or the URL', async () => {
    const text = JSON.stringify(await health(env, ok));
    expect(text).not.toContain(secret);
    expect(text).not.toContain('sb.example');
  });
});
