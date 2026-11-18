// /api/journeys/*: the journeys of the user's company. Starting one creates a Cloudflare Workflow instance per customer.
import { sb, json, readJson, handle, requireUser, audit, type AuthEnv } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { killOn } from '../../lib/guardrails';
import { CHANNELS, cleanContact, cleanSteps, cleanWritten, notices, writePrompt, DAILY_PER_USER, DAILY_PER_CONTACT } from './journeys';
import { knowledgeFor, rulesFor, withKnowledge } from '../knowledge/knowledge';
import { check } from '../compliance/compliance';
import { generate, pick, type LlmEnv } from '../../lib/llm';
import { usageCtx } from '../../lib/usage';
import type { JourneyParams } from './workflow';

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
  return json(200, { ok: true, journey: rows(r.data)[0], notices: notices(c.steps, await rulesFor(cfg, user.co)) });
}) };

export const start = { POST: handle(async (request, e: WfEnv) => {
  // Starting a run sends real WhatsApp and Gmail messages to a customer: it is an approval, not an edit
  const { cfg, user } = await requireUser(request, e, 'journeys', { write: true, approve: true });
  const body = await readJson(request);
  const id = parseInt(String(body.id || ''), 10);
  const contact = cleanContact(body.contact);
  if (!id || !contact) return json(400, { error: 'اكتب جوال أو إيميل صحيح' });
  if (!e.JOURNEY) return json(503, { error: 'تشغيل الرحلات غير مفعّل في هالبيئة' });
  // The emergency stop stops customer messages too (an unreadable state counts as stop)
  if (await killOn(cfg)) return json(409, { error: 'زر الطوارئ شغّال، الإرسال موقوف' });
  const j = await sb<Row[]>(cfg, scoped(`/rest/v1/journeys?id=eq.${id}&select=id,steps,active,mode`, user.co), { admin: true });
  const journey = j.ok ? rows(j.data)[0] : undefined;
  if (!journey) return json(404, { error: 'رحلة غير معروفة' });
  // A journey saved as paused does not send, however it is called
  if (journey.active !== true) return json(409, { error: 'الرحلة موقوفة. فعّلها أول' });
  // Daily limits: per person starting runs, and per customer receiving them (a loop or a typo cannot spam anyone)
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const byUser = await sb<Row[]>(cfg, scoped(`/rest/v1/journey_runs?select=id&started_by=eq.${encodeURIComponent(user.email || '')}&started_at=gte.${since}&limit=${DAILY_PER_USER + 1}`, user.co), { admin: true });
  if (!byUser.ok) return json(500, { error: 'ما قدرت أتأكد من حد اليوم' });
  if (rows(byUser.data).length >= DAILY_PER_USER) return json(429, { error: `وصلت حد اليوم (${DAILY_PER_USER} تشغيل). جرّب بكرة` });
  const ors = [contact.phone ? `contact->>phone.eq.${contact.phone}` : '', contact.email ? `contact->>email.eq.${encodeURIComponent(contact.email)}` : ''].filter(Boolean).join(',');
  const toThem = await sb<Row[]>(cfg, scoped(`/rest/v1/journey_runs?select=id&started_at=gte.${since}&or=(${ors})&limit=${DAILY_PER_CONTACT + 1}`, user.co), { admin: true });
  if (!toThem.ok) return json(500, { error: 'ما قدرت أتأكد من حد اليوم' });
  if (rows(toThem.data).length >= DAILY_PER_CONTACT) return json(429, { error: 'هذا العميل وصله الحد اليوم. جرّب بكرة' });
  const run = await sb<Row[]>(cfg, '/rest/v1/journey_runs', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, journey_id: id, contact, started_by: user.email } });
  const runId = Number(rows(run.data)[0]?.id);
  if (!run.ok || !runId) return json(500, { error: 'ما بدأت الرحلة' });
  await e.JOURNEY.create({ id: `run-${runId}`, params: { runId, companyId: user.co, steps: journey.steps as JourneyParams['steps'], contact } });
  await audit(cfg, user, 'journey_started', { target: { id, run: runId } });
  return json(200, { ok: true, run: runId });
}) };

export const write = { POST: handle(async (request, e: AuthEnv & LlmEnv) => {
  const { cfg, user } = await requireUser(request, e, 'journeys', { write: true });
  const b = await readJson(request);
  const type = b.type === 'push' ? 'push' : b.type === 'email' ? 'email' : null;
  if (!type) return json(400, { error: 'الكتابة للإيميل والإشعار بس' });
  if (!pick(e, 'journeys')) return json(503, { error: 'الكتابة بالذكاء الاصطناعي غير مفعّلة في هالبيئة' });
  let out;
  try { out = await generate(e, 'journeys', { messages: withKnowledge([{ role: 'user', content: writePrompt(type, String(b.idea || '').slice(0, 1000), String(b.journey || '').slice(0, 120)) }], await knowledgeFor(cfg, user.co, 'journeys')), max_tokens: 900 }, fetch, usageCtx(cfg, user)); }
  catch { return json(503, { error: 'الذكاء الاصطناعي ما رد الحين، جرّب بعد دقيقة' }); }
  const w = cleanWritten(out.response, type);
  if (!w) return json(502, { error: 'ما طلع نص واضح، جرّب مرة ثانية' });
  return json(200, { ...w, compliance: check(`${w.head}\n${w.body}`, await rulesFor(cfg, user.co)) });
}) };
