// The learning loop, switched on (docs/PRD.md §3.7, milestone M8; docs/learning-loops.md). Before: an action's 3- and 7-day result
// was measured only when someone opened the «توصيات القواعد» tab. Now the hourly trigger measures what is due, and:
//   - each rule's track record (7-day results) goes back onto its next recommendation («القاعدة نجحت 6 من 8»);
//   - a rule with enough results whose threshold looks too loose or too strict (tune() in learn.ts) becomes ONE lesson in
//     «وش تعلّمت» and the approvals center, waiting for Leen. Thresholds in playbook.ts never change by themselves: an approved
//     lesson is still a development PR (docs/media-buyer/learning-loop.md).
// Numbers only: no campaign names in lessons or logs. Reads ad rows and metrics; never talks to an ad platform.
import { sb, audit, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { readAll } from '../../lib/paging';
import { measureDue, type ActionRow } from './outcomes';
import { tune, type Outcome, type Tuning } from './learn';
import type { AdRow, MetricRow } from './buyer';

const riyadhToday = (now: number) => new Date(now + 3 * 3600e3).toISOString().slice(0, 10);
type OutRow = { action_id: string; day: number; platform: string; rec_rule: string | null; kind: string; before: Outcome['before']; after: Outcome['after'] };

/** Measures and saves what is due. Returns the number of new results, or null when the tables are not there. */
export async function measureNow(cfg: Cfg, co: string, now = Date.now()): Promise<number | null> {
  const today = riyadhToday(now), since = new Date(now - 45 * 864e5).toISOString().slice(0, 10);
  const acts = await sb<ActionRow[]>(cfg, scoped(`/rest/v1/buyer_actions?select=id,platform,entity_name,rec_rule,kind,status,applied_at,decided_at&status=in.(applied,manual_done)&created_at=gte.${since}&order=created_at.desc&limit=200`, co), { admin: true });
  if (!acts.ok || !Array.isArray(acts.data)) return null;
  if (!acts.data.length) return 0;
  const [have, ads, metrics] = await Promise.all([
    sb<{ action_id: string; day: number }[]>(cfg, scoped('/rest/v1/buyer_outcomes?select=action_id,day&limit=1000', co), { admin: true }),
    readAll<AdRow>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,campaign,name,goal,live', co), 'ad_key.asc'),
    readAll<MetricRow>(cfg, `/rest/v1/ad_metrics?select=ad_key,day,spend,impressions,clicks,leads,conversations&day=gte.${since}`, 'ad_key.asc,day.asc', 40),
  ]);
  if (!ads.ok || !metrics.ok) throw new Error('metrics_read_failed');
  const done = new Set((have.ok && Array.isArray(have.data) ? have.data : []).map(x => `${x.action_id}:${x.day}`));
  const due = measureDue(acts.data, ads.rows, metrics.rows, today, done);
  if (!due.length) return 0;
  const w = await sb(cfg, '/rest/v1/buyer_outcomes?on_conflict=action_id,day', { method: 'POST', admin: true, headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: due.map(d => ({ ...d, company_id: co })) });
  if (!w.ok) throw new Error('outcomes_write_failed');
  return due.length;
}

/** Each rule's 7-day track record, for the recommendation cards. */
export async function ruleHistory(cfg: Cfg, co: string): Promise<Tuning[]> {
  const r = await sb<OutRow[]>(cfg, scoped('/rest/v1/buyer_outcomes?select=action_id,day,platform,rec_rule,kind,before,after&day=eq.7&order=measured_at.desc&limit=500', co), { admin: true });
  if (!r.ok || !Array.isArray(r.data)) return [];
  return tune(r.data.map(x => ({ rule: (x.rec_rule ?? 'company') as Outcome['rule'], platform: x.platform, kind: x.kind as Outcome['kind'], days: 7, before: x.before, after: x.after, acted: true })));
}

/** One lesson per rule with a tuning proposal, unless one for the same rule is still open (new/reviewed). Returns how many were added. */
export async function proposeLessons(cfg: Cfg, co: string, tunings: Tuning[]): Promise<number> {
  const props = tunings.filter(t => t.proposal);
  if (!props.length) return 0;
  const open = await sb<{ evidence: { rule?: string } }[]>(cfg, scoped("/rest/v1/lessons?select=evidence&module=eq.ads&kind=eq.rule_tuning&active=eq.true&status=in.(new,reviewed)&limit=200", co), { admin: true });
  if (!open.ok) return 0;
  const busy = new Set((Array.isArray(open.data) ? open.data : []).map(x => String(x.evidence?.rule ?? '')));
  const fresh = props.filter(t => !busy.has(t.rule));
  if (!fresh.length) return 0;
  const w = await sb(cfg, '/rest/v1/lessons', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' }, body: fresh.map(t => ({
    company_id: co, module: 'ads', kind: 'rule_tuning', status: 'new', source: 'learning_loop', lesson: t.proposal,
    evidence: { rule: t.rule, n: t.n, worked: t.worked, worse: t.worse, knob: t.knob }, confidence: t.n >= 16 ? 0.8 : 0.6,
  })) });
  return w.ok ? fresh.length : 0;
}

/** The hourly job: measure, then propose. Well only (buyer_actions are Well's decision board). */
export async function runLearning(cfg: Cfg, co: string, now = Date.now()): Promise<{ measured: number | null; lessons: number }> {
  const measured = await measureNow(cfg, co, now);
  if (measured === null) return { measured, lessons: 0 };
  const lessons = await proposeLessons(cfg, co, await ruleHistory(cfg, co));
  if (measured || lessons) await audit(cfg, { email: 'system:learning-loop', co }, 'learning_loop_run', { target: { measured, lessons } });   // counts only
  return { measured, lessons };
}
