// Transcribe: the upload rules, the windows, the prompts and the reading of the summary, the Gemini adapter (body, usage, cost, errors,
// the Files API), a whole job stepped to the end with fakes (Supabase, R2, Gemini), failures and retries, the routes' permissions and
// company isolation, and the cron. Synthetic data only: fake companies, users, speech and numbers.
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { need } from '../../lib/gate';
import { clearSnaps, cost, withWaiter } from '../../lib/usage';
import { GeminiError, deleteFile, fileState, gemini, geminiBody, notReady, uploadFile } from '../../lib/llm';
import { MAX_BYTES, cleanUpload, libraryDoc, parseSummary, personalNotes, stepsFor, view, windowPrompt, windows, type Job } from './transcribe';
import { acquire, runTranscribe, stepJob } from './service';
import { ROUTES } from '../routes';
import { LIVE } from '../registry';
import migration from '../../../supabase/migrations/023_transcribe.sql?raw';

const CO_A = '11111111-1111-1111-1111-111111111111', CO_B = '22222222-2222-2222-2222-222222222222';
const E: A.AuthEnv & { GEMINI_API_KEY?: string; FILES?: R2Bucket } = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com' };
const cfg = A.env(E);
const P = (n: number, email: string, co: string, access: Record<string, string>, role = 'member'): A.Profile => ({ id: `00000000-0000-0000-0000-00000000000${n}`, email, role, active: true, access, company_id: co } as A.Profile);
const owner = P(1, 'boss@example.com', CO_A, {}, 'owner');
const writer = P(2, 'w@example.com', CO_A, { transcribe: 'edit' });
const viewer = P(3, 'v@example.com', CO_A, { transcribe: 'view' });
const other = P(4, 'x@example.com', CO_B, { transcribe: 'edit' });
const PROFILES = [owner, writer, viewer, other];

// ---- fakes
type Row = Record<string, unknown> & { id: number; company_id: string };
let jobsDb: Row[], libs: Row[], audits: { action: string; target?: unknown }[], usage: Record<string, unknown>[], r2: Map<string, number>, r2Deleted: string[];
let geminiCalls: { url: string; body?: Record<string, unknown> }[], fileDeleted: string[], fileStates: string[], genFail: number[], nextId: number, capRows: { module: string; monthly_cap_usd: number }[], spendRows: { module: string; cost_usd: number }[];
const TRANSCRIPT = (from: string) => `[${from}] أهلاً وسهلاً فيكم في اجتماع اليوم\n[${from}] نبدأ بموضوع الحجوزات`;
const SUMMARY = JSON.stringify({ summary: 'اجتماع قصير عن الحجوزات.', hook: 'أهلاً وسهلاً', offer: 'خصم الخريف', actions: [{ task: 'نراجع الحجوزات', owner: 'سارة', due: 'الأحد' }] });
const eq = (v: string | null) => (v?.startsWith('eq.') ? v.slice(3) : null);

function fakeR2(): R2Bucket {
  return {
    async put(key: string, body: ReadableStream<Uint8Array>) { let n = 0; const r = body.getReader(); for (;;) { const { done, value } = await r.read(); if (done) break; n += value.length; } r2.set(key, n); return { size: n }; },
    async get(key: string) { return r2.has(key) ? { body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(r2.get(key)!)); c.close(); } }) } : null; },
    async delete(key: string) { r2Deleted.push(key); r2.delete(key); },
  } as unknown as R2Bucket;
}

beforeEach(() => {
  jobsDb = []; libs = []; audits = []; usage = []; r2 = new Map(); r2Deleted = []; geminiCalls = []; fileDeleted = []; fileStates = []; genFail = []; nextId = 1; capRows = []; spendRows = [];
  clearSnaps();
  E.GEMINI_API_KEY = 'k'; E.FILES = fakeR2();
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init: RequestInit = {}) => {
    const url = String(input), u = new URL(url), m = init.method || 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const ok = (d: unknown, h: Record<string, string> = {}) => new Response(JSON.stringify(d), { headers: h });
    // ---- Gemini
    if (u.host === 'generativelanguage.googleapis.com' || u.host === 'upload.example') {
      geminiCalls.push({ url, ...(body ? { body } : {}) });
      if (u.pathname === '/upload/v1beta/files') return ok({}, { 'x-goog-upload-url': 'https://upload.example/u1' });
      if (u.host === 'upload.example') return ok({ file: { name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', mimeType: 'audio/mpeg', state: 'PROCESSING' } });
      if (u.pathname === '/v1beta/files/abc' && m === 'DELETE') { fileDeleted.push('files/abc'); return ok({}); }
      if (u.pathname === '/v1beta/files/abc') return ok({ name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', state: fileStates.shift() || 'ACTIVE' });
      if (u.pathname.endsWith(':generateContent')) {
        const fail = genFail.shift();
        if (fail) return new Response('{"error":"SECRET-PROMPT-ECHO"}', { status: fail });
        const text = JSON.stringify(body);
        const answer = text.includes('النص المفرّغ') ? SUMMARY : TRANSCRIPT(/\[(\d\d:\d\d)\]|(\d\d:\d\d) إلى/.exec(text)?.[2] ?? '00:00');
        return ok({ candidates: [{ content: { parts: [{ text: answer }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 50, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 800 }, { modality: 'TEXT', tokenCount: 200 }] } });
      }
    }
    // ---- Supabase
    if (u.pathname.endsWith('/profiles')) return ok(PROFILES.filter(p => p.id === eq(u.searchParams.get('id'))));
    if (u.pathname.endsWith('/audit_log')) { audits.push(body); return ok([]); }
    if (u.pathname.endsWith('/ai_usage')) { usage.push(body); return ok([]); }
    if (u.pathname.endsWith('/rpc/ai_spend')) return ok(spendRows.map(s => ({ month: '2026-11', calls: 1, tokens_in: 1, tokens_out: 1, cost_sar: 0, unpriced: 0, ...s })));
    if (u.pathname.endsWith('/ai_budgets')) return ok(capRows);
    if (u.pathname.endsWith('/library_items') && m === 'POST') { const row = { ...body, id: 900 + libs.length }; libs.push(row); return ok([row]); }
    if (u.pathname.endsWith('/transcribe_jobs')) {
      const q = u.searchParams;
      const hit = () => jobsDb.filter(j => (!eq(q.get('company_id')) || j.company_id === eq(q.get('company_id'))) && (!eq(q.get('id')) || String(j.id) === eq(q.get('id')))
        && (!q.get('status') || (q.get('status')!.startsWith('in.') ? q.get('status')!.slice(4, -1).split(',').includes(String(j.status)) : j.status === eq(q.get('status'))))
        && (!q.get('updated_at') || String(j.updated_at) < q.get('updated_at')!.slice(3))
        && (!q.get('or') || (j.locked_until == null || String(j.locked_until) < /lt\.([^,)]+)/.exec(q.get('or')!)![1]!)));
      if (m === 'POST') { const row: Row = { status: 'queued', step: 0, attempts: 0, gemini_file: null, gemini_uri: null, segments: [], result: {}, error: null, locked_until: null, created_at: '2026-11-08T09:00:00.000Z', updated_at: '2026-11-08T09:00:00.000Z', ...body, id: nextId++ }; jobsDb.push(row); return ok([row]); }
      if (m === 'PATCH') { const h = hit(); h.forEach(j => Object.assign(j, body)); return ok(h); }
      return ok(hit());
    }
    return ok([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const settle = async <T,>(run: () => Promise<T>): Promise<T> => { const jobs: Promise<unknown>[] = []; const out = await withWaiter(p => jobs.push(p), run); await Promise.all(jobs); return out; };
const mkJob = (x: Partial<Job> = {}): Job => {
  const seconds = x.seconds ?? 1500;
  const row: Row = { id: nextId++, company_id: CO_A, created_by: 'w@example.com', created_by_id: writer.id, title: 'اجتماع تجريبي', purpose: 'meeting', mime: 'audio/mpeg', bytes: 1234, seconds, r2_key: `transcribe/${CO_A}/k1`, status: 'queued', step: 0, steps: stepsFor(seconds), attempts: 0,
    gemini_file: null, gemini_uri: null, segments: [], result: {}, error: null, locked_until: null, created_at: '2026-11-08T09:00:00.000Z', updated_at: '2026-11-08T09:00:00.000Z', ...x } as Row;
  jobsDb.push(row); r2.set(String(row.r2_key), 1234);
  return row as unknown as Job;
};
const drive = async (id: number, co = CO_A, max = 20): Promise<Job> => {
  let last: Job | null = null;
  for (let i = 0; i < max; i++) {
    const got = await acquire(cfg, id, co); if (!got) break;
    last = await settle(() => stepJob(E, cfg, got)); jobsDb.find(j => j.id === id)!.updated_at = last.updated_at;
    if (last.status === 'done' || last.status === 'failed') break;
  }
  return last!;
};

describe('upload rules and windows', () => {
  const ok = { mime: 'audio/mpeg', bytes: 5 * 1048576, seconds: 120, title: '  اجتماع   الأحد ', purpose: 'ad' };
  it('accepts audio and video types, trims the title, and falls back for an unknown purpose', () => {
    expect(cleanUpload(ok)).toEqual({ title: 'اجتماع الأحد', purpose: 'ad', mime: 'audio/mpeg', bytes: 5 * 1048576, seconds: 120 });
    expect(cleanUpload({ ...ok, mime: 'video/mp4; codecs=avc1', purpose: 'x', title: '' })).toMatchObject({ mime: 'video/mp4', purpose: 'meeting', title: 'ملف بدون عنوان' });
  });
  it('refuses a wrong type, an empty or too big file, and a missing or too long duration, in plain words', () => {
    expect(cleanUpload({ ...ok, mime: 'application/pdf' })).toMatchObject({ error: expect.stringContaining('مو مدعومة') });
    expect(cleanUpload({ ...ok, bytes: 0 })).toEqual({ error: 'الملف فاضي' });
    expect(cleanUpload({ ...ok, bytes: MAX_BYTES + 1 })).toMatchObject({ error: expect.stringContaining('قسّمه') });
    expect(cleanUpload({ ...ok, seconds: 0 })).toMatchObject({ error: expect.any(String) });
    expect(cleanUpload({ ...ok, seconds: 5 * 3600 })).toMatchObject({ error: expect.stringContaining('قسّم') });
  });
  it('cuts a recording into 10-minute windows, and counts the send and the summary as steps', () => {
    expect(windows(1500)).toEqual([{ from: 0, to: 600 }, { from: 600, to: 1200 }, { from: 1200, to: 1500 }]);
    expect(windows(30)).toEqual([{ from: 0, to: 30 }]);
    expect(stepsFor(1500)).toBe(5);
    expect(stepsFor(30)).toBe(3);
  });
  it('the window prompt names the span and asks for dialect, timestamps and no summary', () => {
    const p = windowPrompt(600, 1200, false);
    expect(p).toContain('10:00'); expect(p).toContain('20:00'); expect(p).toContain('لهجة'); expect(p).toContain('[غير واضح]');
    expect(windowPrompt(0, 30, true)).toContain('آخر جزء');
  });
});

describe('reading the summary', () => {
  it('reads the JSON even with text around it, and cuts and cleans every field', () => {
    const s = parseSummary('تفضل:\n' + JSON.stringify({ summary: ' ملخص   قصير ', hook: 'هوك', offer: '', actions: [{ task: 'مهمة', owner: 'سارة' }, 'بند نصي', { task: '' }, { owner: 'x' }] }));
    expect(s).toEqual({ summary: 'ملخص قصير', hook: 'هوك', offer: '', actions: [{ task: 'مهمة', owner: 'سارة', due: '' }, { task: 'بند نصي', owner: '', due: '' }] });
  });
  it('is null without a summary or without JSON', () => {
    expect(parseSummary('لا شي')).toBeNull();
    expect(parseSummary('{"summary": ""}')).toBeNull();
    expect(parseSummary('{broken')).toBeNull();
  });
  it('warns about phone and ID numbers (also in Arabic-Indic digits and with spaces) and a patient mentioned, counting only', () => {
    const n = personalNotes('كلمني على 0551234567 أو ٠٥٥٩٨٧٦٥٤٣ ورقم الهوية 1012345678 واسم المريض فلان');
    expect(n).toEqual([{ kind: 'phone', n: 2 }, { kind: 'id', n: 1 }, { kind: 'patient', n: 1 }]);
    expect(JSON.stringify(n)).not.toContain('055');
    expect(personalNotes('اجتماع عادي عن الحجوزات')).toEqual([]);
  });
  it('the library draft holds the summary, the actions for a meeting (or hook and offer for an ad) and the transcript', () => {
    const sum = { summary: 'ملخص', hook: 'هوك', offer: 'عرض', actions: [{ task: 'مهمة', owner: 'سارة', due: 'الأحد' }] };
    expect(libraryDoc('عنوان', sum, 'النص', 'meeting')).toContain('- مهمة (سارة) · الأحد');
    expect(libraryDoc('عنوان', sum, 'النص', 'meeting')).not.toContain('هوك');
    const ad = libraryDoc('عنوان', sum, 'النص', 'ad');
    expect(ad).toContain('هوك'); expect(ad).toContain('عرض'); expect(ad).not.toContain('مهمة');
  });
});

describe('the Gemini adapter', () => {
  it('builds the request: system text, inline images, uploaded files with a time window, JSON mode', () => {
    const b = geminiBody({ system: 'S', parts: [{ text: 'T' }, { inline: { mime: 'image/png', data: 'QUJD' } }, { file: { mime: 'video/mp4', uri: 'u' }, from: 600, to: 1200.4 }, { file: { mime: 'audio/mpeg', uri: 'v' } }], max_tokens: 99, json: true }) as {
      systemInstruction: unknown; contents: { parts: Record<string, unknown>[] }[]; generationConfig: Record<string, unknown> };
    expect(b.systemInstruction).toEqual({ parts: [{ text: 'S' }] });
    expect(b.contents[0]!.parts).toEqual([{ text: 'T' }, { inlineData: { mimeType: 'image/png', data: 'QUJD' } },
      { fileData: { mimeType: 'video/mp4', fileUri: 'u' }, videoMetadata: { startOffset: '600s', endOffset: '1201s' } }, { fileData: { mimeType: 'audio/mpeg', fileUri: 'v' } }]);
    expect(b.generationConfig).toMatchObject({ maxOutputTokens: 99, responseMimeType: 'application/json' });
  });
  it('returns the text, counts the thinking as output and the audio part of the input apart, and records the cost to the tab', async () => {
    const out = await settle(() => gemini(E, 'transcribe', { parts: [{ text: 'x' }], max_tokens: 10 }, undefined, { cfg, co: CO_A, uid: writer.id }));
    expect(out.text).toContain('أهلاً');
    expect(out.usage).toEqual({ in: 1000, out: 250, audioIn: 800 });
    const c = cost('gemini', 'gemini-3-flash', 1000, 250, 800);
    expect(c.usd).toBeCloseTo((200 * 0.3 + 800 * 1 + 250 * 2.5) / 1e6, 8);
    expect(usage).toMatchObject([{ company_id: CO_A, user_id: writer.id, module: 'transcribe', provider: 'gemini', model: 'gemini-3-flash', tokens_in: 1000, tokens_out: 250, cost_usd: c.usd, priced: true }]);
    expect(JSON.stringify(usage)).not.toContain('أهلاً');
  });
  it('with no key it does not call anyone; a spent tab stops (no free fallback for audio)', async () => {
    delete E.GEMINI_API_KEY;
    await expect(gemini(E, 'transcribe', { parts: [{ text: 'x' }], max_tokens: 1 })).rejects.toMatchObject({ code: 'no_key' });
    expect(geminiCalls).toEqual([]);
    E.GEMINI_API_KEY = 'k'; capRows = [{ module: 'transcribe', monthly_cap_usd: 1 }]; spendRows = [{ module: 'transcribe', cost_usd: 2 }];
    await expect(gemini(E, 'transcribe', { parts: [{ text: 'x' }], max_tokens: 1 }, undefined, { cfg, co: CO_A })).rejects.toMatchObject({ code: 'capped' });
    expect(geminiCalls).toEqual([]);
  });
  it('maps 429, other failures and blocked answers to codes, and never logs the provider body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    genFail = [429, 500];
    await expect(gemini(E, 'transcribe', { parts: [{ text: 'x' }], max_tokens: 1 })).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(gemini(E, 'transcribe', { parts: [{ text: 'x' }], max_tokens: 1 })).rejects.toMatchObject({ code: 'failed', status: 500 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-PROMPT-ECHO');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }))));
    await expect(gemini(E, 'transcribe', { parts: [{ text: 'x' }], max_tokens: 1 })).rejects.toMatchObject({ code: 'blocked' });
  });
  it('plain words for a missing key: the secret name only for the owner', () => {
    expect(notReady({ role: 'member' })).toBe('ما اكتمل تجهيزه، بلّغ الإدارة');
    expect(notReady({ role: 'owner' })).toContain('GEMINI_API_KEY');
    expect(new GeminiError('empty').code).toBe('empty');
  });
  it('uploads in two calls (start, then the bytes with their length), and only touches files/<id> names', async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(10)); c.close(); } });
    const f = await uploadFile(E, body, 'audio/mpeg', 10, 'اجتماع');
    expect(f).toMatchObject({ name: 'files/abc', state: 'PROCESSING' });
    const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const start = calls[0]![1].headers as Record<string, string>, up = calls[1]![1].headers as Record<string, string>;
    expect(start['x-goog-upload-command']).toBe('start'); expect(start['x-goog-upload-header-content-length']).toBe('10');
    expect(up['content-length']).toBe('10'); expect(up['x-goog-upload-command']).toBe('upload, finalize');
    await expect(fileState(E, '../../etc', 'audio/mpeg')).rejects.toBeInstanceOf(GeminiError);
    expect(await deleteFile(E, 'files/../x')).toBe(false);
    expect(await deleteFile(E, 'files/abc')).toBe(true);
  });
});

describe('a whole job, stepped to the end', () => {
  it('sends the file, reads each window, summarises, saves a library draft, deletes both copies and records every call', async () => {
    const j = mkJob({ seconds: 1500 });
    const done = await drive(j.id);
    expect(done).toMatchObject({ status: 'done', step: 5 });
    expect(done.segments.map(s => [s.from, s.to])).toEqual([[0, 600], [600, 1200], [1200, 1500]]);
    const gen = geminiCalls.filter(c => c.url.includes(':generateContent'));
    expect(gen.length).toBe(4);   // three windows and the summary
    expect(JSON.stringify(gen[1]!.body)).toContain('10:00');
    expect(JSON.stringify(gen[0]!.body)).not.toContain('videoMetadata');   // audio: the window is only in the prompt
    expect(done.result).toMatchObject({ summary: 'اجتماع قصير عن الحجوزات.', actions: [{ task: 'نراجع الحجوزات', owner: 'سارة', due: 'الأحد' }], library_id: 900 });
    expect(libs).toHaveLength(1);
    expect(libs[0]).toMatchObject({ company_id: CO_A, module: 'transcribe', kind: 'text', created_by: 'w@example.com', created_by_id: writer.id });
    expect(String(libs[0]!.content)).toContain('أهلاً وسهلاً'); expect(libs[0]!.review_status).toBeUndefined();   // the table default makes it a draft
    expect(r2Deleted).toEqual([`transcribe/${CO_A}/k1`]); expect(fileDeleted).toEqual(['files/abc']);
    expect(done).toMatchObject({ r2_key: null, gemini_file: null });
    expect(usage.map(u => [u.module, u.provider, u.company_id])).toEqual(Array(4).fill(['transcribe', 'gemini', CO_A]));
    expect(audits.map(a => a.action)).toContain('transcribe_done');
  });
  it('a video asks Gemini for each window with start and end offsets', async () => {
    const j = mkJob({ seconds: 700, mime: 'video/mp4' });
    await drive(j.id);
    const w = geminiCalls.filter(c => c.url.includes(':generateContent'))[1]!.body as { contents: { parts: Record<string, unknown>[] }[] };
    expect(w.contents[0]!.parts[0]).toMatchObject({ videoMetadata: { startOffset: '600s', endOffset: '700s' } });
  });
  it('a file still being prepared changes nothing: the step is asked again later', async () => {
    const j = mkJob({ seconds: 100, gemini_file: 'files/abc', gemini_uri: 'u', step: 1 });
    fileStates = ['PROCESSING'];
    const got = (await acquire(cfg, j.id, CO_A))!;
    const after = await stepJob(E, cfg, got);
    expect(after).toMatchObject({ status: 'processing', step: 1 }); expect(after.locked_until).toBeNull();
    expect(geminiCalls.some(c => c.url.includes(':generateContent'))).toBe(false);
  });
  it('a summary that cannot be read still keeps the transcript', async () => {
    const j = mkJob({ seconds: 100 });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
      if (String(init?.body).includes('النص المفرّغ')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'مو JSON' }] } }] }));
      return real(input as string, init);
    }));
    const done = await drive(j.id);
    expect(done.status).toBe('done');
    expect(done.result.summary).toContain('النص كامل تحت');
    expect(String(libs[0]!.content)).toContain('أهلاً وسهلاً');
  });
  it('personal numbers in the transcript are flagged on the result', async () => {
    const j = mkJob({ seconds: 100 });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
      if (String(input).includes(':generateContent') && !String(init?.body).includes('النص المفرّغ')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[00:03] رقمي 0551234567' }] } }] }));
      return real(input as string, init);
    }));
    expect((await drive(j.id)).result.notes).toEqual([{ kind: 'phone', n: 1 }]);
  });
  it('another asker cannot run a step while one holds the lock, and another company cannot take the job', async () => {
    const j = mkJob();
    expect(await acquire(cfg, j.id, CO_B)).toBeNull();
    expect(await acquire(cfg, j.id, CO_A)).not.toBeNull();
    expect(await acquire(cfg, j.id, CO_A)).toBeNull();
  });
});

describe('failures', () => {
  it('a busy provider (429) waits a minute without using an attempt', async () => {
    const j = mkJob({ seconds: 100, gemini_file: 'files/abc', gemini_uri: 'u', step: 1 });
    genFail = [429];
    const got = (await acquire(cfg, j.id, CO_A))!;
    const after = await stepJob(E, cfg, got);
    expect(after).toMatchObject({ status: 'processing', attempts: 0 });
    expect(Date.parse(String(after.locked_until))).toBeGreaterThan(Date.now() + 30_000);
  });
  it('three failed tries end the job in plain words, delete both copies of the file, and say nothing technical', async () => {
    const j = mkJob({ seconds: 100, gemini_file: 'files/abc', gemini_uri: 'u', step: 1 });
    genFail = [500, 500, 500];
    const done = await drive(j.id);
    expect(done).toMatchObject({ status: 'failed', error: 'ما قدرنا نفرّغ الملف، جرّب مرة ثانية', r2_key: null });
    expect(r2Deleted).toHaveLength(1); expect(fileDeleted).toEqual(['files/abc']);
    expect(JSON.stringify(view(done))).not.toMatch(/gemini|files\/|transcribe\//i);
  });
  it('a missing key or a spent tab fails at once with the plain message; a missing file says to upload again', async () => {
    const a = mkJob({ seconds: 100 });
    delete E.GEMINI_API_KEY;
    expect(await drive(a.id)).toMatchObject({ status: 'failed', error: 'ما اكتمل تجهيزه، بلّغ الإدارة' });
    E.GEMINI_API_KEY = 'k';
    const b = mkJob({ seconds: 100, r2_key: 'transcribe/x/gone' }); r2.delete('transcribe/x/gone');
    expect(await drive(b.id)).toMatchObject({ status: 'failed', error: 'الملف ما انحفظ، ارفعه مرة ثانية' });
    capRows = [{ module: 'transcribe', monthly_cap_usd: 1 }]; spendRows = [{ module: 'transcribe', cost_usd: 5 }]; clearSnaps();
    const c = mkJob({ seconds: 100, gemini_file: 'files/abc', gemini_uri: 'u', step: 1 });
    expect(await drive(c.id)).toMatchObject({ status: 'failed', error: 'وصل الصرف الشهري لهالتاب، بلّغ الإدارة' });
  });
});

describe('routes', () => {
  const call = async (h: (r: Request, e: typeof E) => Response | Promise<Response>, who: A.Profile, init: { path?: string; method?: string; body?: BodyInit; headers?: Record<string, string> } = {}) => {
    const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(who, cfg), cfg.secret))}`;
    return h(new Request('https://well.example' + (init.path || '/api/transcribe/jobs'), { method: init.method || 'GET', ...(init.body !== undefined ? { body: init.body } : {}),
      headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', ...(init.headers || {}) } }), E);
  };
  const T = ROUTES.transcribe;
  const FILE = new Uint8Array(2048);
  const up = (who: A.Profile, q = 'title=اجتماع&purpose=meeting&seconds=1500', headers: Record<string, string> = { 'content-type': 'audio/mpeg', 'content-length': String(FILE.length) }, body: BodyInit = FILE) =>
    call(T.upload.POST, who, { path: `/api/transcribe/upload?${q}`, method: 'POST', body, headers });
  const json = async (r: Response) => (await r.json()) as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

  it('the list says whether it is ready, in plain words for a member and with the secret name for the owner', async () => {
    delete E.GEMINI_API_KEY;
    expect(await json(await call(T.jobs.GET, writer))).toMatchObject({ ready: false, why: 'ما اكتمل تجهيزه، بلّغ الإدارة' });
    expect((await json(await call(T.jobs.GET, owner))).why).toContain('GEMINI_API_KEY');
    E.GEMINI_API_KEY = 'k';
    expect(await json(await call(T.jobs.GET, writer))).toMatchObject({ ready: true, why: '', max_mb: 95 });
  });
  it('an upload stores the file under the company, starts a job with the right number of steps, and audits it', async () => {
    const r = await up(writer);
    expect(r.status).toBe(200);
    const { job } = await json(r);
    expect(job).toMatchObject({ status: 'queued', seconds: 1500, steps: 5, title: 'اجتماع' });
    expect(JSON.stringify(job)).not.toMatch(/r2_key|gemini|transcribe\//);
    expect(jobsDb[0]).toMatchObject({ company_id: CO_A, created_by: 'w@example.com', created_by_id: writer.id, mime: 'audio/mpeg', bytes: 2048 });
    expect(String(jobsDb[0]!.r2_key)).toMatch(new RegExp(`^transcribe/${CO_A}/[0-9a-f]{32}$`));
    expect(r2.get(String(jobsDb[0]!.r2_key))).toBe(2048);
    expect(audits.map(a => a.action)).toContain('transcribe_started');
  });
  it('refuses: a viewer, no key (before taking the file), a wrong type, a file that did not arrive whole, too many open jobs, a spent tab', async () => {
    expect((await up(viewer)).status).toBe(403);
    delete E.GEMINI_API_KEY;
    const r0 = await up(writer); expect(r0.status).toBe(503); expect((await json(r0)).error).toBe('ما اكتمل تجهيزه، بلّغ الإدارة'); expect(r2.size).toBe(0);
    E.GEMINI_API_KEY = 'k';
    expect((await up(writer, undefined, { 'content-type': 'application/pdf' })).status).toBe(400);
    expect((await up(writer, 'seconds=0')).status).toBe(400);
    const liar = await up(writer, undefined, { 'content-type': 'audio/mpeg', 'content-length': '9999' });
    expect(liar.status).toBe(400); expect(r2.size).toBe(0);
    for (let i = 0; i < 3; i++) mkJob({ status: 'processing' });
    expect((await up(writer)).status).toBe(429);
    jobsDb.length = 0; capRows = [{ module: 'transcribe', monthly_cap_usd: 1 }]; spendRows = [{ module: 'transcribe', cost_usd: 3 }]; clearSnaps();
    expect((await json(await up(writer))).error).toBe('وصل الصرف الشهري لهالتاب، بلّغ الإدارة');
  });
  it('steps, reads and cancels only the company\'s own jobs', async () => {
    const mine = mkJob({ seconds: 100 }), theirs = mkJob({ seconds: 100, company_id: CO_B, r2_key: `transcribe/${CO_B}/k2` });
    expect((await call(T.step.POST, writer, { path: '/api/transcribe/step', method: 'POST', body: JSON.stringify({ id: theirs.id }) })).status).toBe(404);
    expect((await call(T.job.GET, writer, { path: `/api/transcribe/job?id=${theirs.id}` })).status).toBe(404);
    expect((await call(T.cancel.POST, writer, { path: '/api/transcribe/cancel', method: 'POST', body: JSON.stringify({ id: theirs.id }) })).status).toBe(404);
    expect(r2Deleted).toEqual([]);
    const r = await call(T.step.POST, writer, { path: '/api/transcribe/step', method: 'POST', body: JSON.stringify({ id: mine.id }) });
    expect(r.status).toBe(200); expect((await json(r)).job).toMatchObject({ id: mine.id, step: 1 });
    const again = await call(T.step.POST, writer, { path: '/api/transcribe/step', method: 'POST', body: JSON.stringify({ id: mine.id }) });
    expect(again.status).toBe(200);   // the next step runs, or answers busy: never an error
    const c = await call(T.cancel.POST, writer, { path: '/api/transcribe/cancel', method: 'POST', body: JSON.stringify({ id: mine.id }) });
    expect((await json(c)).job).toMatchObject({ status: 'failed', error: 'أوقفته' });
    expect(r2Deleted).toContain(`transcribe/${CO_A}/k1`);
  });
  it('the detail has the transcript and the result; a viewer reads but cannot step', async () => {
    const j = mkJob({ seconds: 100 }); await drive(j.id);
    const d = (await json(await call(T.job.GET, viewer, { path: `/api/transcribe/job?id=${j.id}` }))).job;
    expect(d.transcript).toContain('أهلاً وسهلاً'); expect(d.result.summary).toContain('اجتماع');
    expect((await call(T.step.POST, viewer, { path: '/api/transcribe/step', method: 'POST', body: JSON.stringify({ id: j.id }) })).status).toBe(403);
  });
});

describe('the cron', () => {
  it('gives the next step to a job nobody has touched for two minutes, and leaves fresh or locked jobs alone', async () => {
    const stale = mkJob({ seconds: 100, updated_at: new Date(Date.now() - 5 * 60_000).toISOString() });
    const fresh = mkJob({ seconds: 100, updated_at: new Date().toISOString() });
    const locked = mkJob({ seconds: 100, updated_at: new Date(Date.now() - 9 * 60_000).toISOString(), locked_until: new Date(Date.now() + 60_000).toISOString() });
    expect(await settle(() => runTranscribe(E))).toBe(1);
    expect(jobsDb.find(j => j.id === stale.id)!.step).toBe(1);
    expect(jobsDb.find(j => j.id === fresh.id)!.step).toBe(0);
    expect(jobsDb.find(j => j.id === locked.id)!.step).toBe(0);
  });
  it('does nothing without the key, and without a job', async () => {
    mkJob({ updated_at: new Date(Date.now() - 5 * 60_000).toISOString() });
    delete E.GEMINI_API_KEY;
    expect(await runTranscribe(E)).toBe(0);
    jobsDb.length = 0; E.GEMINI_API_KEY = 'k';
    expect(await runTranscribe(E)).toBe(0);
  });
});

describe('the module starts locked', () => {
  it('is live, in the registry and the gate, and its migration locks it for every company until the owner opens it', () => {
    expect(LIVE).toContain('transcribe');
    expect(need('/transcribe/', '')).toBe('transcribe');
    expect(need('/api/transcribe/upload', '')).toBe('transcribe');
    expect(migration).toMatch(/array_append\(disabled_modules, 'transcribe'\)/);
    expect(migration).not.toMatch(/where id =/);   // every company, not only Well
    expect(migration).toMatch(/enable row level security/); expect(migration).toMatch(/revoke all on public\.transcribe_jobs from anon, authenticated/);
    expect(migration).toMatch(/'gemini'/);
  });
  it('a company that has it locked gets 403 on the page and the API, the owner included', async () => {
    const locked: A.Profile = { ...owner, id: '00000000-0000-0000-0000-000000000007', company: { disabled_modules: ['transcribe'] } } as A.Profile;
    PROFILES.push(locked);
    const r = await ROUTES.transcribe.jobs.GET(new Request('https://well.example/api/transcribe/jobs', { headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(locked, cfg), cfg.secret))}` } }), E);
    PROFILES.pop();
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe(A.LOCKED);
  });
});
