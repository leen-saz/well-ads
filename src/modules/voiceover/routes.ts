// /api/voiceover/*: Arabic speech from a script. Reading the options needs view on the tab; generating, checking and saving the brand
// voice need edit. The audio is passed through to the page (it is not stored); the cost goes to ai_usage and under the tab's cap.
import { sb, json, readJson, handle, requireUser, audit, missingSchema, notApplied, type AuthEnv } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { overCap, record, usageCtx } from '../../lib/usage';
import { WHY, geminiReady, notReady, type GeminiEnv } from '../../lib/llm';
import { check as complianceCheck } from '../compliance/compliance';
import { rulesFor } from '../knowledge/knowledge';
import { ACCENTS, DEFAULTS, MAX_CHARS, PACES, TONES, TTS_MODEL, TTS_VOICES, body, choice, cleanSpeak, guessUsage, usageIn, type Choice } from './voiceover';

const MIGRATION = 'migration 026_voiceover.sql';
type Env = AuthEnv & GeminiEnv;
type Row = Choice & { company_id: string };

// The brand's voice: its saved row, or the default; a missing table (migration not applied) is the default too
async function brandVoice(cfg: Parameters<typeof sb>[0], co: string): Promise<Choice> {
  const r = await sb<Row[]>(cfg, scoped('/rest/v1/voiceover_settings?select=voice,accent,tone,pace&limit=1', co), { admin: true });
  return r.ok && Array.isArray(r.data) && r.data[0] ? choice(r.data[0] as unknown as Record<string, unknown>) : DEFAULTS;
}

export const guide = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'voiceover');
  const ready = geminiReady(e);
  return json(200, { voices: TTS_VOICES, accents: ACCENTS, tones: TONES, paces: PACES, brand: await brandVoice(cfg, user.co), max_chars: MAX_CHARS, ready, why: ready ? '' : notReady(user) });
}) };

// The brand voice: what every generation starts from
export const settings = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'voiceover', { write: true });
  const c = choice(await readJson(request, 2000));
  const r = await sb(cfg, '/rest/v1/voiceover_settings?on_conflict=company_id', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { company_id: user.co, ...c, updated_by: user.email, updated_at: new Date().toISOString() } });
  if (!r.ok) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(user, MIGRATION) : 'ما انحفظ صوت العلامة' });
  await audit(cfg, user, 'voiceover_brand_set', { target: { voice: c.voice, accent: c.accent, tone: c.tone, pace: c.pace } });
  return json(200, { ok: true, brand: c });
}) };

// The compliance notices for a script, before it is spoken (notices only: the owner and the reviewers decide)
export const check = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'voiceover', { write: true });
  const text = String((await readJson(request, 20_000)).text || '').trim();
  if (!text) return json(400, { error: 'اكتب النص أول' });
  return json(200, { hits: complianceCheck(text, await rulesFor(cfg, user.co)).map(h => ({ rule: h.rule, level: h.level, title: h.title, match: h.match, fix: h.fix })) });
}) };

// Gemini's JSON answer goes straight back to the page (it turns the 16-bit PCM into a WAV). Nothing is parsed here.
export const speak = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'voiceover', { write: true });
  if (!geminiReady(e)) return json(503, { error: notReady(user) });
  const i = cleanSpeak(await readJson(request, 20_000), await brandVoice(cfg, user.co));
  if ('error' in i) return json(400, { error: i.error });
  const ctx = usageCtx(cfg, user, 'voiceover');
  if (ctx && await overCap(ctx, 'voiceover')) return json(429, { error: WHY.capped });
  const model = (e.GEMINI_TTS_MODEL || TTS_MODEL).replace(/[^a-z0-9.\-]/gi, '');
  let r: Response;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': e.GEMINI_API_KEY! }, body: JSON.stringify(body(i)) });
  } catch (err) { console.warn('voiceover_failed', (err as Error).message); return json(502, { error: WHY.failed }); }
  if (r.status === 429) return json(429, { error: WHY.rate_limited });
  if (!r.ok) { console.warn('voiceover_failed', r.status); return json(502, { error: WHY.failed }); }   // the status only
  const raw = await r.text();
  if (!/"inlineData"|"inline_data"/.test(raw)) return json(502, { error: WHY.empty });
  const real = usageIn(raw);
  record(ctx, 'voiceover', { provider: 'gemini', model, usage: real ?? guessUsage(i.text, raw), estimated: !real });
  await audit(cfg, user, 'voiceover_spoken', { target: { chars: i.text.length, voice: i.voice, accent: i.accent } });
  return new Response(raw, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}) };
