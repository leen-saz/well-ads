import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/api/index';
import { dataKey } from '../../src/lib/dash';
import { need } from '../../src/lib/gate';
import { sign, SESSION, type AuthEnv } from '../../src/lib/auth';
import { WELL_COMPANY } from '../../src/lib/tenant';

const SECRET = 's'.repeat(32);
const ORIGIN = 'https://well.test';
const OTHER = '22222222-2222-2222-2222-222222222222';

type Who = { role?: string; dash?: string[]; depts?: string[]; co?: string };
type Profile = { id: string; email: string; role: string; dashboards: string[]; departments: string[]; company_id: string; active: boolean };
const profile = (w: Who): Profile => ({ id: 'u1', email: w.role === 'owner' ? 'leen@x.co' : 'm@x.co', role: w.role || 'member',
  dashboards: w.dash || [], departments: w.depts || [], company_id: w.co || WELL_COMPANY, active: true });

// R2 stand-in: only the keys given exist; If-None-Match on the current etag gives the bodiless object R2 returns
function bucket(keys: string[]) {
  const asked: string[] = [];
  const get = vi.fn(async (key: string, opts?: { onlyIf?: Headers }) => {
    asked.push(key);
    if (!keys.includes(key)) return null;
    const httpEtag = `"${key}"`;
    if (opts?.onlyIf?.get('if-none-match') === httpEtag) return { httpEtag };
    return { httpEtag, body: new Blob([JSON.stringify({ key })]).stream() };
  });
  return { FILES: { get } as unknown as R2Bucket, asked };
}

async function call(w: Who, files: { FILES: R2Bucket }, query = '', headers: Record<string, string> = {}) {
  const p = profile(w);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/rest/v1/profiles') ? [p] : null))));
  const now = Date.now();
  const token = await sign({ uid: p.id, email: p.email, name: '', role: p.role, dash: p.dashboards, depts: p.departments, co: p.company_id, exp: now + 3600e3, chk: now }, SECRET);
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', SESSION_SECRET: SECRET, OWNER_EMAIL: 'leen@x.co', ...files } as AuthEnv;
  return api.request(`${ORIGIN}/api/dash/data${query}`, { headers: { cookie: `${SESSION}=${token}`, ...headers } }, env);
}

afterEach(() => vi.unstubAllGlobals());

describe('/api/dash/data', () => {
  it('the gate hands it to the route, which picks the copy', () => {
    expect(need('/api/dash/data', '')).toBe('any');
  });

  it('analytics users get the full copy, with a short private cache', async () => {
    const b = bucket(['site/data/all.json']);
    const res = await call({ role: 'owner' }, b);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'site/data/all.json' });
    expect(res.headers.get('cache-control')).toBe('private, max-age=60, stale-while-revalidate=600');
    expect(res.headers.get('etag')).toBe('"site/data/all.json"');
  });

  it('a department manager gets only their department, whatever ?d= asks', async () => {
    const b = bucket(['site/data/dept/iv.json', 'site/data/dept/foot.json']);
    expect(await (await call({ dash: ['ceo'], depts: ['iv'] }, b)).json()).toEqual({ key: 'site/data/dept/iv.json' });
    expect(await (await call({ dash: ['ceo'], depts: ['iv'] }, b, '?d=foot')).json()).toEqual({ key: 'site/data/dept/iv.json' });
    expect(await (await call({ dash: ['creative'], depts: ['iv', 'foot'] }, b, '?d=foot')).json()).toEqual({ key: 'site/data/dept/foot.json' });
    expect(b.asked).not.toContain('site/data/all.json');
  });

  it('creative without analytics gets the creative copy (no organic, no Google)', async () => {
    const b = bucket(['site/data/c.json', 'site/data/all.json']);
    expect(await (await call({ dash: ['creative'] }, b)).json()).toEqual({ key: 'site/data/c.json' });
  });

  it('no analytics and no creative: refused before R2 is read', async () => {
    const b = bucket(['site/data/all.json']);
    const res = await call({ dash: ['control'] }, b);
    expect(res.status).toBe(403);
    expect(b.asked).toEqual([]);
  });

  it('another company never reads Well data', async () => {
    const b = bucket(['site/data/all.json']);
    const res = await call({ role: 'owner', co: OTHER }, b);
    expect(res.status).toBe(404);
    expect(b.asked).toEqual([`companies/${OTHER}/data/all.json`]);
    expect(dataKey(WELL_COMPANY, 'c.json')).toBe('site/data/c.json');
  });

  it('an unchanged copy is a 304', async () => {
    const b = bucket(['site/data/all.json']);
    const res = await call({ role: 'owner' }, b, '', { 'if-none-match': '"site/data/all.json"' });
    expect(res.status).toBe(304);
  });

  it('not signed in: 401', async () => {
    const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', SESSION_SECRET: SECRET, OWNER_EMAIL: 'leen@x.co' } as AuthEnv;
    const res = await api.request(`${ORIGIN}/api/dash/data`, {}, env);
    expect(res.status).toBe(401);
  });
});
