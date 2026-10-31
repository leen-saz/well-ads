import { describe, expect, it } from 'vitest';
import { api } from '../../src/api/index';
import { SECURITY_HEADERS, withSecurityHeaders } from '../../src/lib/headers';

describe('api', () => {
  it('GET /api/health is ok', async () => {
    const res = await api.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown /api route is a JSON 404', async () => {
    const res = await api.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('security headers', () => {
  it('adds noindex and the hardening headers', () => {
    const res = withSecurityHeaders(new Response('x'));
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
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
