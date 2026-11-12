// URL → brief → script. The safe page reader (the SSRF rules), the text extraction, the brief and script cleaning,
// the compliance notices on a script (notices only: the text is never changed), and the routes. Synthetic pages only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { api } from '../../api/index';
import { WELL_COMPANY } from '../../lib/tenant';
import { cleanBrief, fallbackBrief, isEmpty, pageText } from './brief';
import { readPage, refuse } from './safe-fetch';
import { cleanScript, fitNote, notices, plan, scriptPrompt } from './script';

const html = (body: string, head = '') => `<!doctype html><html><head><title>فحص منزلي · عيادة تجريبية</title><meta name="description" content="فحص كامل في بيتك بدون انتظار">${head}</head><body><nav>القائمة</nav>${body}<script>var x = 'تعليمة'</script></body></html>`;
const page = (h: string, type = 'text/html; charset=utf-8', extra: ResponseInit = {}) => new Response(h, { headers: { 'content-type': type }, ...extra });
const asFetch = (f: unknown) => f as unknown as typeof fetch;

describe('which addresses may be read', () => {
  it.each([
    'http://example.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.5/a', 'https://192.168.1.1/a', 'https://172.16.0.1/a', 'https://169.254.169.254/latest/meta-data',
    'https://100.64.0.1/a', 'https://[::1]/a', 'https://[fd00::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://[::ffff:7f00:1]/a', 'https://2130706433/a', 'https://0x7f000001/a',
    'https://intranet/a', 'https://db.internal/a', 'https://printer.local/a', 'https://user:pass@example.com/a', 'https://example.com:8443/a', 'ftp://example.com/a', 'not a url', 'file:///etc/passwd', 'javascript:alert(1)',
  ])('refuses %s', u => { expect(refuse(u)).toMatch(/[؀-ۿ]/); });
  it.each(['https://example.com/a?b=1', 'https://shop.example.sa/service', 'https://example.com:443/x'])('allows %s', u => { expect(refuse(u)).toBeNull(); });
});

describe('reading a page', () => {
  it('reads an https page', async () => {
    const f = vi.fn(async () => page(html('<h1>فحص منزلي</h1>')));
    expect(await readPage('https://clinic.example/offer', asFetch(f))).toMatchObject({ ok: true, url: 'https://clinic.example/offer' });
  });
  it('follows a redirect, but checks every hop', async () => {
    const good = vi.fn(async (u: string) => u.endsWith('/a') ? new Response(null, { status: 302, headers: { location: '/b' } }) : page(html('<p>x</p>')));
    expect(await readPage('https://clinic.example/a', asFetch(good))).toMatchObject({ ok: true, url: 'https://clinic.example/b' });
    const evil = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }));
    expect((await readPage('https://clinic.example/a', asFetch(evil))).ok).toBe(false); expect(evil).toHaveBeenCalledTimes(1);   // the private hop was never requested
    const http = vi.fn(async () => new Response(null, { status: 301, headers: { location: 'http://clinic.example/a' } }));
    expect((await readPage('https://clinic.example/a', asFetch(http))).ok).toBe(false);
  });
  it('stops a redirect loop', async () => {
    const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } }));
    expect((await readPage('https://clinic.example/a', asFetch(loop))).ok).toBe(false);
    expect(loop.mock.calls.length).toBeLessThanOrEqual(4);
  });
  it('refuses what is not a text page, a failed page, and a page that is too big (declared or streamed)', async () => {
    expect((await readPage('https://x.example/a', asFetch(async () => page('{}', 'application/json')))).ok).toBe(false);
    expect((await readPage('https://x.example/a', asFetch(async () => page('x', 'application/pdf')))).ok).toBe(false);
    expect((await readPage('https://x.example/a', asFetch(async () => page('no', 'text/html', { status: 404 })))).ok).toBe(false);
    expect((await readPage('https://x.example/a', asFetch(async () => page('x', 'text/html', { headers: { 'content-type': 'text/html', 'content-length': '9000000' } })))).ok).toBe(false);
    const big = new ReadableStream({ start(c) { for (let i = 0; i < 20; i++) c.enqueue(new Uint8Array(100_000)); c.close(); } });
    expect((await readPage('https://x.example/a', asFetch(async () => new Response(big, { headers: { 'content-type': 'text/html' } })))).ok).toBe(false);
  });
  it('a dropped connection is a plain sentence', async () => {
    const r = await readPage('https://x.example/a', asFetch(async () => { throw new Error('boom'); }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/[؀-ۿ]/);
  });
  it('never calls the network for a refused address', async () => {
    const f = vi.fn();
    await readPage('https://127.0.0.1/a', asFetch(f)); await readPage('http://x.example', asFetch(f));
    expect(f).not.toHaveBeenCalled();
  });
});

describe('the brief', () => {
  it('reduces a page to its text without scripts or menus, and finds the price', () => {
    const t = pageText(html('<h1>فحص منزلي</h1><p>ممرض مرخّص يجيك البيت</p><ul><li>راحة</li></ul>', '<script type="application/ld+json">{"@type":"Product","offers":{"price":"199","priceCurrency":"SAR"}}</script>'));
    expect(t.text).toContain('ممرض مرخّص يجيك البيت'); expect(t.text).toContain('199 SAR');
    expect(t.text).not.toMatch(/تعليمة|القائمة|<script/);
    expect(t.title).toContain('فحص منزلي');
  });
  it('the answer is cleaned', () => {
    const b = cleanBrief({ service: ' فحص <b>منزلي</b> ', offer: 'x'.repeat(900), benefits: ['أ', 'ب', '', 'ج', 'د', 'هـ', 'و', 'ز'], price: 99, audience: null, extra: 'ignored' });
    expect(b.service).toBe('فحص منزلي'); expect(b.offer.length).toBeLessThanOrEqual(300); expect(b.benefits).toHaveLength(6); expect(b.price).toBe('99');
    expect(isEmpty(cleanBrief({}))).toBe(true); expect(isEmpty(cleanBrief(null))).toBe(true);
    expect(fallbackBrief({ title: 'عنوان', description: 'وصف' })).toMatchObject({ service: 'عنوان', offer: 'وصف' });
  });
});

describe('the script', () => {
  it('plans clip lengths that add up to the ad length', () => { for (const s of [15, 30, 60]) expect(plan(s, [5, 10]).reduce((a, b) => a + b, 0)).toBe(s); });
  it('asks for one shot per clip, in Saudi Arabic, with the facts and the size', () => {
    const txt = scriptPrompt({ brief: cleanBrief({ service: 'فحص منزلي', offer: 'في بيتك', benefits: ['راحة'], price: '199 ريال' }), seconds: 30, ratio: '9:16', clips: [10, 10, 10] }).map(x => x.content).join('\n');
    expect(txt).toContain('سعودية'); expect(txt).toContain('199 ريال'); expect(txt).toContain('9:16'); expect(txt).toContain('3 لقطات'); expect(txt).toContain('الأفضل');
  });
  it('fixes the shot lengths to the plan, drops extra shots, and never keeps markup', () => {
    const s = cleanScript({ shots: [{ line: 'أول <b>جملة</b>', prompt: 'p1', seconds: 99 }, { line: 'ثانية', prompt: 'p2' }, { line: 'زيادة', prompt: 'p3' }], cta: 'احجز الحين' }, [10, 5])!;
    expect(s.shots.map(x => x.seconds)).toEqual([10, 5]); expect(s.shots).toHaveLength(2); expect(s.shots[0]!.line).toBe('أول جملة');
    expect(s.voiceover).toBe('أول جملة ثانية'); expect(cleanScript({ shots: [] }, [5])).toBeNull(); expect(cleanScript('x', [5])).toBeNull();
  });
  it('shows compliance notices and leaves the text exactly as written', () => {
    const s = cleanScript({ shots: [{ line: 'علاج نهائي مضمون 100% لكل الأمراض', scene: 'مشهد', prompt: 'p' }], cta: 'احجز' }, [5])!;
    const before = JSON.stringify(s), n = notices(s);
    expect(n.length).toBeGreaterThan(0); expect(n[0]).toMatchObject({ where: 'لقطة 1' }); expect(n[0]!.fix).toMatch(/[؀-ۿ]/);
    expect(JSON.stringify(s)).toBe(before);
    expect(notices(cleanScript({ shots: [{ line: 'نخدمك في بيتك', prompt: 'p' }] }, [5])!)).toEqual([]);
  });
  it('says when the voiceover is too long for the ad', () => {
    expect(fitNote(cleanScript({ shots: [{ line: 'كلمة '.repeat(80), prompt: 'p' }] }, [5])!, 15)).toMatch(/اختصره/);
    expect(fitNote(cleanScript({ shots: [{ line: 'جملة قصيرة', prompt: 'p' }] }, [5])!, 15)).toBe('');
  });
});

// ---- the routes
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com', OPENAI_API_KEY: 'k-test', HIGGSFIELD_API_KEY: 'a', HIGGSFIELD_API_SECRET: 'b' };
const cfg = A.env(E);
const owner = { id: '33333333-3333-3333-3333-333333333333', email: 'boss@example.com', role: 'owner', active: true, access: { video: 'approve' }, company_id: WELL_COMPANY } as A.Profile;
let project: Record<string, unknown>, patched: Record<string, unknown>[], jobsInserted: unknown[], activeJobs: boolean, anyJobs: boolean, llm: string, fetched: string[];
const base = () => ({ id: 9, title: 't', ratio: '9:16', seconds: 15, avatar_id: '', review_status: 'draft', source_url: '', brief: { service: 'فحص منزلي', offer: 'في بيتك', benefits: ['راحة'] }, script: {} });
function world() {
  project = base(); patched = []; jobsInserted = []; activeJobs = false; anyJobs = false; fetched = [];
  llm = JSON.stringify({ shots: [{ scene: 'ممرض يدخل', line: 'فحص في بيتك', onScreen: '', prompt: 'a nurse at a door' }, { scene: 'ابتسامة', line: 'احجز الحين', onScreen: 'احجز', prompt: 'a smile' }], cta: 'احجز' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    fetched.push(url);
    const m = init.method || 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([owner]));
    if (url.startsWith('https://clinic.example')) return page(html('<h1>فحص منزلي</h1><p>ممرض مرخّص يجيك البيت بدون انتظار وبسعر واضح للجميع</p>'));
    if (url.includes('api.openai.com')) return new Response(JSON.stringify({ output_text: llm, usage: { input_tokens: 10, output_tokens: 10 } }));
    if (url.includes('/video_projects')) { if (m === 'PATCH') { patched.push(body); project = { ...project, ...body }; } return new Response(JSON.stringify([project])); }
    if (url.includes('/video_jobs')) {
      if (m === 'POST') { jobsInserted = body; return new Response(JSON.stringify((body as unknown[]).map((b, i) => ({ id: i + 1, ...(b as object) })))); }
      return new Response(JSON.stringify(url.includes('status=in.') ? (activeJobs ? [{ id: 1 }] : []) : anyJobs ? [{ id: 1 }] : []));
    }
    return new Response('[]');
  }));
}
type Rsp = { error?: string; brief?: Record<string, unknown>; notices?: unknown[]; from?: string };
async function call(path: string, method: string, body?: unknown, p: A.Profile = owner, e: Record<string, unknown> = E) {
  const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
  const res = await api.request('https://well.example' + path, { method, headers: { origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie }, ...(body ? { body: JSON.stringify(body) } : {}) }, e);
  return { status: res.status, body: await res.json() as Rsp };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('routes', () => {
  it('a private address is refused before any request leaves', async () => {
    world();
    for (const u of ['https://169.254.169.254/latest/meta-data', 'http://clinic.example', 'https://localhost/a']) {
      const r = await call('/api/video/brief', 'POST', { url: u });
      expect(r.status).toBe(400); expect(r.body.error).toMatch(/[؀-ۿ]/);
    }
    expect(fetched.filter(u => !u.includes('sb.example'))).toEqual([]);
  });
  it('a page becomes an editable brief, saved on the project', async () => {
    world();
    llm = JSON.stringify({ service: 'فحص منزلي', offer: 'ممرض مرخّص يجيك', benefits: ['بدون انتظار'], price: '', audience: '', cta: 'احجز' });
    const r = await call('/api/video/brief', 'POST', { url: 'https://clinic.example/offer', project: 9 });
    expect(r.status).toBe(200); expect(r.body.from).toBe('model'); expect(r.body.brief).toMatchObject({ service: 'فحص منزلي' });
    expect(patched[0]).toMatchObject({ source_url: 'https://clinic.example/offer', brief: { service: 'فحص منزلي' } });
  });
  it('without a model the page title and description are the start', async () => {
    world();
    const r = await call('/api/video/brief', 'POST', { url: 'https://clinic.example/offer' }, owner, { ...E, OPENAI_API_KEY: '' });
    expect(r.body.from).toBe('page'); expect(r.body.brief).toMatchObject({ service: expect.stringContaining('فحص منزلي') });
  });
  it('the script is saved with its notices; a script that cannot be read is an error, nothing saved', async () => {
    world();
    llm = JSON.stringify({ shots: [{ scene: 'م', line: 'علاج نهائي مضمون 100%', prompt: 'p' }], cta: 'احجز' });
    const r = await call('/api/video/script', 'POST', { id: 9 });
    expect(r.status).toBe(200); expect((r.body.notices as unknown[]).length).toBeGreaterThan(0);
    expect((patched[0] as { script: { shots: { line: string }[] } }).script.shots[0]!.line).toContain('علاج نهائي مضمون');
    world(); llm = 'not json';
    expect((await call('/api/video/script', 'POST', { id: 9 })).status).toBe(502); expect(patched).toHaveLength(0);
  });
  it('a project in review cannot be edited or rewritten', async () => {
    world(); project.review_status = 'in_review';
    for (const [path, m, b] of [['/api/video/script', 'POST', { id: 9 }], ['/api/video/projects', 'PATCH', { id: 9, title: 'x' }], ['/api/video/render', 'POST', { id: 9 }]] as const) expect((await call(path, m, b)).status).toBe(409);
    expect(patched).toHaveLength(0);
  });
  it('the render makes one clip per shot with the project size, and not while clips are still being made', async () => {
    world(); project.script = cleanScript(JSON.parse(llm), [10, 5]);
    expect((await call('/api/video/render', 'POST', { id: 9 })).status).toBe(200); expect(jobsInserted).toHaveLength(2);
    expect((jobsInserted[0] as { params: Record<string, unknown> }).params).toMatchObject({ kind: 'text-to-video', ratio: '9:16', seconds: 10, prompt: 'a nurse at a door' });
    world(); project.script = cleanScript(JSON.parse(llm), [10, 5]); activeJobs = true;
    expect((await call('/api/video/render', 'POST', { id: 9 })).status).toBe(409);
  });
  it('an avatar video needs its voice file and says the line, not the scene', async () => {
    world(); project.avatar_id = 'presenter'; project.script = cleanScript(JSON.parse(llm), [10, 5]);
    expect((await call('/api/video/render', 'POST', { id: 9 })).status).toBe(400);
    (project.script as Record<string, unknown>).voice_url = 'https://files.example/voice.mp3';
    expect((await call('/api/video/render', 'POST', { id: 9 })).status).toBe(200);
    expect((jobsInserted[0] as { params: Record<string, unknown> }).params).toMatchObject({ kind: 'avatar', prompt: 'فحص في بيتك', voiceUrl: 'https://files.example/voice.mp3' });
  });
  it('size, length and avatar are fixed once shots exist', async () => {
    world(); anyJobs = true;
    expect((await call('/api/video/projects', 'PATCH', { id: 9, ratio: '1:1' })).status).toBe(409);
    world();
    expect((await call('/api/video/projects', 'PATCH', { id: 9, ratio: '1:1', seconds: 30 })).status).toBe(200);
    expect(patched[0]).toMatchObject({ ratio: '1:1', seconds: 30 });
    expect((await call('/api/video/projects', 'PATCH', { id: 9, ratio: '4:5' })).status).toBe(400);
  });
  it('a hand-edited script is cleaned and keeps the planned lengths', async () => {
    world();
    expect((await call('/api/video/projects', 'PATCH', { id: 9, script: { shots: [{ line: 'نص <i>معدّل</i>', prompt: 'p' }, { line: 'ثاني', prompt: 'q' }] } })).status).toBe(200);
    const sc = (patched[0] as { script: { shots: { seconds: number; line: string }[] } }).script;
    expect(sc.shots.map(s => s.seconds)).toEqual([10, 5]); expect(sc.shots[0]!.line).toBe('نص معدّل');
  });
});
