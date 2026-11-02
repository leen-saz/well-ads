// /api/compliance/*: ad copy against health-ad rules. scan = the company's stored ads; check = any text. Read-only.
import { sb, json, readJson, handle, requireUser } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { check as checkText, scan as scanAds, RULES, type AdText } from './compliance';

export const scan = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'compliance');
  const live = new URL(request.url).searchParams.get('live') === '1';
  const r = await sb<AdText[]>(cfg, scoped(`/rest/v1/ads?select=ad_key,platform,name,live,text:doc->>text${live ? '&live=is.true' : ''}&order=updated_at.desc&limit=1000`, user.co), { admin: true });
  if (!r.ok || !Array.isArray(r.data)) return json(500, { error: 'ما قدرت أقرأ الإعلانات' });
  return json(200, { ...scanAds(r.data), rules: RULES.map(({ id, level, title }) => ({ id, level, title })) });
}) };

export const check = { POST: handle(async (request, e) => {
  await requireUser(request, e, 'compliance', { write: true });
  const body = await readJson(request);
  const text = String(body.text || '').trim();
  if (!text) return json(400, { error: 'الصق نص الإعلان أول' });
  return json(200, { hits: checkText(text) });
}) };
