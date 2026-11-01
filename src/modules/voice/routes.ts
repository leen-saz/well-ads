// /api/voice/*: brand-voice check and an optional AI rewrite. Nothing is stored; read-only.
import { json, readJson, handle, requireUser } from '../../lib/auth';
import { AI_MODEL, type AiRun } from '../content/content';
import { GUIDE, analyze, rewritePrompt } from './voice';

type AiEnv = { AI?: { run: AiRun } };

export const guide = { GET: handle(async (request, e) => {
  await requireUser(request, e, 'voice');
  return json(200, { guide: GUIDE });
}) };

export const check = { POST: handle(async (request, e) => {
  await requireUser(request, e, 'voice', { write: true });
  const text = String((await readJson(request)).text || '').trim();
  if (!text) return json(400, { error: 'اكتب النص أول' });
  return json(200, analyze(text));
}) };

export const rewrite = { POST: handle(async (request, e: AiEnv & Parameters<typeof requireUser>[1]) => {
  await requireUser(request, e, 'voice', { write: true });
  const b = await readJson(request);
  const text = String(b.text || '').trim().slice(0, 2000);
  const seconds = [15, 30, 60].includes(Number(b.seconds)) ? Number(b.seconds) : 30;
  if (!text) return json(400, { error: 'اكتب النص أول' });
  if (!e.AI) return json(503, { error: 'إعادة الكتابة بالذكاء الاصطناعي غير مفعّلة في هالبيئة' });
  let out: unknown;
  try { out = await e.AI.run(AI_MODEL, { messages: [{ role: 'user', content: rewritePrompt(text, seconds) }], max_tokens: 400 }); }
  catch { return json(503, { error: 'الذكاء الاصطناعي ما رد الحين، جرّب بعد دقيقة' }); }
  const next = String((out as { response?: unknown })?.response ?? '').trim().replace(/^["«]|["»]$/g, '').slice(0, 2000);
  if (!next) return json(502, { error: 'ما رجع نص، جرّب مرة ثانية' });
  return json(200, { text: next, analysis: analyze(next) });
}) };
