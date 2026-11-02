// /api/knowledge/*: the company's knowledge for the AI modules. Reading needs view; adding and editing need edit;
// switching an entry on or off needs approve. An entry added or edited without approve waits off until an approver turns it on.
import { sb, json, readJson, handle, requireUser, audit, atLeast, NO_APPROVE, type AuthEnv, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { AI_MODULES, KINDS, clean, loadKnowledge, normalize, systemPrompt, type Entry } from './knowledge';
import { QUESTIONS, answerRow, followUp, nextQuestion } from './training';
import { check, type Hit } from '../compliance/compliance';
import type { AiRun } from '../content/content';

type AiEnv = AuthEnv & { AI?: { run: AiRun } };
const rows = (d: unknown): Entry[] => (Array.isArray(d) ? (d as Entry[]) : []);
// Claims, references and winning ads the AI will learn from: checked like any ad copy, as a notice (forbidden words are not ad copy)
const comply = (row: Pick<Entry, 'kind' | 'body'>): Hit[] => (row.kind === 'forbidden' ? [] : check(row.body));
const all = (cfg: Cfg, co: string) => sb<Entry[]>(cfg, scoped('/rest/v1/knowledge?select=*&order=active.desc,kind.asc,updated_at.desc&limit=500', co), { admin: true });

export const list = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'knowledge');
  const r = await all(cfg, user.co);
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
    return json(200, { ok: true, entry: row, pending: !active, compliance: comply(c.row) });
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
    return json(200, { ok: true, entry: row, compliance: act === 'knowledge_edit' ? comply(row) : [] });
  }),
};

// Training chat. GET: the answers so far and the next question (fixed ones first, then the AI's, until it says done).
// skip = topics the trainer passed on this visit. POST: one answer saved as a knowledge entry (same approval rule as entry).
export const train = {
  GET: handle(async (request, e: AiEnv) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge');
    const r = await all(cfg, user.co);
    if (!r.ok) return json(500, { error: 'ما قدرت أقرأ المعرفة' });
    const entries = rows(r.data).map(normalize);
    const skip = (new URL(request.url).searchParams.get('skip') || '').split(',').filter(Boolean).slice(0, 50);
    const history = entries.filter(x => x.source === 'training').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map(x => ({ id: x.id, question: x.question, answer: x.body, active: x.active, topic: x.topic }));
    let next = nextQuestion(entries, skip);
    // The AI asks only for someone who can answer, and only after the fixed questions
    if (!next && atLeast(user, 'knowledge', 'edit', cfg)) {
      next = await followUp(e.AI ? (m, i) => e.AI!.run(m, i) : undefined, entries.filter(x => x.active), history.map(h => String(h.question || '')));
    }
    const covered = QUESTIONS.filter(q => entries.some(x => x.topic === q.topic)).length;
    return json(200, { history, next, covered, total: QUESTIONS.length, canEdit: atLeast(user, 'knowledge', 'edit', cfg) });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge', { write: true });
    const a = answerRow(await readJson(request));
    if (!a.row) return json(400, { error: a.error });
    const active = atLeast(user, 'knowledge', 'approve', cfg);
    const r = await sb<Entry[]>(cfg, '/rest/v1/knowledge', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { ...a.row, company_id: user.co, active, created_by: user.email, updated_by: user.email } });
    if (!r.ok) return json(500, { error: 'ما انحفظ' });
    const row = rows(r.data)[0];
    await audit(cfg, user, 'knowledge_train', { target: { id: row?.id, topic: a.row.topic, active } });
    return json(200, { ok: true, entry: row, pending: !active, compliance: comply(a.row) });
  }),
};
