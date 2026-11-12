// Approved execution for the media buyer, end to end through the real routes, against a fake Supabase and a fake Meta.
// Everything is synthetic: made-up campaign, ids, numbers and a made-up key. NO real network call can happen here: the fetch stub
// answers only the two fake hosts and throws on anything else.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../pipeline/dash/00-judge.js';
// The tab is hidden in the app (src/modules/buyer/flag.ts); these tests keep the dormant execution layer honest, so they mount it.
vi.mock('../../src/modules/buyer/flag', () => ({ BUYER_ENABLED: true }));
import { api } from '../../src/api/index';
import { sign, SESSION, type AuthEnv } from '../../src/lib/auth';

const SECRET = 'EXEC_TOKEN_SECRET_0000';
const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', SESSION_SECRET: 's'.repeat(32), OWNER_EMAIL: 'leen@x.co',
  META_WRITE_TOKEN: SECRET, META_WRITE_AD_ACCOUNT_ID: '999' } as AuthEnv;
const ORIGIN = 'https://well.test';
type Profile = { id: string; email: string; role: string; dashboards: string[]; access?: Record<string, string>; active: boolean };
const OWNER: Profile = { id: 'u0', email: 'leen@x.co', role: 'owner', dashboards: [], active: true };
const APPROVER: Profile = { id: 'u1', email: 'a@x.co', role: 'member', dashboards: ['buyer'], access: { buyer: 'approve' }, active: true };
const EDITOR: Profile = { id: 'u2', email: 'e@x.co', role: 'member', dashboards: ['buyer'], access: { buyer: 'edit' }, active: true };
const VIEWER: Profile = { id: 'u3', email: 'v@x.co', role: 'member', dashboards: ['buyer'], access: { buyer: 'view' }, active: true };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const T = globalThis.WELL_JUDGE.targets(null);
const NOW = Date.now();
const dayOf = (back: number) => new Date(NOW + 3 * 3600e3 - back * 864e5).toISOString().slice(0, 10);

interface World {
  actions: Row[]; settings: Row[]; audit: Row[];
  camp: { id: string; name: string; status: string; daily_budget: string };
  platformCalls: { url: string; method: string; body: string; auth: string | null }[];
  duplicateCampaign: boolean;
}
let W: World;
let profile: Profile;
const writes = () => W.platformCalls.filter(c => c.method !== 'GET');

function fresh(): World {
  return {
    actions: [], audit: [], platformCalls: [], duplicateCampaign: false,
    settings: [{ platform: 'global', guardrails: { kill: false, exec: { dailyCap: 50 } } }, { platform: 'meta', guardrails: { exec: { live: true } } }],
    camp: { id: '111', name: 'TEST_C1', status: 'ACTIVE', daily_budget: '10000' },   // 100.00 in the account currency
  };
}
const match = (r: Row, q: URLSearchParams) => {
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'or', 'company_id'].includes(k)) continue;
    const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
    if (op === 'eq' && String(r[k]) !== val) return false;
    if (op === 'in' && !val.slice(1, -1).split(',').includes(String(r[k]))) return false;
  }
  return true;
};
function install() {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input), method = init.method || 'GET', body = init.body ? String(init.body) : '';
    const json = (d: unknown, status = 200) => new Response(d === null ? '' : JSON.stringify(d), { status });
    if (url.startsWith('https://graph.facebook.com/')) {
      const h = new Headers(init.headers);
      W.platformCalls.push({ url, method, body, auth: h.get('authorization') });
      const path = new URL(url).pathname.replace(/^\/v23\.0\//, ''), c = W.camp;
      if (path === 'act_999' && method === 'GET') return json({ currency: 'SAR', id: 'act_999' });
      if (path === 'act_999/campaigns') return json({ data: [c, ...(W.duplicateCampaign ? [{ ...c, id: '222' }] : [])] });
      if (path === `${c.id}` && method === 'GET') return json(c);
      if (path === `${c.id}` && method === 'POST') {
        const p = new URLSearchParams(body);
        if (p.get('daily_budget')) c.daily_budget = p.get('daily_budget') as string;
        if (p.get('status')) c.status = p.get('status') as string;
        return json({ success: true });
      }
      return json({ error: { code: 100 } }, 400);
    }
    if (!url.startsWith('https://db.test/rest/v1/')) throw new Error('unexpected network call: ' + url);   // a real platform would end up here
    const u = new URL(url), table = u.pathname.split('/').pop() as string, q = u.searchParams;
    if (table === 'profiles') return json([profile]);
    if (table === 'audit_log') { W.audit.push(JSON.parse(body)); return json(null); }
    if (table === 'control_settings') {
      if (method === 'POST') { const b = JSON.parse(body) as Row; const i = W.settings.findIndex(s => s.platform === b.platform); if (i >= 0) W.settings[i] = { ...W.settings[i], ...b }; else W.settings.push(b); return json(null); }
      return json(W.settings);
    }
    if (table === 'ads') return json([{ ad_key: 'm1', platform: 'facebook', campaign: 'TEST_C1', name: 'ad one', goal: 'lead', live: true }]);
    if (table === 'ad_metrics') {
      const rows: Row[] = []; for (let i = 27; i >= 0; i--) rows.push({ ad_key: 'm1', day: dayOf(1 + i), spend: T.cpl, impressions: 4000, clicks: 80, leads: 2, conversations: 0 });
      return json(rows);
    }
    if (table === 'buyer_actions') {
      if (method === 'POST') {
        const b = JSON.parse(body) as Row;
        if (W.actions.some(a => a.idem_key === b.idem_key && ['proposed', 'applying', 'applied'].includes(a.status))) return json({ code: '23505' }, 409);
        const row = { id: '00000000-0000-4000-8000-' + String(W.actions.length + 1).padStart(12, '0'), created_at: new Date().toISOString(), status: 'proposed', dry_run: null, result: null, applied_at: null, rolled_back_at: null, decided_by: null, decided_at: null, ...b };
        W.actions.push(row); return json([row], 201);
      }
      let rows = W.actions.filter(r => match(r, q));
      if (method === 'PATCH') { const patch = JSON.parse(body) as Row; rows.forEach(r => Object.assign(r, patch)); return json(rows); }
      if (q.get('order')?.startsWith('applied_at')) rows = rows.filter(r => r.status === 'applied').sort((a, b) => String(b.applied_at).localeCompare(String(a.applied_at))).slice(0, 1);
      return json(rows);
    }
    throw new Error('unexpected table ' + table);
  }));
}

async function call(path: string, init: { method?: string; body?: unknown; anon?: boolean; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (!init.anon) {
    const now = Date.now();
    const token = await sign({ uid: profile.id, email: profile.email, name: '', role: profile.role, dash: profile.dashboards, depts: [], exp: now + 3600e3, chk: now }, ENV.SESSION_SECRET as string);
    headers.set('cookie', `${SESSION}=${token}`);
  }
  if (init.method && init.method !== 'GET') { headers.set('origin', ORIGIN); headers.set('content-type', 'application/json'); }
  const res = await api.request(ORIGIN + path, { method: init.method || 'GET', headers, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) }, ENV);
  return { status: res.status, body: await res.json().catch(() => ({})) as Row };
}
const as = (p: Profile) => { profile = p; };
const REC = 'scale_up:meta:TEST_C1:budget_up';
async function propose() { as(EDITOR); const r = await call('/api/buyer/propose', { method: 'POST', body: { rec_id: REC } }); expect(r.status).toBe(200); return r.body; }
const open = () => W.actions[0] as Row;
const expectOf = (a: Row) => ({ from: a.change.from, to: a.change.to });
const applyBody = (a: Row, over: Row = {}) => ({ id: a.id, confirm: true, mode: 'live', expect: expectOf(a), ...over });

beforeEach(() => { W = fresh(); install(); profile = OWNER; });
afterEach(() => vi.unstubAllGlobals());

describe('proposing: the server derives the action, the browser sends only an id', () => {
  it('turns the recommendation into an action with the exact current and new value, and writes nothing to the platform', async () => {
    const r = await propose();
    expect(r.mode).toBe('auto');
    const a = open();
    expect(a).toMatchObject({ platform: 'meta', level: 'campaign', entity_id: '111', status: 'proposed', mode: 'auto' });
    expect(a.change).toEqual({ op: 'budget', from: 100, to: 120, pct: 20 });   // read live from the platform, not computed from our numbers
    expect(a.reason.length).toBeGreaterThan(5); expect(a.risk.length).toBeGreaterThan(5); expect(a.success.metric).toBeTruthy();
    expect(writes()).toEqual([]);
    expect(W.audit.map(x => x.action)).toContain('buyer_proposed');
  });
  it('the same change the same day is one row, not two', async () => {
    await propose(); const again = await propose();
    expect(W.actions).toHaveLength(1); expect(again.existing).toBe(true);
  });
  it('a viewer cannot propose, and an unknown recommendation is refused', async () => {
    as(VIEWER); expect((await call('/api/buyer/propose', { method: 'POST', body: { rec_id: REC } })).status).toBe(403);
    as(EDITOR); expect((await call('/api/buyer/propose', { method: 'POST', body: { rec_id: 'nope' } })).status).toBe(404);
    expect(W.actions).toHaveLength(0);
  });
  it('two campaigns with the same name become a manual action, never a guess', async () => {
    W.duplicateCampaign = true;
    const r = await propose();
    expect(r.mode).toBe('manual'); expect(r.manual_why).toBe('ambiguous'); expect(open().entity_id).toBeNull();
  });
  it('without the write key the action is manual with its details, and nothing is read from the platform', async () => {
    const env = { ...ENV, META_WRITE_TOKEN: '' } as AuthEnv;
    as(EDITOR);
    const now = Date.now(), token = await sign({ uid: profile.id, email: profile.email, name: '', role: profile.role, dash: profile.dashboards, depts: [], exp: now + 3600e3, chk: now }, env.SESSION_SECRET as string);
    const res = await api.request(ORIGIN + '/api/buyer/propose', { method: 'POST', headers: { cookie: `${SESSION}=${token}`, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ rec_id: REC }) }, env);
    expect((await res.json() as Row).manual_why).toBe('not_configured');
    expect(open().change).toEqual({ op: 'budget', from: null, to: null, pct: 20 });
    expect(W.platformCalls).toEqual([]);
  });
});

describe('no execution without the owner pressing the button', () => {
  it('nothing reaches the platform before approval, however the request is made', async () => {
    await propose(); const a = open();
    const attempts: [string, Profile | null, Row][] = [
      ['no session', null, applyBody(a)], ['viewer', VIEWER, applyBody(a)], ['editor (no approve)', EDITOR, applyBody(a)],
      ['approver without the second confirmation', APPROVER, applyBody(a, { confirm: undefined })], ['confirm as a string', APPROVER, applyBody(a, { confirm: 'true' })],
      ['figures that differ from the modal', APPROVER, applyBody(a, { expect: { from: 100, to: 150 } })], ['no figures at all', APPROVER, applyBody(a, { expect: undefined })],
    ];
    for (const [name, who, body] of attempts) {
      if (who) as(who);
      const r = await call('/api/buyer/apply', { method: 'POST', body, anon: !who });
      expect(r.status, name).toBeGreaterThanOrEqual(400);
    }
    expect(writes()).toEqual([]);
    expect(open().status).toBe('proposed');
    expect(W.audit.map(x => x.action)).not.toContain('buyer_applied');
  });
  it('a cross-site request cannot apply', async () => {
    await propose(); as(APPROVER);
    const now = Date.now(), token = await sign({ uid: APPROVER.id, email: APPROVER.email, name: '', role: 'member', dash: ['buyer'], depts: [], exp: now + 3600e3, chk: now }, ENV.SESSION_SECRET as string);
    const raw = await api.request(ORIGIN + '/api/buyer/apply', { method: 'POST', headers: { cookie: `${SESSION}=${token}`, origin: 'https://evil.test', 'content-type': 'application/json' }, body: JSON.stringify(applyBody(open())) }, ENV);
    expect(raw.status).toBe(403);
    expect(writes()).toEqual([]);
  });
});

describe('dry-run is the default and never writes', () => {
  it('a confirmed apply without «real execution» only previews: no write call, the action stays open, the preview is logged', async () => {
    await propose(); as(APPROVER);
    const r = await call('/api/buyer/apply', { method: 'POST', body: applyBody(open(), { mode: undefined }) });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ dry: true, wrote: false, blocks: [], stale: false });
    expect(r.body.live_state).toMatchObject({ budget: 100 });
    expect(writes()).toEqual([]); expect(W.camp.daily_budget).toBe('10000');
    expect(open().status).toBe('proposed'); expect(open().dry_run).toBeTruthy();
    expect(W.audit.map(x => x.action)).toContain('buyer_dry_run');
  });
  it('real execution is refused while the platform\'s own switch is off, and a dry run still works', async () => {
    W.settings[1] = { platform: 'meta', guardrails: { exec: { live: false } } };
    await propose(); as(APPROVER);
    const live = await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) });
    expect(live.status).toBe(409); expect(live.body.code).toBe('live_off');
    const dry = await call('/api/buyer/apply', { method: 'POST', body: applyBody(open(), { mode: 'dry' }) });
    expect(dry.status).toBe(200);
    expect(writes()).toEqual([]);
  });
});

describe('real execution', () => {
  it('writes the exact approved value once, reads it back, records before and after, and a second click does nothing', async () => {
    await propose(); as(APPROVER);
    const r = await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ ok: true, applied: true, before: { budget: 100 }, after: { budget: 120 } });
    expect(writes()).toHaveLength(1);
    expect(new URLSearchParams(writes()[0]!.body).get('daily_budget')).toBe('12000');   // 120.00 in halalas
    expect(W.camp.daily_budget).toBe('12000');
    expect(open()).toMatchObject({ status: 'applied', decided_by: APPROVER.email }); expect(open().result).toMatchObject({ before: { budget: 100 }, after: { budget: 120 } });
    const log = W.audit.find(x => x.action === 'buyer_applied')!;
    expect(log).toMatchObject({ email: APPROVER.email, before: { budget: 100 }, after: { budget: 120 } });
    const again = await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) });
    expect(again.status).toBe(409); expect(again.body.code).toBe('not_open');
    expect(writes()).toHaveLength(1);
  });
  it('the owner can apply too; the platform key rides in the Authorization header only', async () => {
    await propose(); as(OWNER);
    expect((await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) })).status).toBe(200);
    expect(W.platformCalls.every(c => c.auth === `Bearer ${SECRET}` && !c.url.includes(SECRET) && !c.body.includes(SECRET))).toBe(true);
  });
  it('cancels if the platform value is no longer the one shown, and writes nothing', async () => {
    await propose(); W.camp.daily_budget = '11000';   // someone changed it in Ads Manager after the proposal
    as(APPROVER);
    const r = await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) });
    expect(r.status).toBe(409); expect(r.body.code).toBe('changed');
    expect(writes()).toEqual([]); expect(open().status).toBe('aborted');
    expect(W.audit.find(x => x.action === 'buyer_aborted')).toBeTruthy();
  });
  it('cancels if a read from the platform fails: no blind write', async () => {
    await propose(); as(APPROVER);
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>, inner = f.getMockImplementation() as (u: string, i?: RequestInit) => Promise<Response>;
    f.mockImplementation(async (url: string, init: RequestInit = {}) => (String(url).startsWith('https://graph.facebook.com/') ? new Response('{}', { status: 500 }) : inner(url, init)));   // the platform is down
    const r = await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) });
    expect(r.status).toBe(502); expect(r.body.code).toBe('read_failed'); expect(writes()).toEqual([]); expect(open().status).toBe('proposed');
  });
  it('records a failure when the platform ignores the write', async () => {
    await propose(); as(APPROVER);
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>, inner = f.getMockImplementation() as (u: string, i?: RequestInit) => Promise<Response>;
    f.mockImplementation(async (url: string, init: RequestInit = {}) => (String(url).startsWith('https://graph.facebook.com/') && init.method === 'POST' ? new Response(JSON.stringify({ error: { code: 190, message: 'Invalid OAuth ' + SECRET } }), { status: 400 }) : inner(url, init)));
    const r = await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) });
    expect(r.status).toBe(502); expect(open().status).toBe('failed');
    expect(JSON.stringify([r.body, W.audit, W.actions])).not.toContain(SECRET);   // the platform's own message (which may echo a key) is never kept
    expect(JSON.stringify(W.audit)).toContain('meta_400_190');
  });
});

describe('the mandatory guards', () => {
  it('a change over the percentage cap is refused (default 20%, owner may tighten)', async () => {
    W.settings[0] = { platform: 'global', guardrails: { kill: false, exec: { dailyCap: 50, maxPct: 10 } } };
    await propose(); as(APPROVER);
    const r = await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) });
    expect(r.status).toBe(409); expect(r.body.blocks).toEqual([{ code: 'cap_pct', detail: 10 }]); expect(writes()).toEqual([]);
  });
  it('an increase with no daily total cap set, or over it, is refused', async () => {
    W.settings[0] = { platform: 'global', guardrails: { kill: false } };
    await propose(); as(APPROVER);
    expect((await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) })).body.blocks).toEqual([{ code: 'no_daily_cap' }]);
    W.settings[0] = { platform: 'global', guardrails: { kill: false, exec: { dailyCap: 15 } } };
    expect((await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) })).body.blocks).toEqual([{ code: 'cap_daily', detail: 15 }]);
    // earlier increases today count against the same total
    W.settings[0] = { platform: 'global', guardrails: { kill: false, exec: { dailyCap: 25 } } };
    W.actions.push({ id: 'x', status: 'applied', platform: 'snapchat', entity_id: 's1', applied_at: new Date().toISOString(), change: { op: 'budget', from: 50, to: 60, pct: 20 } });
    expect((await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) })).body.blocks).toEqual([{ code: 'cap_daily', detail: 25 }]);
    expect(writes()).toEqual([]);
  });
  it('a second change to the same entity inside 48 hours is refused', async () => {
    W.actions.push({ id: 'prior', status: 'applied', platform: 'meta', entity_id: '111', applied_at: new Date(NOW - 30 * 3600e3).toISOString(), change: { op: 'status', from: 'paused', to: 'active' } });
    await propose(); as(APPROVER);
    const r = await call('/api/buyer/apply', { method: 'POST', body: applyBody(W.actions[1]!) });
    expect(r.body.blocks).toEqual([{ code: 'cooldown', detail: 48 }]); expect(writes()).toEqual([]);
    W.actions[0]!.applied_at = new Date(NOW - 50 * 3600e3).toISOString();   // outside the window: allowed again
    expect((await call('/api/buyer/apply', { method: 'POST', body: applyBody(W.actions[1]!) })).status).toBe(200);
  });
  it('the emergency stop blocks every real execution at once, and a dry run still shows what it would have done', async () => {
    await propose(); as(APPROVER);
    expect((await call('/api/buyer/execution', { method: 'POST', body: { kill: true } })).status).toBe(200);
    const r = await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) });
    expect(r.status).toBe(409); expect(r.body.code).toBe('kill'); expect(writes()).toEqual([]);
    expect(W.audit.map(x => x.action)).toContain('buyer_kill_on');
    expect((await call('/api/buyer/apply', { method: 'POST', body: applyBody(open(), { mode: 'dry' }) })).body.blocks).toEqual(['kill']);
  });
  it('anyone who may approve can press the stop; only the owner lifts it or changes the limits and switches', async () => {
    as(APPROVER);
    for (const body of [{ kill: false }, { maxPct: 40 }, { dailyCap: 500 }, { live: { platform: 'meta', on: true } }]) expect((await call('/api/buyer/execution', { method: 'POST', body })).status, JSON.stringify(body)).toBe(403);
    as(EDITOR); expect((await call('/api/buyer/execution', { method: 'POST', body: { kill: true } })).status).toBe(403);
    as(OWNER);
    expect((await call('/api/buyer/execution', { method: 'POST', body: { kill: true } })).status).toBe(200);
    expect((await call('/api/buyer/execution', { method: 'POST', body: { kill: false } })).status).toBe(200);
    expect(W.settings[0]!.guardrails.kill).toBe(false);
  });
  it('the limits keep a hard ceiling, and real execution cannot be switched on without the key', async () => {
    as(OWNER);
    await call('/api/buyer/execution', { method: 'POST', body: { maxPct: 400 } });
    expect(W.settings[0]!.guardrails.exec.maxPct).toBe(50);
    expect((await call('/api/buyer/execution', { method: 'POST', body: { live: { platform: 'snapchat', on: true } } })).status).toBe(409);   // no Snap key in this env
    expect((await call('/api/buyer/execution', { method: 'POST', body: { live: { platform: 'tiktok', on: true } } })).status).toBe(400);
  });
  it('an unreadable settings table counts as stopped, not as free to run', async () => {
    await propose(); as(APPROVER);
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>, inner = f.getMockImplementation() as (u: string, i?: RequestInit) => Promise<Response>;
    f.mockImplementation(async (url: string, init: RequestInit = {}) => (String(url).includes('/control_settings') && (init.method ?? 'GET') === 'GET' ? new Response('{}', { status: 500 }) : inner(url, init)));
    const r = await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) });
    expect(r.status).toBe(409); expect(writes()).toEqual([]);
  });
});

describe('rollback of the last action', () => {
  async function applied() { await propose(); as(APPROVER); expect((await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) })).status).toBe(200); }
  it('restores the previous value, only after a second confirmation, and records it', async () => {
    await applied();
    expect((await call('/api/buyer/rollback', { method: 'POST', body: { id: open().id } })).status).toBe(400);
    expect(writes()).toHaveLength(1);
    const r = await call('/api/buyer/rollback', { method: 'POST', body: { id: open().id, confirm: true } });
    expect(r.status).toBe(200); expect(W.camp.daily_budget).toBe('10000'); expect(open().status).toBe('rolled_back');
    expect(W.audit.map(x => x.action)).toContain('buyer_rolled_back'); expect(writes()).toHaveLength(2);
  });
  it('refuses when someone changed the value after us, or when it is not the last action', async () => {
    await applied(); W.camp.daily_budget = '13000';
    const r = await call('/api/buyer/rollback', { method: 'POST', body: { id: open().id, confirm: true } });
    expect(r.status).toBe(409); expect(r.body.code).toBe('changed_since'); expect(writes()).toHaveLength(1);
    W.camp.daily_budget = '12000';
    W.actions.push({ id: 'later', status: 'applied', platform: 'meta', entity_id: '333', applied_at: new Date(Date.now() + 1000).toISOString(), change: { op: 'status', from: 'active', to: 'paused' } });
    expect((await call('/api/buyer/rollback', { method: 'POST', body: { id: open().id, confirm: true } })).body.code).toBe('not_last');
  });
  it('is blocked by the emergency stop too', async () => {
    await applied(); W.settings[0] = { platform: 'global', guardrails: { kill: true, exec: { dailyCap: 50 } } };
    expect((await call('/api/buyer/rollback', { method: 'POST', body: { id: open().id, confirm: true } })).body.code).toBe('kill');
    expect(writes()).toHaveLength(1);
  });
});

describe('reject and hand-done', () => {
  it('reject closes the action and never calls a platform; only approvers may', async () => {
    await propose(); as(EDITOR);
    expect((await call('/api/buyer/decide', { method: 'POST', body: { id: open().id, decision: 'reject' } })).status).toBe(403);
    as(APPROVER);
    expect((await call('/api/buyer/decide', { method: 'POST', body: { id: open().id, decision: 'reject' } })).status).toBe(200);
    expect(open().status).toBe('rejected'); expect(W.platformCalls.filter(c => c.method !== 'GET')).toEqual([]);
    expect((await call('/api/buyer/apply', { method: 'POST', body: applyBody(open()) })).body.code).toBe('not_open');
  });
  it('the queue lists actions with the limits, the switches and who may approve, and never the key', async () => {
    await propose(); as(APPROVER);
    const r = await call('/api/buyer/actions');
    expect(r.status).toBe(200);
    expect(r.body.can).toEqual({ approve: true, owner: false });
    expect(r.body.settings).toMatchObject({ kill: false, maxPct: 20, dailyCap: 50, live: { meta: true, snapchat: false }, configured: { meta: true, snapchat: false } });
    expect(r.body.actions[0].guards.impact).toMatchObject({ dayDelta: 20, weekDelta: 140, pct: 20 });
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
  });
});
