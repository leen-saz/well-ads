// How each action Leen took from a recommendation turned out: the campaign's numbers in the days before it against the 3 and 7
// days after (CPL, click rate, spend, results), and a verdict (learn.ts). Pure: no network. The routes read the rows and save the
// result; the learning loop reads the pile to propose a change to a rule as a development PR. Numbers only, no campaign names.
import { judgeOutcome, type Result, type Window } from './learn';
import { platOf, type AdRow, type MetricRow } from './buyer';
import type { Plat, RuleId } from './playbook';

export interface ActionRow { id: string; platform: string; entity_name: string | null; rec_rule: string | null; kind: string; status: string; applied_at: string | null; decided_at: string | null }
export interface Measured { action_id: string; day: 3 | 7; platform: Plat; rec_rule: string | null; kind: string; before: Window; after: Window; result: Result | 'unclear' }

const DAY = 864e5;
const add = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);

// The day the change took effect in Saudi time (applied_at for a change the system made, the day she marked it for one done by hand)
export const effectiveDay = (a: ActionRow): string | null => { const t = a.applied_at ?? a.decided_at; return t ? new Date(Date.parse(t) + 3 * 3600e3).toISOString().slice(0, 10) : null; };

function window(rows: MetricRow[], from: string, to: string): Window {
  let spend = 0, impr = 0, clicks = 0, leads = 0;
  for (const m of rows) if (m.day >= from && m.day <= to) { spend += num(m.spend); impr += num(m.impressions); clicks += num(m.clicks); leads += num(m.leads) + num(m.conversations); }
  return { spend, impr, leads, cpl: leads > 0 ? spend / leads : null, ctr: impr > 0 ? (100 * clicks) / impr : null };
}

// Measures what is due: an action done on day D has its 3-day result once D+3 is over, and its 7-day one once D+7 is over. `done`
// holds "actionId:day" already saved, so nothing is measured twice. Only changes that happened (applied, or done by hand) count.
export function measureDue(actions: ActionRow[], ads: AdRow[], metrics: MetricRow[], today: string, done: Set<string>): Measured[] {
  const byCamp = new Map<string, Set<string>>();
  for (const a of ads) { const p = platOf(a.platform || ''); if (!p || !a.campaign) continue; const k = `${p}|${a.campaign.toLowerCase()}`; (byCamp.get(k) ?? byCamp.set(k, new Set()).get(k)!).add(a.ad_key); }
  const out: Measured[] = [];
  for (const a of actions) {
    if (a.status !== 'applied' && a.status !== 'manual_done') continue;
    const d0 = effectiveDay(a), p = platOf(a.platform);
    if (!d0 || !p || !a.entity_name) continue;
    const keys = byCamp.get(`${p}|${a.entity_name.toLowerCase()}`); if (!keys) continue;
    const rows = metrics.filter(m => keys.has(m.ad_key));
    for (const day of [3, 7] as const) {
      if (done.has(`${a.id}:${day}`) || add(d0, day) > add(today, -1)) continue;       // not over yet
      const before = window(rows, add(d0, -day), add(d0, -1)), after = window(rows, add(d0, 1), add(d0, day));
      const rule = (a.rec_rule ?? 'company') as RuleId;
      const result = judgeOutcome({ rule, platform: p, kind: a.kind as never, days: day, before, after, acted: true });
      out.push({ action_id: a.id, day, platform: p, rec_rule: a.rec_rule, kind: a.kind, before, after, result: result === 'not_acted' ? 'unclear' : result });
    }
  }
  return out;
}
