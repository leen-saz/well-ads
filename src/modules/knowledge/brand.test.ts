// Brand files: allowed types and sizes, keys per company, the approval rule, serving only this company's files,
// and the design module reading the active brand.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { brandFor, brandKey, checkFile, cleanColors } from './brand';
import { brand, brandcolors, brandfile, brandguide } from './routes';
import { guidePrompt, guideText, parseProposals } from './guide';
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
  return { store, put: vi.fn(async (k: string, v: ArrayBuffer) => { store.set(k, v); }), get: vi.fn(async (k: string) => (store.has(k) ? { body: new Blob([store.get(k)!]).stream(), arrayBuffer: async () => store.get(k)! } : null)), delete: vi.fn(async () => {}) };
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

describe('brand guide → knowledge', () => {
  it('keeps only valid proposals of the allowed kinds', () => {
    const p = parseProposals('هذي البنود: [{"kind":"voice","title":"النبرة","body":"ودود وواثق"},{"kind":"forbidden","body":"الأفضل"},{"kind":"service","body":"x"},{"kind":"voice","body":"ودود وواثق"},{"kind":"note","body":""}]');
    expect(p).toEqual([{ kind: 'voice', title: 'النبرة', body: 'ودود وواثق' }, { kind: 'forbidden', title: '', body: 'الأفضل' }]);
    expect(parseProposals('no json')).toEqual([]);
    expect(guidePrompt('x'.repeat(50000)).length).toBeLessThan(26000);
  });
  it('a PDF with no text says so', async () => {
    expect((await guideText(async () => ({ format: 'markdown', data: '  ' }), new ArrayBuffer(1))).error).toContain('ما فيه نص');
    expect((await guideText(async () => ({ format: 'error', error: 'x' }), new ArrayBuffer(1))).error).toBeTruthy();
    expect((await guideText(async () => { throw new Error('down'); }, new ArrayBuffer(1))).error).toContain('جرّب');
  });
  it('saves every proposal switched off, once per guide, for this company only', async () => {
    const ed = member({ knowledge: 'edit' });
    const FILES = bucket();
    FILES.store.set(`brand/${CO}/g.pdf`, new Uint8Array([37, 80, 68, 70]).buffer);
    const toMarkdown = vi.fn(async () => ({ format: 'markdown', data: 'دليل Well: نبرتنا ودودة. لا نستخدم كلمة الأفضل. ألواننا #1D1069.' }));
    const run = vi.fn(async () => ({ response: '[{"kind":"voice","title":"النبرة","body":"ودودة"},{"kind":"forbidden","title":"","body":"الأفضل"},{"kind":"note","title":"الألوان","body":"#1D1069"}]' }));
    const calls = stub(ed, url => (url.includes('/brand_assets') ? [{ id: 7, r2_key: `brand/${CO}/g.pdf` }] : url.includes('topic=eq.guide-7') ? [] : [{ id: 1 }, { id: 2 }, { id: 3 }]));
    const r = await brandguide.POST(req('/api/knowledge/brandguide', await cookieFor(ed), { method: 'POST', body: JSON.stringify({ id: 7 }) }), { ...E, FILES, AI: { run, toMarkdown } } as A.AuthEnv);
    expect(r.status).toBe(200);
    const saved = calls.find(c => c.method === 'POST' && c.url.endsWith('/knowledge'))?.body as unknown as Record<string, unknown>[];
    expect(saved).toHaveLength(3);
    for (const x of saved) expect(x).toMatchObject({ active: false, source: 'brand_file', topic: 'guide-7', company_id: CO });
    // read before: refused
    stub(ed, url => (url.includes('/brand_assets') ? [{ id: 7, r2_key: `brand/${CO}/g.pdf` }] : [{ id: 1 }]));
    expect((await brandguide.POST(req('/api/knowledge/brandguide', await cookieFor(ed), { method: 'POST', body: JSON.stringify({ id: 7 }) }), { ...E, FILES, AI: { run, toMarkdown } } as A.AuthEnv)).status).toBe(409);
    // a file of another company is not read
    stub(ed, url => (url.includes('/brand_assets') ? [{ id: 8, r2_key: 'brand/11111111-1111-1111-1111-111111111111/g.pdf' }] : []));
    expect((await brandguide.POST(req('/api/knowledge/brandguide', await cookieFor(ed), { method: 'POST', body: JSON.stringify({ id: 8 }) }), { ...E, FILES, AI: { run, toMarkdown } } as A.AuthEnv)).status).toBe(404);
  });
});

describe('brand files: guards', () => {
  it('reads a guide once even when two requests arrive together', async () => {
    const ed = member({ knowledge: 'edit' });
    const FILES = bucket();
    FILES.store.set(`brand/${CO}/g.pdf`, new Uint8Array([37, 80, 68, 70]).buffer);
    const toMarkdown = vi.fn(async () => ({ format: 'markdown', data: 'دليل Well: نبرتنا ودودة. لا نستخدم كلمة الأفضل. ألواننا #1D1069.' }));
    const run = vi.fn(async () => ({ response: '[{"kind":"voice","title":"النبرة","body":"ودودة"}]' }));
    // The other request holds the lock: the conditional update matches no row
    const calls = stub(ed, (url, init) => (url.includes('/brand_assets') && init.method === 'PATCH' ? [] : url.includes('/brand_assets') ? [{ id: 7, r2_key: `brand/${CO}/g.pdf` }] : []));
    const r = await brandguide.POST(req('/api/knowledge/brandguide', await cookieFor(ed), { method: 'POST', body: JSON.stringify({ id: 7 }) }), { ...E, FILES, AI: { run, toMarkdown } } as A.AuthEnv);
    expect(r.status).toBe(409);
    expect(calls.find(c => c.method === 'PATCH')?.url).toContain('or=(value.is.null,and(value.eq.reading,updated_at.lt.');
    expect(run).not.toHaveBeenCalled();
  });
  it('releases the lock when the reading fails', async () => {
    const ed = member({ knowledge: 'edit' });
    const FILES = bucket();
    FILES.store.set(`brand/${CO}/g.pdf`, new Uint8Array([37, 80, 68, 70]).buffer);
    const toMarkdown = vi.fn(async () => ({ format: 'markdown', data: ' ' }));
    const calls = stub(ed, url => (url.includes('/brand_assets') ? [{ id: 7, r2_key: `brand/${CO}/g.pdf` }] : []));
    const r = await brandguide.POST(req('/api/knowledge/brandguide', await cookieFor(ed), { method: 'POST', body: JSON.stringify({ id: 7 }) }), { ...E, FILES, AI: { run: vi.fn(), toMarkdown } } as A.AuthEnv);
    expect(r.status).toBe(422);
    expect(calls.filter(c => c.method === 'PATCH').map(c => c.body?.value)).toEqual(['reading', null]);
  });
  it('a rename without a name is refused, and colour codes only go on the colours entry', async () => {
    const ed = member({ knowledge: 'edit' });
    const calls = stub(ed, () => [{ id: 5, kind: 'colors', active: false }]);
    expect((await brand.PATCH(req('/api/knowledge/brand', await cookieFor(ed), { method: 'PATCH', body: JSON.stringify({ id: 5 }) }), E)).status).toBe(400);
    expect((await brand.PATCH(req('/api/knowledge/brand', await cookieFor(ed), { method: 'PATCH', body: JSON.stringify({ id: 5, title: '  ' }) }), E)).status).toBe(400);
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
    expect((await brand.PATCH(req('/api/knowledge/brand', await cookieFor(ed), { method: 'PATCH', body: JSON.stringify({ id: 5, value: '#1D1069' }) }), E)).status).toBe(200);
    expect(calls.find(c => c.method === 'PATCH')?.url).toContain('kind=eq.colors');
  });
});
