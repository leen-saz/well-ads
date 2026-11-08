// Voiceover: the choices and the prompt, the cost read from the end of an answer without parsing it, the brand voice per company, the
// script check, generating (passthrough, cost, cap, failures), permissions and company isolation, and that the module starts locked.
// Fake Supabase and Gemini; the "audio" is made-up bytes.
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { need } from '../../lib/gate';
import { clearSnaps, withWaiter } from '../../lib/usage';
import { ACCENTS, DEFAULTS, MAX_CHARS, PACES, body, choice, cleanSpeak, guessUsage, prompt, seconds, usageIn } from './voiceover';
import { ROUTES } from '../routes';
import { LIVE } from '../registry';
import migration from '../../../supabase/migrations/025_voiceover.sql?raw';

const CO_A = '11111111-1111-1111-1111-111111111111', CO_B = '22222222-2222-2222-2222-222222222222';
const E: A.AuthEnv & { GEMINI_API_KEY?: string; GEMINI_TTS_MODEL?: string } = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com' };
const cfg = A.env(E);
const P = (n: number, email: string, co: string, access: Record<string, string>, role = 'member'): A.Profile => ({ id: `00000000-0000-0000-0000-00000000000${n}`, email, role, active: true, access, company_id: co } as A.Profile);
const owner = P(1, 'boss@example.com', CO_A, {}, 'owner');
const writer = P(2, 'w@example.com', CO_A, { voiceover: 'edit' });
const viewer = P(3, 'v@example.com', CO_A, { voiceover: 'view' });
const other = P(4, 'x@example.com', CO_B, { voiceover: 'edit' });
const PROFILES = [owner, writer, viewer, other];

// The speech answer: an audio part (made-up bytes, 2 seconds of PCM at 24 kHz) and, after it, the token counts
const PCM_B64 = 'A'.repeat(Math.ceil((48_000 * 2 * 4) / 3));
const rawAnswer = (usage = true) => `{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/L16;codec=pcm;rate=24000","data":"${PCM_B64}"}}]}}]${usage ? ',"usageMetadata":{"promptTokenCount":40,"candidatesTokenCount":50,"promptTokensDetails":[{"modality":"TEXT","tokenCount":40}]}' : ''}}`;

let settingsRows: Record<string, unknown>[], audits: { action: string; target?: unknown }[], usage: Record<string, unknown>[], geminiCalls: { url: string; body: Record<string, any> }[], gemStatus: number, gemRaw: string, capRows: unknown[], spendRows: unknown[]; // eslint-disable-line @typescript-eslint/no-explicit-any
const eq = (v: string | null) => (v?.startsWith('eq.') ? v.slice(3) : null);

beforeEach(() => {
  settingsRows = []; audits = []; usage = []; geminiCalls = []; gemStatus = 200; gemRaw = rawAnswer(); capRows = []; spendRows = []; clearSnaps(); E.GEMINI_API_KEY = 'k'; delete E.GEMINI_TTS_MODEL;
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init: RequestInit = {}) => {
    const u = new URL(String(input)), m = init.method || 'GET', body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const ok = (d: unknown) => new Response(JSON.stringify(d));
    if (u.host === 'generativelanguage.googleapis.com') { geminiCalls.push({ url: String(input), body }); return new Response(gemStatus === 200 ? gemRaw : '{"error":"SECRET-SCRIPT-ECHO"}', { status: gemStatus }); }
    if (u.pathname.endsWith('/profiles')) return ok(PROFILES.filter(p => p.id === eq(u.searchParams.get('id'))));
    if (u.pathname.endsWith('/audit_log')) { audits.push(body); return ok([]); }
    if (u.pathname.endsWith('/ai_usage')) { usage.push(body); return ok([]); }
    if (u.pathname.endsWith('/rpc/ai_spend')) return ok(spendRows);
    if (u.pathname.endsWith('/ai_budgets')) return ok(capRows);
    if (u.pathname.endsWith('/voiceover_settings')) {
      if (m === 'POST') { settingsRows = settingsRows.filter(r => r.company_id !== body.company_id); settingsRows.push(body); return ok([]); }
      return ok(settingsRows.filter(r => r.company_id === eq(u.searchParams.get('company_id'))));
    }
    return ok([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const V = ROUTES.voiceover;
const call = async (h: (r: Request, e: typeof E) => Response | Promise<Response>, who: A.Profile, body?: unknown, path = '/api/voiceover/guide') => {
  const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(who, cfg), cfg.secret))}`;
  const jobs: Promise<unknown>[] = [];
  const res = await withWaiter(p => jobs.push(p), async () => h(new Request('https://well.example' + path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } }), E));
  await Promise.all(jobs);
  return res;
};
const speak = (who: A.Profile, b: Record<string, unknown> = { text: 'أهلاً فيكم في ويل، نوصل لك الرعاية لين بيتك.' }) => call(V.speak.POST, who, b, '/api/voiceover/speak');
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('the choices and the prompt', () => {
  it('unknown voice, accent, tone or pace falls back to the brand default; known ones are kept', () => {
    expect(choice({})).toEqual(DEFAULTS);
    expect(choice({ voice: 'Kore', accent: 'hijazi', tone: 'calm', pace: 'fast' })).toEqual({ voice: 'Kore', accent: 'hijazi', tone: 'calm', pace: 'fast' });
    expect(choice({ voice: 'x', accent: 'y', tone: 'z', pace: 'w' }, { voice: 'Puck', accent: 'gulf', tone: 'warm', pace: 'slow' })).toEqual({ voice: 'Puck', accent: 'gulf', tone: 'warm', pace: 'slow' });
    expect(Object.keys(ACCENTS)).toEqual(expect.arrayContaining(['najdi', 'hijazi', 'janoubi', 'gulf', 'msa']));
  });
  it('needs a text, not longer than the limit', () => {
    expect(cleanSpeak({ text: '  ' })).toEqual({ error: 'اكتب النص أول' });
    expect(cleanSpeak({ text: 'ن'.repeat(MAX_CHARS + 1) })).toMatchObject({ error: expect.stringContaining('قسّمه') });
    expect(cleanSpeak({ text: ' مرحبا ', accent: 'janoubi' })).toMatchObject({ text: 'مرحبا', accent: 'janoubi', voice: 'Charon' });
  });
  it('the prompt names the accent, tone and pace and keeps the script as written; the request names the voice and asks for audio', () => {
    const i = { text: 'احجز الحين', voice: 'Kore', accent: 'gulf', tone: 'calm', pace: 'slow' as const };
    const p = prompt(i);
    expect(p).toContain('خليجية'); expect(p).toContain(PACES.slow); expect(p).toContain('بدون أي إضافة'); expect(p.endsWith('احجز الحين')).toBe(true);
    expect(body(i).generationConfig).toEqual({ responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } });
  });
  it('reads the token counts at the end of the answer, and the length from the audio size, without parsing it', () => {
    expect(usageIn(rawAnswer())).toEqual({ in: 40, out: 50 });
    expect(usageIn(rawAnswer(false))).toBeUndefined();
    expect(seconds(rawAnswer())).toBe(2);
    expect(guessUsage('ن'.repeat(30), rawAnswer(false))).toEqual({ in: 10, out: 50 });
    expect(seconds('{}')).toBe(0);
  });
});

describe('the brand voice', () => {
  it('starts as the default, and is saved per company, audited, and cleaned (anything unknown becomes the default)', async () => {
    expect((await json(await call(V.guide.GET, writer))).brand).toEqual(DEFAULTS);
    const r = await json(await call(V.settings.POST, writer, { voice: 'Kore', accent: 'hijazi', tone: 'energetic', pace: 'fast', company_id: CO_B }, '/api/voiceover/settings'));
    expect(r.brand).toEqual({ voice: 'Kore', accent: 'hijazi', tone: 'energetic', pace: 'fast' });
    expect(settingsRows).toHaveLength(1); expect(settingsRows[0]).toMatchObject({ company_id: CO_A, voice: 'Kore', updated_by: 'w@example.com' });   // the company is the session's, not the body's
    expect(audits.map(a => a.action)).toEqual(['voiceover_brand_set']);
    await call(V.settings.POST, writer, { voice: 'Nope', accent: 'zzz', pace: 'warp' }, '/api/voiceover/settings');
    expect(settingsRows[0]).toMatchObject({ voice: 'Charon', accent: 'najdi', tone: 'warm', pace: 'normal' });
  });
  it('another company has its own, and a viewer reads it but cannot change it', async () => {
    await call(V.settings.POST, writer, { voice: 'Kore', accent: 'gulf' }, '/api/voiceover/settings');
    expect((await json(await call(V.guide.GET, other))).brand).toEqual(DEFAULTS);
    expect((await json(await call(V.guide.GET, viewer))).brand).toMatchObject({ voice: 'Kore', accent: 'gulf' });
    expect((await call(V.settings.POST, viewer, { voice: 'Puck' }, '/api/voiceover/settings')).status).toBe(403);
    expect(settingsRows[0]).toMatchObject({ voice: 'Kore' });
  });
  it('the guide lists the voices, accents, tones and paces, and says if it is ready: plain words, the secret only for the owner', async () => {
    const g = await json(await call(V.guide.GET, writer));
    expect(g.voices.length).toBeGreaterThan(5); expect(Object.keys(g.accents)).toContain('janoubi'); expect(Object.keys(g.paces)).toEqual(['slow', 'normal', 'fast']); expect(g).toMatchObject({ ready: true, why: '', max_chars: MAX_CHARS });
    delete E.GEMINI_API_KEY;
    expect((await json(await call(V.guide.GET, writer))).why).toBe('ما اكتمل تجهيزه، بلّغ الإدارة');
    expect((await json(await call(V.guide.GET, owner))).why).toContain('GEMINI_API_KEY');
  });
});

describe('checking a script', () => {
  it('gives the compliance notices with the company rules, and needs a text', async () => {
    const r = await json(await call(V.check.POST, writer, { text: 'علاج نهائي ومضمون' }, '/api/voiceover/check'));
    expect(r.hits.map((h: { rule: string }) => h.rule)).toEqual(expect.arrayContaining(['cure', 'guarantee']));
    expect((await call(V.check.POST, writer, { text: '' }, '/api/voiceover/check')).status).toBe(400);
    expect((await call(V.check.POST, viewer, { text: 'x' }, '/api/voiceover/check')).status).toBe(403);
  });
});

describe('generating', () => {
  it('passes the answer through untouched, starts from the brand voice, and asks the speech model once', async () => {
    await call(V.settings.POST, writer, { voice: 'Kore', accent: 'hijazi', tone: 'calm', pace: 'slow' }, '/api/voiceover/settings');
    const r = await speak(writer);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(rawAnswer());
    expect(geminiCalls).toHaveLength(1);
    expect(geminiCalls[0]!.url).toContain('gemini-3.1-flash-tts-preview');
    expect(geminiCalls[0]!.body.contents[0].parts[0].text).toContain('حجازية'); expect(geminiCalls[0]!.body.contents[0].parts[0].text).toContain('أهلاً فيكم');
    expect(geminiCalls[0]!.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
  });
  it('what the request asks for overrides the brand voice for that one generation; the model can be changed without a deploy', async () => {
    E.GEMINI_TTS_MODEL = 'gemini-x.y-tts';
    await speak(writer, { text: 'مرحبا', voice: 'Puck', accent: 'gulf' });
    expect(geminiCalls[0]!.url).toContain('gemini-x.y-tts');
    expect(geminiCalls[0]!.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Puck');
    expect(geminiCalls[0]!.body.contents[0].parts[0].text).toContain('خليجية');
  });
  it('records the cost to the voiceover tab from the counts at the end of the answer, and never parses the audio', async () => {
    const realParse = JSON.parse; const sizes: number[] = [];
    vi.spyOn(JSON, 'parse').mockImplementation((t: string, r?: (k: string, v: unknown) => unknown) => { sizes.push(String(t).length); return realParse(t, r); });
    await speak(writer);
    expect(Math.max(...sizes)).toBeLessThan(50_000);   // the audio answer is hundreds of kilobytes
    expect(usage).toMatchObject([{ company_id: CO_A, user_id: writer.id, module: 'voiceover', provider: 'gemini', model: 'gemini-3.1-flash-tts-preview', tokens_in: 40, tokens_out: 50, estimated: false, priced: true }]);
    expect(JSON.stringify(usage)).not.toContain('أهلاً');
    expect(audits.map(a => a.action)).toEqual(['voiceover_spoken']);
    expect(JSON.stringify(audits)).not.toContain('أهلاً');   // the audit keeps sizes and choices, never the script
  });
  it('without the counts the cost is estimated from the sizes and marked as such', async () => {
    gemRaw = rawAnswer(false);
    await speak(writer);
    expect(usage[0]).toMatchObject({ estimated: true, tokens_out: 50 });
  });
  it('refuses a viewer, no key (before any call), an empty or too long text, and a spent tab (before any call)', async () => {
    expect((await speak(viewer)).status).toBe(403);
    delete E.GEMINI_API_KEY;
    const nokey = await speak(writer); expect(nokey.status).toBe(503); expect((await json(nokey)).error).toBe('ما اكتمل تجهيزه، بلّغ الإدارة');
    E.GEMINI_API_KEY = 'k';
    expect((await speak(writer, { text: '' })).status).toBe(400);
    expect((await speak(writer, { text: 'ن'.repeat(MAX_CHARS + 1) })).status).toBe(400);
    capRows = [{ module: 'voiceover', monthly_cap_usd: 1 }]; spendRows = [{ module: 'voiceover', cost_usd: 4 }];
    const spent = await speak(writer); expect(spent.status).toBe(429); expect((await json(spent)).error).toBe('وصل الصرف الشهري لهالتاب، بلّغ الإدارة');
    expect(geminiCalls).toHaveLength(0);
  });
  it('a busy or failing provider, or an answer without audio, is said in plain words: nothing technical, nothing logged from the body, nothing recorded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gemStatus = 429; expect((await json(await speak(writer))).error).toBe('الخدمة مشغولة الحين، جرّب بعد دقيقة');
    gemStatus = 500; const down = await speak(writer); expect(down.status).toBe(502); expect((await json(down)).error).toBe('الخدمة ما ردت، جرّب بعد شوي');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-SCRIPT-ECHO');
    gemStatus = 200; gemRaw = '{"candidates":[{"content":{"parts":[{"text":"no audio"}]}}]}';
    expect((await json(await speak(writer))).error).toBe('ما طلع جواب، جرّب مرة ثانية');
    expect(usage).toEqual([]);
  });
});

describe('the module starts locked', () => {
  it('is live, in the registry and the gate, and its migration locks it for every company', () => {
    expect(LIVE).toContain('voiceover');
    expect(need('/voiceover/', '')).toBe('voiceover'); expect(need('/api/voiceover/speak', '')).toBe('voiceover');
    expect(migration).toMatch(/array_append\(disabled_modules, 'voiceover'\)/); expect(migration).not.toMatch(/where id =/);
    expect(migration).toMatch(/enable row level security/); expect(migration).toMatch(/revoke all on public\.voiceover_settings from anon, authenticated/);
    expect(migration).toMatch(/company_id uuid primary key references public\.companies/);
  });
  it('a company that has it locked gets 403 even for the owner', async () => {
    const locked = { ...owner, id: '00000000-0000-0000-0000-000000000009', company: { disabled_modules: ['voiceover'] } } as A.Profile;
    PROFILES.push(locked);
    const r = await call(V.guide.GET, locked);
    PROFILES.pop();
    expect(r.status).toBe(403); expect((await json(r)).error).toBe(A.LOCKED);
  });
});
