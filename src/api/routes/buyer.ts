// /api/buyer/* (the «توصيات القواعد» tab of the decisions board, so it asks for the `control` dashboard): the media buyer's recommendations for the user's company, computed from stored numbers, and the approved-execution
// layer on top of them (src/modules/buyer/exec-routes.ts). `report` and `rules` below never talk to an ad platform; only exec/ does, and only after
// the owner's own approval. The company's rules and limits are saved by the owner into control_settings.guardrails.buyer (database, never the repo).
import { json, readJson, handle, requireUser, audit, sb } from '../../lib/auth';
import { cleanRules } from '../../modules/buyer/rules';
import { PLATS } from '../../modules/buyer/playbook';
import { buildReport, DB_KEY, settings } from '../../modules/buyer/report';
import { measureDue, type ActionRow } from '../../modules/buyer/outcomes';
import { tune, type Outcome } from '../../modules/buyer/learn';
import type { AdRow, MetricRow } from '../../modules/buyer/buyer';
import { scoped } from '../../lib/tenant';
import { readAll } from '../../lib/paging';
import { patchGuardrails } from '../../lib/guardrails';

export { actions, propose, decide, apply, rollback, execution } from '../../modules/buyer/exec-routes';

export const report = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'control');
  const b = await buildReport(cfg, user);
  if (!b.ok) return json(500, { error: 'ما قدرت أقرأ أرقام الإعلانات' });
  return json(200, { ...b.report, readOnly: true });
}) };

// Only the owner (Leen) reads and saves the company's rules («قواعد الإدارة» in the decisions board). Only the rule list changes; the stop line and ladder stay as they were.
export const rules = {
  GET: handle(async (request, e) => {
    const { cfg } = await requireUser(request, e, 'owner', { well: true });
    return json(200, { rules: (await settings(cfg)).rules });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true, well: true });
    const b = await readJson(request, 100_000);
    const c = cleanRules(b.rules);
    if ('error' in c) return json(400, { error: c.error });
    // A preview: the same validation, nothing saved
    if (b.dry === true) return json(200, { ok: true, dry: true, rules: c.rules });
    // Only the `buyer.rules` key of each platform row changes, on top of what the row holds now (a stop or limits saved meanwhile stay)
    for (const p of PLATS) {
      const rules = c.rules.filter(r => r.platform === p);
      const w = await patchGuardrails(cfg, DB_KEY[p], g => ({ ...g, buyer: { ...((g.buyer ?? {}) as Record<string, unknown>), rules } }), user.email);
      if (!w.ok) return json(500, { error: 'ما انحفظت القواعد' });
    }
    // counts only: the rules themselves (names, limits) never go to the log
    await audit(cfg, user, 'buyer_rules_saved', { target: { rules: c.rules.length } });
    return json(200, { ok: true, rules: c.rules.length });
  }),
};

// How the actions turned out, 3 and 7 days after (numbers only). GET reads what was measured and what it says about each rule's
// threshold (a proposal for a development PR, never applied by itself). POST measures what is due now, once per action and day.
type OutRow = { action_id: string; day: number; platform: string; rec_rule: string | null; kind: string; before: Outcome['before']; after: Outcome['after']; result: string; measured_at: string };
export const outcomes = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control');
    const r = await sb<OutRow[]>(cfg, scoped('/rest/v1/buyer_outcomes?select=action_id,day,platform,rec_rule,kind,before,after,result,measured_at&order=measured_at.desc&limit=200', user.co), { admin: true });
    if (!r.ok) return json(200, { rows: [], tuning: [], missing: true });
    const rows = Array.isArray(r.data) ? r.data : [];
    const names = await sb<{ id: string; entity_name: string | null }[]>(cfg, scoped('/rest/v1/buyer_actions?select=id,entity_name&order=created_at.desc&limit=300', user.co), { admin: true });
    const by = new Map((names.ok && Array.isArray(names.data) ? names.data : []).map(a => [a.id, a.entity_name]));
    const mapped: Outcome[] = rows.filter(x => x.day === 7).map(x => ({ rule: (x.rec_rule ?? 'company') as Outcome['rule'], platform: x.platform, kind: x.kind as Outcome['kind'], days: x.day, before: x.before, after: x.after, acted: true }));
    return json(200, { rows: rows.slice(0, 60).map(x => ({ ...x, entity: by.get(x.action_id) ?? null })), tuning: tune(mapped), missing: false });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control', { write: true, well: true });
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
    const acts = await sb<ActionRow[]>(cfg, scoped(`/rest/v1/buyer_actions?select=id,platform,entity_name,rec_rule,kind,status,applied_at,decided_at&status=in.(applied,manual_done)&created_at=gte.${since}&order=created_at.desc&limit=200`, user.co), { admin: true });
    if (!acts.ok || !Array.isArray(acts.data)) return json(200, { ok: true, measured: 0, missing: true });
    if (!acts.data.length) return json(200, { ok: true, measured: 0 });
    const [have, ads, metrics] = await Promise.all([
      sb<{ action_id: string; day: number }[]>(cfg, scoped('/rest/v1/buyer_outcomes?select=action_id,day&limit=1000', user.co), { admin: true }),
      readAll<AdRow>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,campaign,name,goal,live', user.co), 'ad_key.asc'),
      readAll<MetricRow>(cfg, `/rest/v1/ad_metrics?select=ad_key,day,spend,impressions,clicks,leads,conversations&day=gte.${since}`, 'ad_key.asc,day.asc', 40),
    ]);
    if (!ads.ok || !metrics.ok) return json(500, { error: 'ما قدرت أقرأ أرقام الإعلانات' });
    const done = new Set((have.ok && Array.isArray(have.data) ? have.data : []).map(x => `${x.action_id}:${x.day}`));
    const due = measureDue(acts.data, ads.rows, metrics.rows, today, done);
    if (due.length) {
      const w = await sb(cfg, '/rest/v1/buyer_outcomes?on_conflict=action_id,day', { method: 'POST', admin: true, headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: due.map(d => ({ ...d, company_id: user.co })) });
      if (!w.ok) return json(500, { error: 'ما انحفظت النتائج' });
      await audit(cfg, user, 'buyer_outcomes_measured', { target: { count: due.length } });   // a count only
    }
    return json(200, { ok: true, measured: due.length });
  }),
};
