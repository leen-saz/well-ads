// /api/listening/demand: leads per source in the chosen period (?from=&to=, Riyadh days; default the last 14 days read as 7 against 7)
// against the same length before it (CRM), a demand signal next to the organic analysis.
// The organic analysis itself runs in the browser (public/modules/listening/analyze.js). Read-only.
import { sb, json, handle, requireUser } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { readAll } from '../../lib/paging';
import { weekly, type Lead } from './listening';
import { readJson } from '../../lib/auth';
import { parseRangeParams, rangeMs, MAX_SPAN } from '../../../public/assets/period.js';
import { adLibraryUrl, cleanWatch, due, missingTable, sources, type Mention, type Watch } from './social';
import { batch, collect, store, type ListenEnv } from './fetcher';
export { probe } from './probe';

export const demand = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'listening');
  const u = new URL(request.url);
  const r = parseRangeParams(k => u.searchParams.get(k), Date.now(), { days: 7 });
  if ('error' in r) return json(400, { error: 'الفترة مو صحيحة' });
  const [fromMs, toMs] = rangeMs(r.from, r.to), span = r.days;
  const since = new Date(fromMs - span * 864e5).toISOString(), until = new Date(toMs).toISOString();
  // no CRM table yet: the page still shows the organic side
  const { rows: out } = await readAll<Lead>(cfg, scoped(`/rest/v1/crm_leads?select=source_platform,created_at&created_at=gte.${since}&created_at=lt.${until}`, user.co), 'lead_id.asc', 10);
  return json(200, { sources: weekly(out, toMs, span) });
}) };

// What a user is told when the listening tables are not there yet
const notReady = (user: { role: string }) => (user.role === 'owner' ? 'الرصد ما اكتمل تجهيزه. التفاصيل في صفحة صحة الداتا.' : 'الرصد ما اكتمل تجهيزه، بلّغ الإدارة.');

// ---- Social listening: watch lists, mentions, refresh. Tables from migration 013; without them the page says setup is not finished (details only on the owner's data-health page).

export const watch = {
  GET: handle(async (request, e: ListenEnv) => {
    const { cfg, user } = await requireUser(request, e, 'listening');
    const r = await sb<(Watch & { id: number })[]>(cfg, scoped('/rest/v1/listen_watch?select=id,kind,name,keywords,links,fetched_at&order=kind.asc,name.asc', user.co), { admin: true });
    // The tables are missing: no SQL goes to the browser. The owner is pointed to the data-health page, everyone else to the owner
    if (missingTable(r)) return json(200, { missing: true, owner: user.role === 'owner', sources: sources(e), watches: [] });
    const watches = (r.ok && Array.isArray(r.data) ? r.data : []).map(w => ({ ...w, adlibrary: w.kind === 'competitor' ? (w.links?.adlibrary || adLibraryUrl(w.name)) : null }));
    return json(200, { missing: false, owner: user.role === 'owner', sources: sources(e), watches });
  }),
  POST: handle(async (request, e: ListenEnv) => {
    const { cfg, user } = await requireUser(request, e, 'listening', { write: true });
    const b = await readJson(request);
    const w = cleanWatch(b);
    if (!w) return json(400, { error: 'اختر النوع واكتب الاسم' });
    const id = Number(b.id) || 0;
    const r = id
      ? await sb(cfg, scoped(`/rest/v1/listen_watch?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: w })
      : await sb(cfg, '/rest/v1/listen_watch', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: { ...w, company_id: user.co, created_by: user.email } });
    if (missingTable(r)) return json(409, { error: notReady(user) });
    if (!r.ok) return json(502, { error: 'ما انحفظ، جرّب مرة ثانية' });
    return json(200, { ok: true, watch: Array.isArray(r.data) ? r.data[0] : null });
  }),
};

export const unwatch = { POST: handle(async (request, e: ListenEnv) => {
  const { cfg, user } = await requireUser(request, e, 'listening', { write: true });
  const id = Number((await readJson(request)).id) || 0;
  if (!id) return json(400, { error: 'ما فيه شي محدد' });
  const r = await sb(cfg, scoped(`/rest/v1/listen_watch?id=eq.${id}`, user.co), { method: 'DELETE', admin: true });
  return r.ok ? json(200, { ok: true }) : json(502, { error: 'ما انحذف، جرّب مرة ثانية' });
}) };

// Mentions in the chosen period (?from=&to=, Riyadh days, at most a year; default the last 90 days), newest first, at most 600.
// The page computes share of voice, trends and alerts. Mentions with no date come along: the page dates them by when they were found.
export const mentions = { GET: handle(async (request, e: ListenEnv) => {
  const { cfg, user } = await requireUser(request, e, 'listening');
  const u = new URL(request.url);
  const range = parseRangeParams(k => u.searchParams.get(k), Date.now(), { days: 90, maxDays: MAX_SPAN });
  if ('error' in range) return json(400, { error: 'الفترة مو صحيحة' });
  const [fromMs, toMs] = rangeMs(range.from, range.to);
  const since = new Date(fromMs).toISOString(), until = new Date(toMs).toISOString();
  const r = await sb<Mention[]>(cfg, scoped(`/rest/v1/listen_mentions?select=id,watch_id,source,url,title,snippet,author,published_at,sentiment,reason,fetched_at&or=(and(published_at.gte.${since},published_at.lt.${until}),published_at.is.null)&order=published_at.desc.nullslast&limit=600`, user.co), { admin: true });
  if (missingTable(r)) return json(200, { missing: true, mentions: [] });
  return json(200, { missing: false, mentions: r.ok && Array.isArray(r.data) ? r.data : [] });
}) };

// "Refresh now": the due watches that fit the subrequest budget, at most 3 (or one named watch, even if not due)
export const refresh = { POST: handle(async (request, e: ListenEnv) => {
  const { cfg, user } = await requireUser(request, e, 'listening', { write: true });
  const id = Number((await readJson(request)).id) || 0;
  const r = await sb<(Watch & { id: number })[]>(cfg, scoped(`/rest/v1/listen_watch?select=*${id ? `&id=eq.${id}` : ''}&order=fetched_at.asc.nullsfirst&limit=10`, user.co), { admin: true });
  if (missingTable(r)) return json(409, { error: notReady(user) });
  const all = (r.ok && Array.isArray(r.data) ? r.data : []).filter(w => id || due(w));
  const list = id ? all.slice(0, 1) : batch(all);
  if (!list.length) return json(200, { ok: true, ran: 0, added: 0, note: 'كل الكلمات انحدّثت آخر 24 ساعة' });
  let added = 0, scored = 0;
  const report: Record<string, Record<string, number | string>> = {};
  for (const w of list) {
    const got = await collect(w, e);
    const s = await store(cfg, user.co, w, got.found, e);
    added += s.added; scored += s.scored; report[w.name] = got.bySource;
  }
  return json(200, { ok: true, ran: list.length, added, scored, report });
}) };
