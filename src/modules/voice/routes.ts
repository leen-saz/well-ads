// /api/voice/*: brand-voice check and an optional AI rewrite. Nothing is stored; read-only.
import { json, readJson, handle, requireUser } from '../../lib/auth';
import { AI_MODEL, type AiRun } from '../content/content';
import { knowledgeFor, withKnowledge } from '../knowledge/knowledge';
import { ACCENTS, GUIDE, TONES, TTS_MODEL, TTS_VOICES, analyze, rewritePrompt, ttsBody, ttsInput } from './voice';

type AiEnv = { AI?: { run: AiRun } };
type TtsEnv = { GEMINI_API_KEY?: string; GEMINI_TTS_MODEL?: string };

export const guide = { GET: handle(async (request, e) => {
  await requireUser(request, e, 'voice');
  return json(200, { guide: GUIDE, tts: { ready: !!(e as TtsEnv).GEMINI_API_KEY, voices: TTS_VOICES, accents: ACCENTS, tones: TONES } });
}) };

export const check = { POST: handle(async (request, e) => {
  await requireUser(request, e, 'voice', { write: true });
  const text = String((await readJson(request)).text || '').trim();
  if (!text) return json(400, { error: 'اكتب النص أول' });
  return json(200, analyze(text));
}) };

export const rewrite = { POST: handle(async (request, e: AiEnv & Parameters<typeof requireUser>[1]) => {
  const { cfg, user } = await requireUser(request, e, 'voice', { write: true });
  const b = await readJson(request);
  const text = String(b.text || '').trim().slice(0, 2000);
  const seconds = [15, 30, 60].includes(Number(b.seconds)) ? Number(b.seconds) : 30;
  if (!text) return json(400, { error: 'اكتب النص أول' });
  if (!e.AI) return json(503, { error: 'إعادة الكتابة بالذكاء الاصطناعي غير مفعّلة في هالبيئة' });
  let out: unknown;
  try { out = await e.AI.run(AI_MODEL, { messages: withKnowledge([{ role: 'user', content: rewritePrompt(text, seconds) }], await knowledgeFor(cfg, user.co, 'voice')), max_tokens: 400 }); }
  catch { return json(503, { error: 'الذكاء الاصطناعي ما رد الحين، جرّب بعد دقيقة' }); }
  const next = String((out as { response?: unknown })?.response ?? '').trim().replace(/^["«]|["»]$/g, '').slice(0, 2000);
  if (!next) return json(502, { error: 'ما رجع نص، جرّب مرة ثانية' });
  return json(200, { text: next, analysis: analyze(next) });
}) };

// /api/voice/speak: Gemini TTS. The audio JSON is passed straight through (no parsing here: the free Workers
// plan allows 10 ms of CPU); the page turns the PCM into a WAV file. The key never reaches the browser.
export const speak = { POST: handle(async (request, e: TtsEnv & Parameters<typeof requireUser>[1]) => {
  await requireUser(request, e, 'voice', { write: true });
  const i = ttsInput(await readJson(request));
  if (!i.text) return json(400, { error: 'اكتب النص أول' });
  if (!e.GEMINI_API_KEY) return json(503, { error: 'توليد الصوت مو مفعّل للحين، تواصل مع مسؤولة النظام' });
  const model = (e.GEMINI_TTS_MODEL || TTS_MODEL).replace(/[^a-z0-9.\-]/gi, '');
  let r: Response;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': e.GEMINI_API_KEY }, body: JSON.stringify(ttsBody(i)),
    });
  } catch { return json(502, { error: 'خدمة الصوت ما ردت، جرّب بعد دقيقة' }); }
  if (r.status === 429) return json(429, { error: 'وصلت حد توليد الصوت لهالفترة، جرّب بعدين' });
  if (!r.ok) return json(502, { error: `ما انولد الصوت (${r.status})` });
  return new Response(r.body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}) };
