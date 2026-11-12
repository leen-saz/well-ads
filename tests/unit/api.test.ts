import { describe, expect, it } from 'vitest';
import { api } from '../../src/api/index';
import { SECURITY_HEADERS, withSecurityHeaders } from '../../src/lib/headers';

describe('api', () => {
  it('GET /api/health is ok', async () => {
    const res = await api.request('/api/health');
    expect(res.status).toBe(200);
    // No bindings in the test: the version defaults to dev and nothing is configured
    expect(await res.json()).toMatchObject({ ok: false, version: 'dev', env: 'local', checks: { supabase: 'unset', storage: 'unset', ai: 'unset' }, data: { level: 'unknown' } });
  });

  it('unknown /api route is a JSON 404', async () => {
    const res = await api.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'غير موجود' });
  });
});

describe('security headers', () => {
  it('adds noindex and the hardening headers', () => {
    const res = withSecurityHeaders(new Response('x'));
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
  });

  it('isolates the browsing context from cross-origin windows', () => {
    expect(withSecurityHeaders(new Response('x')).headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('locks down responses that have no CSP', () => {
    const res = withSecurityHeaders(new Response('{}'));
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it('keeps the page CSP set by Astro', () => {
    const page = new Response('<p>', { headers: { 'Content-Security-Policy': "default-src 'self'" } });
    expect(withSecurityHeaders(page).headers.get('Content-Security-Policy')).toBe("default-src 'self'");
  });
});
