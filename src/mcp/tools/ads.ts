// Ad write tools (docs/PRD.md §7 M12) in «بموافقتي» mode: a call never changes an ad account. It files a proposed action in
// buyer_actions, through the same propose() as the media buyer's recommendations (src/modules/buyer/exec/service.ts). The owner
// approves it in the approvals center, and only then does the existing execution path (guards, two-step confirm, read-back,
// rollback) touch the platform. «تلقائي» comes in M13; until then `mode` is always approve, whatever the caller.
import { propose } from '../../modules/buyer/exec/service';
import type { Rec } from '../../modules/buyer/buyer';
import type { ExecEnv } from '../adapters/ads';
import type { Session } from '../../lib/auth';
import { WELL_COMPANY } from '../../lib/tenant';
import { ToolFail, type Ctx, type Parsed, type Tool } from '../types';

export const HARD_PCT = 50;   // the hard ceiling on one budget change (docs/PRD.md Q14); the owner's own lower cap applies at approval
type Plat = 'meta' | 'snapchat';
type Budget = { platform: Plat; campaign: string; pct: number; reason: string };
type Status = { platform: Plat; campaign: string; to: 'paused' | 'active'; reason: string };

const obj = (a: unknown): Record<string, unknown> => (a && typeof a === 'object' && !Array.isArray(a) ? a as Record<string, unknown> : {});
function common(a: Record<string, unknown>, allowed: string[]): string | { platform: Plat; campaign: string; reason: string } {
  const extra = Object.keys(a).find(k => !allowed.includes(k));
  if (extra) return `Unknown field: ${extra}`;
  if (a.platform !== 'meta' && a.platform !== 'snapchat') return 'platform: meta or snapchat (TikTok and Google are changed by hand for now)';
  const campaign = typeof a.campaign === 'string' ? a.campaign.trim() : '';
  if (!campaign || campaign.length > 200) return 'campaign: the exact campaign name';
  const reason = typeof a.reason === 'string' ? a.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500) return 'reason: why, in a sentence (5 to 500 characters)';
  return { platform: a.platform, campaign, reason };
}

// The caller as the proposal's author: the signed-in person, or the agent by name (an agent has no session)
function who(ctx: Ctx): Session {
  return (ctx.user ? { ...ctx.user, co: ctx.company } : { uid: '', email: ctx.actor, name: ctx.actor, role: 'member', dash: [], depts: [], co: ctx.company, exp: 0, chk: 0 }) as Session;
}
function rec(p: Plat, campaign: string, reason: string, kind: Rec['kind'], act: Rec['act'], change: string, now: number): Rec {
  return { id: `mcp:${now.toString(36)}`, rule: 'company', platform: p, campaign, kind, title: change, change, why: reason, risk: '',
    success: { metric: 'cpl', goal: '', checkAfterDays: [3, 7] }, evidence: [], judge: null, priority: 0, confidence: 'medium', act, owner: 'media_buyer', readOnly: true } as Rec;
}
async function file(ctx: Ctx, r: Rec): Promise<unknown> {
  // The execution keys in the Worker are Well's ad accounts: no other company may file against them
  if (ctx.company !== WELL_COMPANY) throw new ToolFail('forbidden', 'Ad changes are for Well’s own accounts for now.');
  const o = await propose({ cfg: ctx.cfg, user: who(ctx), env: ctx.env as ExecEnv }, r);
  if (o.status !== 200) throw new ToolFail(o.status === 422 ? 'invalid' : 'failed', String(o.body.error || 'Not filed'));
  return { ...o.body, awaiting_approval: true, approvals: '/approvals/' };
}

const schema = (extra: Record<string, unknown>, req: string[]) => ({ type: 'object', additionalProperties: false, required: ['platform', 'campaign', 'reason', ...req],
  properties: { platform: { type: 'string', enum: ['meta', 'snapchat'] }, campaign: { type: 'string', description: 'The exact campaign name' }, reason: { type: 'string' }, ...extra } });

export const ADS_TOOLS: Tool<never>[] = [
  { name: 'ads.budget.change', title: 'Propose a budget change', write: true, money: true,
    description: `Files a proposal to change a campaign's daily budget by a percentage (−${HARD_PCT}% to +${HARD_PCT}%). Nothing changes until the owner approves it.`,
    inputSchema: schema({ pct: { type: 'number', minimum: -HARD_PCT, maximum: HARD_PCT } }, ['pct']),
    parse(args): Parsed<Budget> {
      const a = obj(args), c = common(a, ['platform', 'campaign', 'pct', 'reason']);
      if (typeof c === 'string') return { ok: false, error: c };
      const pct = Number(a.pct);
      if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > HARD_PCT) return { ok: false, error: `pct: a non-zero change between −${HARD_PCT} and ${HARD_PCT}` };
      return { ok: true, value: { ...c, pct: Math.round(pct) } };
    },
    run: (ctx, i: Budget) => file(ctx, rec(i.platform, i.campaign, i.reason, i.pct > 0 ? 'budget_up' : 'budget_down', { op: 'budget_pct', pct: i.pct }, `${i.pct > 0 ? '+' : ''}${i.pct}%`, Date.now())),
  } as Tool<Budget>,
  { name: 'ads.status.change', title: 'Propose pausing or resuming a campaign', write: true, money: true,
    description: 'Files a proposal to pause or resume a campaign. Nothing changes until the owner approves it.',
    inputSchema: schema({ to: { type: 'string', enum: ['paused', 'active'] } }, ['to']),
    parse(args): Parsed<Status> {
      const a = obj(args), c = common(a, ['platform', 'campaign', 'to', 'reason']);
      if (typeof c === 'string') return { ok: false, error: c };
      if (a.to !== 'paused' && a.to !== 'active') return { ok: false, error: 'to: paused or active' };
      return { ok: true, value: { ...c, to: a.to } };
    },
    run: (ctx, i: Status) => file(ctx, rec(i.platform, i.campaign, i.reason, i.to === 'paused' ? 'pause' : 'resume', { op: 'status', to: i.to }, i.to, Date.now())),
  } as Tool<Status>,
] as Tool<never>[];
