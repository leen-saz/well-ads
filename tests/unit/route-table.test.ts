// Generated permission matrix: walks every route of the API (src/api/routes/*.ts and src/modules/*/routes.ts) and checks,
// for every handler and method, what the gate says and what the handler itself enforces:
//   - no cookie                       -> 401 (the handler guards itself; the gate is not the only wall)
//   - signed in, no dashboard         -> 403
//   - another company's user          -> 403 on the Well-only groups
//   - module switched off by company  -> 403, owner included
//   - only `view` on the module       -> 403 for every method that changes something
//   - cross-site request (no origin)  -> 403 for every method that changes something
//   - `approve` on the route's module -> never 401/403 (so the gate's need() and the handler agree)
// A new route is picked up automatically. A route that is public on purpose, or reads only with a POST, is listed below
// with its reason; anything else that does not fit fails here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { need } from '../../src/lib/gate';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { api } from '../../src/api/index';
import { LIVE } from '../../src/modules/registry';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com' };
const cfg = A.env(E);
const OTHER_CO = '22222222-2222-2222-2222-222222222222';

type Handlers = Record<string, Record<string, unknown>>;
const groups: Record<string, Handlers> = {};
for (const [p, m] of Object.entries(import.meta.glob('../../src/api/routes/*.ts', { eager: true }))) groups[p.match(/routes\/(\w+)\.ts$/)![1]!] = m as Handlers;
for (const [p, m] of Object.entries(import.meta.glob('../../src/modules/*/routes.ts', { eager: true }))) groups[p.match(/modules\/(\w+)\/routes\.ts$/)![1]!] = m as Handlers;

// group -> what the gate and the handlers must ask for. Module groups ask for their own key.
const CORE_NEED: Record<string, string> = { auth: 'public', admin: 'owner', account: 'any', connectors: 'connectors', control: 'control', dash: 'any', lessons: 'any', library: 'any', today: 'any', campaigns: 'any', vitals: 'any' };
const needOfGroup = (g: string) => CORE_NEED[g] ?? g;

// Public on purpose (the gate lets them through without a session)
const PUBLIC = new Set(['auth/login', 'auth/logout', 'auth/refresh', 'auth/forgot', 'auth/reset', 'connectors/callback', 'listening/probe']);
// Handlers that ask for a higher need than their group (owner-only actions inside a module group)
const OWNER_ONLY = new Set(['admin/log', 'admin/users', 'admin/modules', 'admin/direct', 'admin/orphans', 'admin/password', 'control/settings:POST', 'maestro/connect', 'maestro/crm', 'maestro/health', 'maestro/usage', 'maestro/budgets', 'maestro/models', 'maestro/reconcile', 'social/approvers:PUT', 'social/pages', 'social/connection', 'social/engine', 'listening/probe', 'maestro/vitals', 'maestro/audit', 'maestro/critique', 'overview/span']);
// POST/PUT/PATCH/DELETE handlers that change nothing (a check that happens to take a body), so they may skip the same-origin and level checks
const READ_ONLY_VERBS = new Set(['control/compliance:POST', 'vitals/report:POST']);
// Handlers that need no module level (any signed-in user): the level checks do not apply, and nothing is company data
const ANY = (g: string) => needOfGroup(g) === 'any';
// Groups whose data is Well's alone until keys and decisions are per company (connections, control_settings, suggestions have no company column)
const WELL_ONLY = ['control', 'connectors'];
// An empty body means "turn off", which only the owner may do
const NEEDS_OWNER_TO_TURN_OFF = new Set(['control/kill:POST', 'overview/data:GET' /* also needs analytics (ceo) and no department scope */]);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const profile = (access: Record<string, string>, extra: Partial<A.Profile> = {}): A.Profile =>
  ({ id: '33333333-3333-3333-3333-333333333333', email: 'member@example.com', role: 'member', active: true, access, company_id: WELL_COMPANY, ...extra });
async function call(path: string, method: string, p: A.Profile | null, headers: Record<string, string> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(p && String(url).includes('/profiles?id=eq.') ? [p] : []))));
  const cookie = p ? `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}` : '';
  const h: Record<string, string> = { origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers };
  for (const k of Object.keys(h)) if (h[k] === '') delete h[k];
  const res = await api.request('https://well.example' + path, { method, headers: h, ...(MUTATING.has(method) ? { body: '{}' } : {}) }, E);
  await res.text();
  return res.status;
}

type Route = { group: string; name: string; method: string; path: string; id: string };
const routes: Route[] = [];
for (const [group, mod] of Object.entries(groups)) {
  for (const [name, h] of Object.entries(mod)) {
    if (!h || typeof h !== 'object') continue;
    for (const [method, fn] of Object.entries(h)) {
      if (typeof fn === 'function' && /^[A-Z]+$/.test(method)) routes.push({ group, name, method, path: `/api/${group}/${name}`, id: `${group}/${name}` });
    }
  }
}
const open = (r: Route) => PUBLIC.has(r.id);
const secured = routes.filter(r => !open(r));
afterEach(() => { vi.unstubAllGlobals(); });

const isOwnerOnly = (r: Route) => OWNER_ONLY.has(r.id) || OWNER_ONLY.has(`${r.id}:${r.method}`);
const isReadOnlyVerb = (r: Route) => READ_ONLY_VERBS.has(`${r.id}:${r.method}`);
// Every route is checked and the list of those that fail is compared with [], so one run shows them all
async function offenders(list: Route[], bad: (r: Route) => Promise<string | null>): Promise<string[]> {
  const out: string[] = [];
  for (const r of list) { const why = await bad(r); if (why) out.push(`${r.method} ${r.path}: ${why}`); }
  return out;
}
const ALL = Object.fromEntries(Object.keys(A.DASHBOARDS).map(k => [k, 'approve']));

describe('route table', () => {
  it('finds the routes (guards against the glob finding nothing)', () => {
    expect(routes.length).toBeGreaterThan(60);
    expect(Object.keys(groups)).toEqual(expect.arrayContaining(['control', 'connectors', 'admin', 'social', 'design']));
  });

  it('every module group is a live module the registry knows, and every route is mounted in src/api/index.ts', async () => {
    for (const g of Object.keys(groups)) if (!(g in CORE_NEED)) expect(LIVE, `${g} has routes but is not a live module`).toContain(g);
    expect(await offenders(routes, async r => ((await call(r.path, r.method, null)) === 404 ? 'not mounted (404)' : null))).toEqual([]);
  });

  it('the gate asks for the same thing as the group: public stays public, the rest never opens without a session', () => {
    const bad: string[] = [];
    for (const r of routes) {
      const want = need(r.path, '');
      if (open(r)) { if (want !== null) bad.push(`${r.path} must be public in the gate, got ${want}`); }
      else if (isOwnerOnly(r)) { if (!['owner', needOfGroup(r.group)].includes(want as string)) bad.push(`${r.path}: gate ${want}`); }
      else if (want !== needOfGroup(r.group)) bad.push(`${r.path}: gate asks ${want}, group is ${needOfGroup(r.group)}`);
    }
    expect(bad).toEqual([]);
  });

  it('no session -> 401 from the handler itself', async () => {
    expect(await offenders(secured, async r => { const s = await call(r.path, r.method, null); return s === 401 ? null : `got ${s}`; })).toEqual([]);
  });

  it('signed in without any dashboard -> 403 (except routes open to any signed-in user)', async () => {
    expect(await offenders(secured.filter(x => !ANY(x.group)), async r => { const s = await call(r.path, r.method, profile({})); return s === 403 ? null : `got ${s}`; })).toEqual([]);
  });

  it('a module the company switched off is locked, the owner included', async () => {
    expect(await offenders(secured.filter(x => LIVE.includes(x.group) && !isOwnerOnly(x)), async r => {
      const s = await call(r.path, r.method, profile({}, { role: 'owner', email: 'owner@example.com', company: { disabled_modules: [r.group] } }));
      return s === 403 ? null : `got ${s}`;
    })).toEqual([]);
  });

  it('view level cannot change anything', async () => {
    expect(await offenders(secured.filter(x => MUTATING.has(x.method) && !ANY(x.group) && !isReadOnlyVerb(x)), async r => {
      const s = await call(r.path, r.method, profile({ [needOfGroup(r.group)]: 'view' }));
      return s === 403 ? null : `got ${s}`;
    })).toEqual([]);
  });

  it('owner-only routes refuse a member who has approve on every dashboard', async () => {
    expect(await offenders(secured.filter(isOwnerOnly), async r => { const s = await call(r.path, r.method, profile(ALL)); return s === 403 ? null : `got ${s}`; })).toEqual([]);
  });

  it('a change from another site is refused before anything runs', async () => {
    expect(await offenders(secured.filter(x => MUTATING.has(x.method) && !isReadOnlyVerb(x)), async r => {
      const s = await call(r.path, r.method, profile(ALL, { role: 'owner', email: 'owner@example.com' }), { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
      return s === 403 ? null : `got ${s}`;
    })).toEqual([]);
  });

  it("approve on the route's own dashboard gets past auth (the gate's need and the handler agree)", async () => {
    expect(await offenders(secured.filter(x => !ANY(x.group) && !isOwnerOnly(x) && !NEEDS_OWNER_TO_TURN_OFF.has(`${x.id}:${x.method}`)), async r => {
      const s = await call(r.path, r.method, profile({ [needOfGroup(r.group)]: 'approve' }));
      return s === 401 || s === 403 ? `got ${s}` : null;
    })).toEqual([]);
  });

  it("Well-only groups refuse another company's users (their keys, decisions and numbers are Well's)", async () => {
    expect(await offenders(secured.filter(x => WELL_ONLY.includes(x.group)), async r => {
      const s = await call(r.path, r.method, profile({ [needOfGroup(r.group)]: 'approve' }, { company_id: OTHER_CO }));
      return s === 403 || s === 404 ? null : `got ${s}`;
    })).toEqual([]);
  });
});
