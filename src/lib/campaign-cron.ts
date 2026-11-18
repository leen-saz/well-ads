// The campaign driver: «احلم» runs an approved campaign by itself, with no page open. Every 5 minutes (the existing social trigger, no new
// cron) it takes the campaigns an approver started (approved / running) and advances them with the SAME step the page loop calls
// (`advance` in src/api/routes/campaigns.ts): the same claim, the same compliance, the same caps. Nothing here approves, publishes or
// touches an ad account, and a campaign nobody approved never runs.
//   - one task claim is one conditional write (waiting -> running), so this driver and an open page never run a task twice;
//   - a budget per invocation (tasks and time) keeps one tick inside the Worker's limits: the next tick carries on;
//   - the emergency stop (control_settings.guardrails.kill) and the monthly caps stop it: a reached cap pauses the run, it never goes around it;
//   - it acts as the approver who approved the campaign (their permissions, their data), and only while that account is active.
import { env as authEnv, readProfile, sb, sessionFor, type AuthEnv, type Session } from './auth';
import { killOn } from './guardrails';
import { advance } from './campaign-step';
import type { LlmEnv } from './llm';
import type { AssetEnv } from './campaign-assets';

export const MAX_CAMPAIGNS = 5;      // campaigns looked at per tick
export const MAX_TASKS = 4;          // tasks run per tick, over all campaigns
export const BUDGET_MS = 20_000;     // no new task starts after this much time (a task itself can take longer)

export interface DriveResult { ran: number; campaigns: number; stopped?: 'kill' | 'budget'; paused: Record<string, string> }
type Env = AuthEnv & LlmEnv & AssetEnv;
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function driveCampaigns(e: Env, opts: { maxTasks?: number; budgetMs?: number; clock?: () => number } = {}): Promise<DriveResult> {
  const clock = opts.clock ?? Date.now, started = clock(), maxTasks = opts.maxTasks ?? MAX_TASKS, budget = opts.budgetMs ?? BUDGET_MS;
  const res: DriveResult = { ran: 0, campaigns: 0, paused: {} };
  let cfg: ReturnType<typeof authEnv>;
  try { cfg = authEnv(e); } catch { return res; }
  if (await killOn(cfg)) { res.stopped = 'kill'; return res; }
  const l = await sb<Row[]>(cfg, `/rest/v1/campaigns?select=id,company_id,approved_by,status&status=in.(approved,running)&approved_at=not.is.null&order=updated_at.asc&limit=${MAX_CAMPAIGNS}`, { admin: true });
  const list = l.ok && Array.isArray(l.data) ? l.data : [];
  const accounts = new Map<string, Session | null>();
  for (const c of list) {
    const id = String(c['id'] ?? '').toLowerCase(), who = String(c['approved_by'] ?? '').toLowerCase();
    if (!UUID.test(id) || !who) continue;
    res.campaigns++;
    if (!accounts.has(who)) accounts.set(who, await actAs(cfg, who));
    const user = accounts.get(who);
    if (!user) { res.paused[id] = 'approver'; continue; }
    // the campaign belongs to its own company: the approver's rights are only valid there
    if (c['company_id'] && String(c['company_id']) !== user.co) { res.paused[id] = 'company'; continue; }
    while (res.ran < maxTasks) {
      if (clock() - started > budget) { res.stopped = 'budget'; return res; }
      let r: Row;
      try { r = (await (await advance(e, cfg, user, id, '')).json()) as Row; } catch { res.paused[id] = 'error'; break; }
      if (r['ran']) res.ran++;
      if (r['paused']) { res.paused[id] = String(r['paused']); break; }      // a cap, no model, or a busy model: stop for this campaign, spend nothing more
      if (r['busy'] || r['done'] || r['more'] === false || r['error']) break;  // someone else has the task, nothing left, or an error: next campaign
    }
    if (res.ran >= maxTasks) { res.stopped = 'budget'; break; }
  }
  return res;
}

// The approver's account as a session, only while it is active
async function actAs(cfg: ReturnType<typeof authEnv>, email: string): Promise<Session | null> {
  const r = await sb<{ id?: string }[]>(cfg, `/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(email)}&limit=1`, { admin: true });
  const uid = r.ok && Array.isArray(r.data) ? r.data[0]?.id : null;
  if (!uid) return null;
  const read = await readProfile(cfg, uid);
  return read.kind === 'ok' && read.profile.active !== false ? sessionFor(read.profile, cfg) : null;
}
