// Fake Supabase for the smoke suite: synthetic users only, no real data, no network beyond localhost.
// Sign-in is accepted for the synthetic accounts below with the synthetic password. Every other table answers [].
import http from 'node:http';

export const PASSWORD = 'smoke-test-password-not-real';
export const DOMAIN = 'example.test';
export const OWNER = `owner@${DOMAIN}`;
// u-<key>@example.test may open only that dashboard; nobody@ has no dashboard at all
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function profileFor(email, n) {
  const local = email.split('@')[0];
  const base = { id: uuid(n), email, name: 'Smoke ' + local, active: true, departments: [], company_id: null, company: { disabled_modules: [] } };
  if (local === 'owner') return { ...base, role: 'owner', dashboards: [] };
  if (local === 'nobody') return { ...base, role: 'member', dashboards: [] };
  const m = local.match(/^u-([a-z]+)$/);
  // The overview numbers also need analytics (src/modules/overview/routes.ts)
  return { ...base, role: 'member', dashboards: m ? (m[1] === 'overview' ? ['overview', 'ceo'] : [m[1]]) : [] };
}

export function startFake(port, keys) {
  const accounts = [OWNER, `nobody@${DOMAIN}`, ...keys.map(k => `u-${k}@${DOMAIN}`)];
  const profiles = accounts.map((e, i) => profileFor(e, i + 1));
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      if (url.pathname === '/ping') return send(res, 200, { ok: true });
      if (url.pathname === '/auth/v1/token') {
        let b = {}; try { b = JSON.parse(raw || '{}'); } catch { /* bad body */ }
        const p = profiles.find(x => x.email === String(b.email || '').toLowerCase());
        if (!p || b.password !== PASSWORD) return send(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return send(res, 200, { access_token: 'fake', user: { id: p.id, email: p.email } });
      }
      if (url.pathname === '/rest/v1/profiles' && req.method === 'GET') {
        const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        return send(res, 200, profiles.filter(p => p.id === id));
      }
      if (req.method === 'GET') return send(res, 200, []);
      return send(res, 201);
    });
  });
  server.listen(port, '127.0.0.1');
  return server;
}

// Run as a script by Playwright's webServer
if (import.meta.url === `file://${process.argv[1]}`) {
  const keys = (process.env.SMOKE_KEYS || '').split(',').filter(Boolean);
  startFake(Number(process.env.FAKE_PORT || 8788), keys);
  console.log('fake supabase ready');
}
