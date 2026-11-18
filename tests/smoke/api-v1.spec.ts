// /api/v1 on the real built Worker (synthetic, no network). The smoke Worker has no READ_API_KEY, so the API is off: a plain 404 for
// everything, never a redirect to the login page and never data. A made-up key opens nothing anywhere else. The key's behaviour itself is
// covered in tests/unit/api-v1.test.ts.
import { test, expect } from '@playwright/test';

const BASE = `http://localhost:${process.env['SMOKE_PORT'] || 8787}`;
const FAKE_KEY = 'wad_' + 'Z'.repeat(43);   // well-formed, never issued

test('with no READ_API_KEY the whole /api/v1 router is a JSON 404, for every method and path', async ({ request }) => {
  for (const p of ['/api/v1/dash', '/api/v1/openapi.json', '/api/v1/anything', '/api/v1']) {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const r = await request.fetch(BASE + p, { method, headers: { authorization: `Bearer ${FAKE_KEY}` }, maxRedirects: 0 });
      expect(r.status(), `${method} ${p}`).toBe(404);
      expect(r.headers()['location']).toBeUndefined();
      if (method === 'GET') expect(await r.text()).not.toContain('"ads"');
    }
  }
});
test('a key is no session: the other routes still want one', async ({ request }) => {
  const h = { authorization: `Bearer ${FAKE_KEY}` };
  for (const p of ['/api/dash/data', '/api/admin/users', '/api/control/suggestions', '/api/overview/data', '/api/campaigns/list', '/api/connectors/list']) {
    const r = await request.get(BASE + p, { headers: h, maxRedirects: 0 });
    expect(r.status(), p).toBe(401);
  }
  for (const p of ['/', '/admin/', '/control/', '/dash.json']) {
    const r = await request.get(BASE + p, { headers: h, maxRedirects: 0 });
    expect([302, 401], p).toContain(r.status());
  }
});
