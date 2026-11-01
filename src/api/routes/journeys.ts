// /api/journeys/*: the journeys of the user's company. Starting one creates a Cloudflare Workflow instance per customer.
import { sb, json, readJson, handle, requireUser, audit, type AuthEnv } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { CHANNELS, cleanContact, cleanSteps, notices } from '../../lib/journeys';
import type { JourneyParams } from '../../lib/journey-workflow';

type Row = Record<string, unknown>;
type WfEnv = AuthEnv & { JOURNEY?: { create(o: { id: string; params: JourneyParams }): Promise<unknown> } };
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);

export const list = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'journeys');
  const j = await sb(cfg, scoped('/rest/v1/journeys?select=*&order=created_at.desc&limit=200', user.co), { admin: true });
  const r = await sb(cfg, scoped('/rest/v1/journey_runs?select=id,journey_id,contact,status,log,started_at&order=started_at.desc&limit=100', user.co), { admin: true });
  return j.ok && r.ok ? json(200, { journeys: j.data, runs: r.data, channels: CHANNELS }) : json(500, { error: 'ما قدرت أقرأ الرحلات' });
}) };

export const save = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'journeys', { write: true });
  const body = await readJson(request);
  const name = String(body.name || '').trim().slice(0, 120);
  if (!name) return json(400, { error: 'سمّ الرحلة' });
  const c = cleanSteps(body.steps);
  if (!c.steps) return json(400, { error: c.error });
  const rec = { name, steps: c.steps, trigger: body.trigger === 'lead_created' ? 'lead_created' : 'manual', mode: body.mode === 'auto' ? 'auto' : 'manual', active: !!body.active };
  const id = parseInt(String(body.id || ''), 10);
  const r = id
    ? await sb<Row[]>(cfg, scoped(`/rest/v1/journeys?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: rec })
    : await sb<Row[]>(cfg, '/rest/v1/journeys', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: { ...rec, company_id: user.co, created_by: user.email } });
  if (!r.ok || !rows(r.data).length) return json(400, { error: 'ما انحفظت الرحلة' });
  await audit(cfg, user, 'journey_saved', { target: { id: rows(r.data)[0]?.id, name, mode: rec.mode } });
  return json(200, { ok: true, journey: rows(r.data)[0], notices: notices(c.steps) });
}) };

export const start = { POST: handle(async (request, e: WfEnv) => {
  const { cfg, user } = await requireUser(request, e, 'journeys', { write: true });
  const body = await readJson(request);
  const id = parseInt(String(body.id || ''), 10);
  const contact = cleanContact(body.contact);
  if (!id || !contact) return json(400, { error: 'اكتب جوال أو إيميل صحيح' });
  if (!e.JOURNEY) return json(503, { error: 'تشغيل الرحلات غير مفعّل في هالبيئة' });
  const j = await sb<Row[]>(cfg, scoped(`/rest/v1/journeys?id=eq.${id}&select=id,steps`, user.co), { admin: true });
  const journey = j.ok ? rows(j.data)[0] : undefined;
  if (!journey) return json(404, { error: 'رحلة غير معروفة' });
  const run = await sb<Row[]>(cfg, '/rest/v1/journey_runs', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, journey_id: id, contact, started_by: user.email } });
  const runId = Number(rows(run.data)[0]?.id);
  if (!run.ok || !runId) return json(500, { error: 'ما بدأت الرحلة' });
  await e.JOURNEY.create({ id: `run-${runId}`, params: { runId, companyId: user.co, steps: journey.steps as JourneyParams['steps'], contact } });
  await audit(cfg, user, 'journey_started', { target: { id, run: runId } });
  return json(200, { ok: true, run: runId });
}) };
