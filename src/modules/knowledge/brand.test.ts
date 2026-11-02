// Brand files: allowed types and sizes, keys per company, the approval rule, serving only this company's files,
// and the design module reading the active brand.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { brandFor, brandKey, checkFile, cleanColors } from './brand';
import { brand, brandcolors, brandfile } from './routes';
import { brandfile as designFile, options } from '../design/routes';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const CO = '00000000-0000-0000-0000-000000000001';
const member = (access: Record<string, string>): A.Profile => ({ id: '22222222-2222-2222-2222-222222222222', email: 'm@example.com', role: 'member', active: true, access });
const cookieFor = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const req = (path: string, cookie: string, init: RequestInit = {}) => new Request('https://well.example' + path,
  { ...init, headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', ...(init.headers as Record<string, string> || {}) } });
const stub = (p: A.Profile, rest: (url: string, init: RequestInit) => unknown = () => []) => {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(url.includes('/profiles?id=eq.' + p.id) ? [p] : rest(url, init)));
  }));
  return calls;
};
const bucket = () => {
  const store = new Map<string, ArrayBuffer>();
  return { store, put: vi.fn(async (k: string, v: ArrayBuffer) => { store.set(k, v); }), get: vi.fn(async (k: string) => (store.has(k) ? { body: new Blob([store.get(k)!]).stream() } : null)), delete: vi.fn(async () => {}) };
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('brand files', () => {
  it('allows only the right types and sizes per kind', () => {
    expect(checkFile('logo', 'image/svg+xml', 1000).ext).toBe('svg');
    expect(checkFile('guide', 'application/pdf', 5_000_000).ext).toBe('pdf');
    expect(checkFile('font', 'font/woff2', 100).ext).toBe('woff2');
    expect(checkFile('guide', 'image/png', 10).error).toContain('مو مسموحة');
    expect(checkFile('reference', 'text/html', 10).error).toBeTruthy();
    expect(checkFile('logo', 'image/png', 3 * 1024 * 1024).error).toContain('2 ميقا');
    expect(checkFile('colors', 'image/png', 10).error).toBe('نوع غير معروف');
    expect(checkFile('logo', 'image/png', 0).error).toBe('الملف فاضي');
  });
  it('keeps each company in its own folder and reads colours as hex', () => {
    expect(brandKey(CO, 'png', () => 'abc')).toBe(`brand/${CO}/abc.png`);
    expect(() => brandKey('../x', 'png')).toThrow();
    expect(cleanColors('#1D1069، 7e57fd and #FFF, nope, #1d1069')).toEqual(['#1d1069', '#7e57fd', '#ffffff']);
  });

  it('an editor uploads switched off; only an approver switches it on', async () => {
    const ed = member({ knowledge: 'edit' });
    const calls = stub(ed, () => [{ id: 5, kind: 'logo', active: false }]);
    const FILES = bucket();
    const r = await brandfile.POST(req('/api/knowledge/brandfile?kind=logo&title=الشعار', await cookieFor(ed), { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array([1, 2, 3]) }), { ...E, FILES } as A.AuthEnv);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { pending: boolean }).pending).toBe(true);
    const [key] = [...FILES.store.keys()];
    expect(key).toMatch(new RegExp(`^brand/${CO}/[0-9a-f]{32}\\.png$`));
    expect(calls.find(c => c.method === 'POST' && c.url.endsWith('/brand_assets'))?.body).toMatchObject({ kind: 'logo', r2_key: key, mime: 'image/png', size: 3, active: false, company_id: CO });
    expect((await brand.PATCH(req('/api/knowledge/brand', await cookieFor(ed), { method: 'PATCH', body: JSON.stringify({ id: 5, active: true }) }), E)).status).toBe(403);
    // wrong type for the kind
    const bad = await brandfile.POST(req('/api/knowledge/brandfile?kind=guide', await cookieFor(ed), { method: 'POST', headers: { 'content-type': 'text/html' }, body: '<script>' }), { ...E, FILES } as A.AuthEnv);
    expect(bad.status).toBe(415);

    const ap = member({ knowledge: 'approve' });
    const c2 = stub(ap, () => [{ id: 5, kind: 'logo', active: true }]);
    expect((await brand.PATCH(req('/api/knowledge/brand', await cookieFor(ap), { method: 'PATCH', body: JSON.stringify({ id: 5, active: true }) }), E)).status).toBe(200);
    expect(c2.find(c => c.method === 'PATCH')?.url).toContain(`company_id=eq.${CO}`);
    const col = await brandcolors.POST(req('/api/knowledge/brandcolors', await cookieFor(ap), { method: 'POST', body: JSON.stringify({ colors: '#1D1069 #7E57FD' }) }), E);
    expect(((await col.json()) as { pending: boolean }).pending).toBe(false);
  });

  it("serves only this company's files, and design sees only active ones", async () => {
    const v = member({ knowledge: 'view', design: 'view' });
    const FILES = bucket();
    FILES.store.set(`brand/${CO}/a.png`, new Uint8Array([9]).buffer);
    let calls = stub(v, () => [{ id: 1, kind: 'logo', r2_key: `brand/${CO}/a.png`, mime: 'image/svg+xml' }]);
    const r = await brandfile.GET(req('/api/knowledge/brandfile?id=1', await cookieFor(v)), { ...E, FILES } as A.AuthEnv);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toContain('sandbox');
    expect(calls.find(c => c.url.includes('/brand_assets'))?.url).toContain(`company_id=eq.${CO}`);
    // a key from another company is never served, even if a row points at it
    stub(v, () => [{ id: 2, kind: 'logo', r2_key: 'brand/11111111-1111-1111-1111-111111111111/b.png', mime: 'image/png' }]);
    expect((await brandfile.GET(req('/api/knowledge/brandfile?id=2', await cookieFor(v)), { ...E, FILES } as A.AuthEnv)).status).toBe(404);
    calls = stub(v, () => []);
    await designFile.GET(req('/api/design/brandfile?id=1', await cookieFor(v)), { ...E, FILES } as A.AuthEnv);
    expect(calls.find(c => c.url.includes('/brand_assets'))?.url).toContain('active=is.true');
  });

  it('design options carry the active brand', async () => {
    const v = member({ design: 'view' });
    stub(v, url => (url.includes('/brand_assets') ? [
      { id: 1, kind: 'colors', title: '', value: '#1d1069 #7e57fd', description: null },
      { id: 2, kind: 'logo', title: 'شعار', value: null, description: null },
      { id: 3, kind: 'reference', title: '', value: null, description: 'صورة ممرضة في بيت بألوان بنفسجية' },
      { id: 4, kind: 'font', title: 'Thmanyah', value: null, description: null },
    ] : []));
    const o = (await (await options.GET(req('/api/design/options', await cookieFor(v)), E)).json()) as { brand: Awaited<ReturnType<typeof brandFor>> };
    expect(o.brand).toEqual({ colors: ['#1d1069', '#7e57fd'], logo: 2, fonts: [{ id: 4, title: 'Thmanyah' }], refs: [{ id: 3, description: 'صورة ممرضة في بيت بألوان بنفسجية' }], notes: ['صورة ممرضة في بيت بألوان بنفسجية'] });
  });
  it('no table yet = no brand, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"relation does not exist"}', { status: 404 })));
    expect(await brandFor(cfg, CO)).toEqual({ colors: [], logo: null, fonts: [], refs: [], notes: [] });
  });
});
