// /api/compliance/*: ad copy against health-ad rules plus the company's forbidden words. scan = the company's stored ads;
// check = any text; rewrite = an AI rewrite that is checked again before it is shown. Notices only, nothing is blocked.
import { sb, json, readJson, handle, requireUser, type AuthEnv } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { check as checkText, scan as scanAds, rewritePrompt, RULES, type AdText } from './compliance';
import { knowledgeFor, rulesFor, withKnowledge } from '../knowledge/knowledge';
import { generate, pick, type LlmEnv } from '../../lib/llm';

type AiEnv = AuthEnv & LlmEnv;

export const scan = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'compliance');
  const live = new URL(request.url).searchParams.get('live') === '1';
  const [r, extra] = await Promise.all([
    sb<AdText[]>(cfg, scoped(`/rest/v1/ads?select=ad_key,platform,name,live,text:doc->>text${live ? '&live=is.true' : ''}&order=updated_at.desc&limit=1000`, user.co), { admin: true }),
    rulesFor(cfg, user.co),
  ]);
  if (!r.ok || !Array.isArray(r.data)) return json(500, { error: 'ما قدرت أقرأ الإعلانات' });
  return json(200, { ...scanAds(r.data, extra), rules: [...RULES, ...extra].map(({ id, level, title }) => ({ id, level, title })) });
}) };

export const check = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'compliance', { write: true });
  const text = String((await readJson(request)).text || '').trim();
  if (!text) return json(400, { error: 'الصق نص الإعلان أول' });
  return json(200, { hits: checkText(text, await rulesFor(cfg, user.co)) });
}) };

// A safer wording from the AI, for the person to review. Shown with its own check; never published by itself.
export const rewrite = { POST: handle(async (request, e: AiEnv) => {
  const { cfg, user } = await requireUser(request, e, 'compliance', { write: true });
  const text = String((await readJson(request)).text || '').trim().slice(0, 3000);
  if (!text) return json(400, { error: 'الصق نص الإعلان أول' });
  const extra = await rulesFor(cfg, user.co);
  const hits = checkText(text, extra).filter(h => h.level !== 'info');
  if (!hits.length) return json(200, { text, hits: [], same: true });
  if (!pick(e, 'content')) return json(503, { error: 'إعادة الصياغة بالذكاء الاصطناعي غير مفعّلة في هالبيئة' });
  let out: unknown;
  try { out = await generate(e, 'content', { messages: withKnowledge([{ role: 'user', content: rewritePrompt(text, hits) }], await knowledgeFor(cfg, user.co, 'content')), max_tokens: 700 }); }
  catch { return json(503, { error: 'الذكاء الاصطناعي ما رد الحين، جرّب بعد دقيقة' }); }
  const next = String((out as { response?: unknown })?.response ?? '').trim().replace(/^["«]|["»]$/g, '').slice(0, 3000);
  if (!next) return json(502, { error: 'ما رجع نص، جرّب مرة ثانية' });
  return json(200, { text: next, hits: checkText(next, extra), engine: (out as { engine?: string }).engine });
}) };
