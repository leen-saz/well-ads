// /api/lessons/list. Learning loop per tab (docs/learning-loops.md, L1): the "what I learned" card of any tab.
// GET ?module=<tab> reads that tab's lessons (its view level); PATCH { id, action: approve | ignore } decides one
// (its approve level). Every query is scoped to the user's company.
import { sb, json, readJson, handle, requireUser, audit, can, atLeast, missingSchema, notApplied, NO_APPROVE } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { needOf, decision } from '../../lib/lessons';

type Row = Record<string, unknown>;
const KEY = /^[a-z]+$/;

export const list = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any');
    const module = new URL(request.url).searchParams.get('module') || '';
    const need = KEY.test(module) ? needOf(module) : null;
    if (!need) return json(400, { error: 'تاب غير معروف' });
    if (!can(user, need, cfg)) return json(403, { error: 'ما عندك صلاحية' });
    const r = await sb<Row[]>(cfg, scoped(`/rest/v1/lessons?select=id,kind,lesson,evidence,confidence,source,status,decided_by,decided_at,created_at&module=eq.${module}&active=eq.true&status=in.(new,reviewed,approved)&order=created_at.desc&limit=50`, user.co), { admin: true });
    if (!r.ok) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied('migration 014_lessons_by_tab.sql') : 'ما قدرت أقرأ الدروس' });
    return json(200, { lessons: r.data, canDecide: atLeast(user, need, 'approve', cfg) });
  }),
  PATCH: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any', { write: true });
    const body = await readJson(request);
    const module = String(body.module || '');
    const need = KEY.test(module) ? needOf(module) : null;
    const id = parseInt(String(body.id), 10);
    const status = decision(body.action);
    if (!need || !id || !status) return json(400, { error: 'طلب غير صحيح' });
    if (!can(user, need, cfg)) return json(403, { error: 'ما عندك صلاحية' });
    if (!atLeast(user, need, 'approve', cfg)) return json(403, { error: NO_APPROVE });
    const r = await sb<Row[]>(cfg, scoped(`/rest/v1/lessons?id=eq.${id}&module=eq.${module}&status=in.(new,reviewed)`, user.co),
      { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { status, decided_by: user.email, decided_at: new Date().toISOString() } });
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) return json(409, { error: 'الدرس انحسم قبل' });
    await audit(cfg, user, status === 'approved' ? 'lesson_approved' : 'lesson_ignored', { target: { id, module } });
    return json(200, { ok: true, lesson: r.data[0] });
  }),
};
