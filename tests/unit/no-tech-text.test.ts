// Nothing technical reaches a normal user: no Supabase, SQL, Cloudflare, GitHub, key or secret names, pipeline or migration
// wording in what any API route answers a member who may use every tab. Technical text lives only on the Connectors page and the
// owner-only pages (data health, admin), which a member cannot open. Synthetic data only; fetch is stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api, GROUPS } from '../../src/api/index';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { TECH_WORDS } from '../shared/tech-words';

// No optional key is set, so every "not enabled" branch is taken
const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com' };
const cfg = A.env(E);
const ALL = Object.fromEntries(Object.keys(A.DASHBOARDS).map(k => [k, 'approve']));
const member: A.Profile = { id: '33333333-3333-3333-3333-333333333333', email: 'member@example.com', role: 'member', active: true, access: ALL, company_id: WELL_COMPANY };

const DENY = TECH_WORDS;
// Allowed to be technical: the Connectors page and the owner-only pages (a member cannot open them)
const SKIP_GROUPS = new Set(['connectors', 'admin']);
const calls = Object.entries(GROUPS).filter(([g]) => !SKIP_GROUPS.has(g))
  .flatMap(([g, routes]) => Object.entries(routes).flatMap(([a, m]) => Object.keys(m ?? {}).map(method => ({ path: `/api/${g}/${a}`, method }))));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Every string value in a JSON answer (keys are code, values are what the page shows)
const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out));
  return out;
};

const SCENES: [string, (u: string) => Response][] = [
  ['tables not created yet', u => (u.includes('/profiles?id=eq.') ? new Response(JSON.stringify([member])) : new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table public.x in the schema cache' }), { status: 404 }))],
  ['server error from the database', u => (u.includes('/profiles?id=eq.') ? new Response(JSON.stringify([member])) : new Response(JSON.stringify({ message: 'boom' }), { status: 500 }))],
  ['empty database', u => (u.includes('/profiles?id=eq.') ? new Response(JSON.stringify([member])) : new Response('[]'))],
];

describe('no technical text for a normal user', () => {
  it('sees the routes', () => { expect(calls.length).toBeGreaterThan(70); });
  for (const [name, answer] of SCENES) {
    it(`${name}: no route's answer names a service, key, SQL or file`, async () => {
      vi.stubGlobal('fetch', vi.fn(async (u: string) => answer(String(u))));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(member, cfg), cfg.secret))}`;
      const bad: string[] = [];
      for (const c of calls) {
        const res = await api.request('https://well.example' + c.path, { method: c.method, headers: { origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie }, ...(c.method === 'GET' ? {} : { body: '{}' }) }, E);
        const text = await res.text();
        let seen: string[] = [];
        try { seen = strings(JSON.parse(text)); } catch { seen = [text.replace(/<[^>]*>/g, ' ')]; }
        // A bare code (a status such as 'mcp') is not text the page shows
        for (const s of seen) if (!/^[a-z0-9_-]+$/.test(s) && DENY.test(s)) bad.push(`${c.method} ${c.path} (${res.status}): ${s.slice(0, 110)}`);
      }
      expect(bad).toEqual([]);
    }, 90_000);
  }
});
