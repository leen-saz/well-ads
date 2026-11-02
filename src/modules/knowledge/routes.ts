// /api/knowledge/*: the company's knowledge for the AI modules. Reading needs view; adding and editing need edit;
// switching an entry on or off needs approve. An entry added or edited without approve waits off until an approver turns it on.
import { sb, json, readJson, handle, requireUser, audit, atLeast, NO_APPROVE } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { AI_MODULES, KINDS, clean, loadKnowledge, normalize, systemPrompt, type Entry } from './knowledge';

const rows = (d: unknown): Entry[] => (Array.isArray(d) ? (d as Entry[]) : []);

export const list = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'knowledge');
  const r = await sb<Entry[]>(cfg, scoped('/rest/v1/knowledge?select=*&order=active.desc,kind.asc,updated_at.desc&limit=500', user.co), { admin: true });
  if (!r.ok) return json(500, { error: 'ما قدرت أقرأ المعرفة' });
  return json(200, { entries: rows(r.data).map(normalize), kinds: KINDS, modules: AI_MODULES, canEdit: atLeast(user, 'knowledge', 'edit', cfg), canApprove: atLeast(user, 'knowledge', 'approve', cfg) });
}) };

// What one module's AI receives, exactly
export const preview = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'knowledge');
  const module = new URL(request.url).searchParams.get('module') || 'content';
  if (!(AI_MODULES as readonly string[]).includes(module)) return json(400, { error: 'موديول غير معروف' });
  return json(200, { module, system: systemPrompt(await loadKnowledge(cfg, user.co), module) });
}) };

export const entry = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge', { write: true });
    const c = clean(await readJson(request));
    if (!c.row) return json(400, { error: c.error });
    const active = atLeast(user, 'knowledge', 'approve', cfg);
    const r = await sb<Entry[]>(cfg, '/rest/v1/knowledge', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { ...c.row, company_id: user.co, active, created_by: user.email, updated_by: user.email } });
    if (!r.ok) return json(500, { error: 'ما انحفظ' });
    const row = rows(r.data)[0];
    await audit(cfg, user, 'knowledge_add', { target: { id: row?.id, kind: c.row.kind, active } });
    return json(200, { ok: true, entry: row, pending: !active });
  }),
  PATCH: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge', { write: true });
    const body = await readJson(request);
    const id = parseInt(String(body.id), 10);
    if (!id) return json(400, { error: 'طلب غير صحيح' });
    const approver = atLeast(user, 'knowledge', 'approve', cfg);
    let patch: Record<string, unknown>, act: string;
    if (typeof body.active === 'boolean' && body.kind === undefined) {
      if (!approver) return json(403, { error: NO_APPROVE });
      patch = { active: body.active }; act = body.active ? 'knowledge_on' : 'knowledge_off';
    } else {
      const c = clean(body);
      if (!c.row) return json(400, { error: c.error });
      // An edit by someone who cannot approve goes back to waiting
      patch = approver ? c.row : { ...c.row, active: false }; act = 'knowledge_edit';
    }
    const r = await sb<Entry[]>(cfg, scoped(`/rest/v1/knowledge?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' },
      body: { ...patch, updated_by: user.email, updated_at: new Date().toISOString() } });
    if (!r.ok) return json(500, { error: 'ما انحفظ' });
    const row = rows(r.data)[0];
    if (!row) return json(404, { error: 'غير موجود' });
    await audit(cfg, user, act, { target: { id, kind: row.kind, active: row.active } });
    return json(200, { ok: true, entry: row });
  }),
};
