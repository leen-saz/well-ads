// Vision: upload rules, the reading of the answer, the compliance notes, the cache by hash, cost and cap, saving to the library,
// permissions and company isolation, and that the module starts locked. Fake Supabase and Gemini, synthetic images and people.
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { need } from '../../lib/gate';
import { clearSnaps, withWaiter } from '../../lib/usage';
import { MAX_DATA, cleanUpload, libraryDoc, parseResult, sayings, view, type Result, type Row } from './vision';
import { ROUTES } from '../routes';
import { LIVE } from '../registry';
import migration from '../../../supabase/migrations/024_vision.sql?raw';

const CO_A = '11111111-1111-1111-1111-111111111111', CO_B = '22222222-2222-2222-2222-222222222222';
const E: A.AuthEnv & { GEMINI_API_KEY?: string } = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com' };
const cfg = A.env(E);
const P = (n: number, email: string, co: string, access: Record<string, string>, role = 'member'): A.Profile => ({ id: `00000000-0000-0000-0000-00000000000${n}`, email, role, active: true, access, company_id: co } as A.Profile);
const owner = P(1, 'boss@example.com', CO_A, {}, 'owner');
const writer = P(2, 'w@example.com', CO_A, { vision: 'edit' });
const viewer = P(3, 'v@example.com', CO_A, { vision: 'view' });
const other = P(4, 'x@example.com', CO_B, { vision: 'edit' });
const PROFILES = [owner, writer, viewer, other];
const HASH = 'a'.repeat(64), HASH2 = 'b'.repeat(64);

const ANSWER: Result = { description: 'إعلان لخدمة المحاليل الوريدية في البيت، ممرضة تبتسم قدام باب بيت.', alt: 'ممرضة تقف قدام باب بيت وتبتسم', text: 'علاج نهائي ومضمون\nاحجز الحين', offer: 'خصم 20% على أول زيارة', hook: 'علاج نهائي ومضمون', cta: 'احجز الحين', people: true };

type Row2 = Record<string, unknown> & { id: number; company_id: string };
let analyses: Row2[], libs: Row2[], audits: { action: string }[], usage: Record<string, unknown>[], geminiCalls: Record<string, any>[], capRows: unknown[], spendRows: unknown[], answer: string | null, nextId: number; // eslint-disable-line @typescript-eslint/no-explicit-any
const eq = (v: string | null) => (v?.startsWith('eq.') ? v.slice(3) : null);

beforeEach(() => {
  analyses = []; libs = []; audits = []; usage = []; geminiCalls = []; capRows = []; spendRows = []; answer = JSON.stringify(ANSWER); nextId = 1; clearSnaps(); E.GEMINI_API_KEY = 'k';
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init: RequestInit = {}) => {
    const u = new URL(String(input)), m = init.method || 'GET', body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const ok = (d: unknown) => new Response(JSON.stringify(d));
    if (u.host === 'generativelanguage.googleapis.com') {
      geminiCalls.push(body);
      if (answer === null) return new Response('{"error":"SECRET-IMAGE-ECHO"}', { status: 500 });
      return ok({ candidates: [{ content: { parts: [{ text: answer }] } }], usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 150, promptTokensDetails: [{ modality: 'IMAGE', tokenCount: 500 }, { modality: 'TEXT', tokenCount: 200 }] } });
    }
    if (u.pathname.endsWith('/profiles')) return ok(PROFILES.filter(p => p.id === eq(u.searchParams.get('id'))));
    if (u.pathname.endsWith('/audit_log')) { audits.push(body); return ok([]); }
    if (u.pathname.endsWith('/ai_usage')) { usage.push(body); return ok([]); }
    if (u.pathname.endsWith('/rpc/ai_spend')) return ok(spendRows);
    if (u.pathname.endsWith('/ai_budgets')) return ok(capRows);
    if (u.pathname.endsWith('/library_items') && m === 'POST') { const row = { ...body, id: 700 + libs.length }; libs.push(row); return ok([row]); }
    if (u.pathname.endsWith('/vision_analyses')) {
      const q = u.searchParams;
      const hit = () => analyses.filter(a => a.company_id === eq(q.get('company_id')) && (!eq(q.get('id')) || String(a.id) === eq(q.get('id'))) && (!eq(q.get('file_hash')) || a.file_hash === eq(q.get('file_hash'))));
      if (m === 'POST') { const row = { library_id: null, created_at: '2026-11-08T09:00:00Z', ...body, id: nextId++ }; analyses.push(row); return ok([row]); }
      if (m === 'PATCH') { const h = hit(); h.forEach(a => Object.assign(a, body)); return ok(h); }
      return ok(hit());
    }
    return ok([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const call = async (h: (r: Request, e: typeof E) => Response | Promise<Response>, who: A.Profile, body?: unknown, path = '/api/vision/recent') => {
  const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(who, cfg), cfg.secret))}`;
  const jobs: Promise<unknown>[] = [];
  const res = await withWaiter(p => jobs.push(p), async () => h(new Request('https://well.example' + path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } }), E));
  await Promise.all(jobs);
  return res;
};
const V = ROUTES.vision;
const send = (who: A.Profile, x: Record<string, unknown> = {}) => call(V.describe.POST, who, { title: 'إعلان تجريبي', mime: 'image/jpeg', data: 'QUJD', hash: HASH, ...x }, '/api/vision/describe');
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('the upload and the answer', () => {
  it('accepts the three image types, a 64-hex hash and a small body; refuses the rest in plain words', () => {
    expect(cleanUpload({ title: '  إعلان   تجريبي ', mime: 'IMAGE/PNG', data: 'QUJD', hash: HASH })).toEqual({ title: 'إعلان تجريبي', mime: 'image/png', data: 'QUJD', hash: HASH });
    expect(cleanUpload({ mime: 'image/jpeg', data: 'x', hash: HASH })).toMatchObject({ title: 'صورة بدون عنوان' });
    expect(cleanUpload({ mime: 'image/gif', data: 'x', hash: HASH })).toMatchObject({ error: expect.stringContaining('مو مدعومة') });
    expect(cleanUpload({ mime: 'image/png', data: '', hash: HASH })).toMatchObject({ error: 'ما وصلت الصورة' });
    expect(cleanUpload({ mime: 'image/png', data: 'x'.repeat(MAX_DATA + 1), hash: HASH })).toMatchObject({ error: expect.stringContaining('صغّرها') });
    expect(cleanUpload({ mime: 'image/png', data: 'x', hash: 'zz' })).toMatchObject({ error: expect.any(String) });
  });
  it('reads the JSON with text around it, keeps the lines of the text inside the image, and cuts the alt text to 125 characters', () => {
    const r = parseResult('تفضل: ' + JSON.stringify({ ...ANSWER, alt: 'ن'.repeat(300), text: '  سطر أول  \n\n  سطر   ثاني \n' }));
    expect(r!.text).toBe('سطر أول\nسطر ثاني');
    expect(r!.alt.length).toBe(125);
    expect(r).toMatchObject({ people: true, hook: 'علاج نهائي ومضمون' });
    expect(parseResult(JSON.stringify({ ...ANSWER, people: 'yes' }))!.people).toBe(false);
  });
  it('is null without a description or without JSON', () => {
    expect(parseResult('لا شي')).toBeNull();
    expect(parseResult('{"description": ""}')).toBeNull();
    expect(parseResult('{broken')).toBeNull();
  });
  it('the compliance text is everything the image says; the library draft holds it all', () => {
    expect(sayings(ANSWER)).toContain('خصم 20%'); expect(sayings(ANSWER)).not.toContain('ممرضة');
    const d = libraryDoc('إعلان', ANSWER);
    for (const part of ['الوصف', 'النص البديل', 'النص داخل الصورة', 'العرض', 'الهوك', 'الدعوة', 'احجز الحين']) expect(d).toContain(part);
    expect(libraryDoc('إعلان', { ...ANSWER, text: '', offer: '', hook: '', cta: '' })).not.toContain('النص داخل الصورة');
  });
});

describe('describing an image', () => {
  it('sends the image and the prompt once, keeps the Arabic text as written, and checks it with the shared compliance rules', async () => {
    const r = await send(writer);
    expect(r.status).toBe(200);
    const { item, cached } = await json(r);
    expect(cached).toBe(false);
    expect(item.result.text).toBe('علاج نهائي ومضمون\nاحجز الحين');
    expect(item.compliance.map((h: { rule: string }) => h.rule)).toEqual(expect.arrayContaining(['cure', 'guarantee']));
    expect(geminiCalls).toHaveLength(1);
    const parts = geminiCalls[0]!.contents[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
    expect(parts[1].text).toContain('JSON');
    expect(geminiCalls[0]!.generationConfig.responseMimeType).toBe('application/json');
    expect(analyses[0]).toMatchObject({ company_id: CO_A, file_hash: HASH, created_by: 'w@example.com', created_by_id: writer.id });
    expect(JSON.stringify(analyses[0])).not.toContain('QUJD');   // the image itself is never stored
    expect(audits.map(a => a.action)).toEqual(['vision_described']);
  });
  it('records the call to the vision tab with the image tokens', async () => {
    await send(writer);
    expect(usage).toMatchObject([{ company_id: CO_A, user_id: writer.id, module: 'vision', provider: 'gemini', tokens_in: 700, tokens_out: 150, priced: true }]);
    expect(JSON.stringify(usage)).not.toContain('QUJD');
  });
  it('the same image again is answered from the store: no second call, no second cost', async () => {
    await send(writer);
    const again = await json(await send(writer, { title: 'غير' }));
    expect(again.cached).toBe(true); expect(again.item.title).toBe('إعلان تجريبي');
    expect(geminiCalls).toHaveLength(1); expect(usage).toHaveLength(1); expect(analyses).toHaveLength(1);
    await send(writer, { hash: HASH2 });
    expect(geminiCalls).toHaveLength(2);
  });
  it('another company never gets this company\'s cached answer', async () => {
    await send(writer);
    const r = await json(await send(other));
    expect(r.cached).toBe(false);
    expect(geminiCalls).toHaveLength(2);
    expect(analyses.map(a => a.company_id)).toEqual([CO_A, CO_B]);
  });
  it('refuses a viewer, a missing key (plain words, before any call), a bad body, and a spent tab (before any call)', async () => {
    expect((await send(viewer)).status).toBe(403);
    delete E.GEMINI_API_KEY;
    const nokey = await send(writer); expect(nokey.status).toBe(503); expect((await json(nokey)).error).toBe('ما اكتمل تجهيزه، بلّغ الإدارة');
    expect((await json(await call(V.recent.GET, owner))).why).toContain('GEMINI_API_KEY');
    E.GEMINI_API_KEY = 'k';
    expect((await send(writer, { mime: 'application/pdf' })).status).toBe(400);
    capRows = [{ module: 'vision', monthly_cap_usd: 1 }]; spendRows = [{ module: 'vision', cost_usd: 3 }];
    const spent = await send(writer); expect(spent.status).toBe(429); expect((await json(spent)).error).toBe('وصل الصرف الشهري لهالتاب، بلّغ الإدارة');
    expect(geminiCalls).toHaveLength(0);
  });
  it('a provider failure or an unreadable answer is said in plain words, nothing technical, and nothing is stored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    answer = null;
    const down = await send(writer); expect(down.status).toBe(502); expect((await json(down)).error).toBe('الخدمة ما ردت، جرّب بعد شوي');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-IMAGE-ECHO');
    answer = 'مو JSON';
    const bad = await send(writer, { hash: HASH2 }); expect(bad.status).toBe(502); expect((await json(bad)).error).toBe('ما قدرنا نقرا الصورة، جرّب صورة أوضح');
    expect(analyses).toEqual([]);
    warn.mockRestore();
  });
});

describe('the list and saving to the library', () => {
  it('lists the company\'s own analyses, with the result and the notices, and no hash or storage detail', async () => {
    await send(writer); await send(other, { hash: HASH2 });
    const l = await json(await call(V.recent.GET, viewer));
    expect(l.items).toHaveLength(1);
    expect(l.items[0]).toMatchObject({ title: 'إعلان تجريبي', result: { alt: 'ممرضة تقف قدام باب بيت وتبتسم' }, library_id: null });
    expect(JSON.stringify(l)).not.toMatch(/file_hash|company_id|created_by/);
    expect(view(analyses[0] as unknown as Row)).not.toHaveProperty('file_hash');
  });
  it('saves a draft to the library with the compliance result, once, and audits it; another company cannot save it', async () => {
    const { item } = await json(await send(writer));
    expect((await call(V.save.POST, other, { id: item.id }, '/api/vision/save')).status).toBe(404);
    expect((await call(V.save.POST, viewer, { id: item.id }, '/api/vision/save')).status).toBe(403);
    const r = await json(await call(V.save.POST, writer, { id: item.id }, '/api/vision/save'));
    expect(r).toMatchObject({ ok: true, library_id: 700 });
    expect(libs[0]).toMatchObject({ company_id: CO_A, module: 'vision', kind: 'design', created_by: 'w@example.com' });
    expect(String(libs[0]!.content)).toContain('الوصف');
    expect((libs[0]!.compliance_result as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
    expect(analyses[0]!.library_id).toBe(700);
    expect(audits.map(a => a.action)).toEqual(['vision_described', 'vision_saved']);
    expect((await json(await call(V.save.POST, writer, { id: item.id }, '/api/vision/save'))).library_id).toBe(700);
    expect(libs).toHaveLength(1);
  });
});

describe('the module starts locked', () => {
  it('is live, in the registry and the gate, and its migration locks it for every company and keeps the image out of the table', () => {
    expect(LIVE).toContain('vision');
    expect(need('/vision/', '')).toBe('vision'); expect(need('/api/vision/describe', '')).toBe('vision');
    expect(migration).toMatch(/array_append\(disabled_modules, 'vision'\)/); expect(migration).not.toMatch(/where id =/);
    expect(migration).toMatch(/enable row level security/); expect(migration).toMatch(/revoke all on public\.vision_analyses from anon, authenticated/);
    expect(migration).not.toMatch(/\b(image|data|bytes|r2_key)\b\s+(text|bytea|bigint)/);
    expect(migration).toMatch(/unique \(company_id, file_hash\)/);
  });
  it('a company that has it locked gets 403 even for the owner', async () => {
    const locked = { ...owner, id: '00000000-0000-0000-0000-000000000009', company: { disabled_modules: ['vision'] } } as A.Profile;
    PROFILES.push(locked);
    const r = await call(V.recent.GET, locked);
    PROFILES.pop();
    expect(r.status).toBe(403); expect((await json(r)).error).toBe(A.LOCKED);
  });
});
