// Read tools (scope read). The numbers come from the same functions as the read API /api/v1 (src/lib/apiv1.ts), so a tool and the API
// never disagree. Every read is Well's own data today (the read key belongs to Well).
import { sb } from '../../lib/auth';
import { readV1, V1_READS } from '../../lib/apiv1';
import { scoped } from '../../lib/tenant';
import { ToolFail, type Ctx, type Parsed, type Tool } from '../types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const obj = (a: unknown): Record<string, unknown> => (a && typeof a === 'object' && !Array.isArray(a) ? a as Record<string, unknown> : {});
const none = { type: 'object', properties: {}, additionalProperties: false };
const noInput = (): Parsed<Record<string, string>> => ({ ok: true, value: {} });

async function v1(ctx: Ctx, name: (typeof V1_READS)[number], params: Record<string, string> = {}): Promise<unknown> {
  const r = await readV1(name, ctx.env as never, ctx.cfg, params);
  if (r.status >= 500) throw new ToolFail('unavailable', 'The numbers are not available right now. Try again shortly.');
  if (r.status >= 400) throw new ToolFail('invalid', String((r.body as { error?: { message?: string } })?.error?.message || 'Invalid request.'));
  return r.body;
}

function period(args: unknown): Parsed<Record<string, string>> {
  const a = obj(args), out: Record<string, string> = {};
  for (const k of ['from', 'to'] as const) {
    if (a[k] === undefined) continue;
    if (typeof a[k] !== 'string' || !DAY.test(a[k] as string)) return { ok: false, error: `${k}: a day as YYYY-MM-DD` };
    out[k] = a[k] as string;
  }
  return { ok: true, value: out };
}

const read = <T,>(t: Omit<Tool<T>, 'write'>): Tool<T> => ({ ...t, write: false });

export const READ_TOOLS: Tool<Record<string, string>>[] = [
  read({ name: 'insights.overview.read', title: 'Performance overview', description: 'Spend, revenue, ROAS and orders for a period, per platform. Default: the last 30 days.',
    inputSchema: { type: 'object', properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } }, additionalProperties: false },
    parse: period, run: (ctx, p) => v1(ctx, 'overview', p) }),
  read({ name: 'ads.list', title: 'Ads', description: 'The ads with their latest numbers. Optional platform and status filters.',
    inputSchema: { type: 'object', properties: { platform: { type: 'string' }, status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 2000 } }, additionalProperties: false },
    parse: args => {
      const a = obj(args), out: Record<string, string> = {};
      for (const k of ['platform', 'status'] as const) {
        if (a[k] === undefined) continue;
        if (typeof a[k] !== 'string' || !/^[a-z_]{1,30}$/i.test(a[k] as string)) return { ok: false, error: `${k}: letters and _ only` };
        out[k] = a[k] as string;
      }
      if (a.limit !== undefined) {
        if (!Number.isInteger(a.limit) || (a.limit as number) < 1 || (a.limit as number) > 2000) return { ok: false, error: 'limit: 1 to 2000' };
        out.limit = String(a.limit);
      }
      return { ok: true, value: out };
    },
    run: (ctx, p) => v1(ctx, 'ads', p) }),
  read({ name: 'decisions.list', title: 'Buyer decisions', description: 'The media buyer’s suggested actions and their state.', inputSchema: none, parse: noInput, run: ctx => v1(ctx, 'decisions') }),
  read({ name: 'campaigns.list', title: 'Campaigns', description: 'The campaigns with their numbers.', inputSchema: none, parse: noInput, run: ctx => v1(ctx, 'campaigns') }),
  read({ name: 'data.health.read', title: 'Data freshness', description: 'How fresh each data source is.', inputSchema: none, parse: noInput, run: ctx => v1(ctx, 'health') }),
  read({ name: 'accounts.health.read', title: 'Account health', description: 'The last check of each connected account: ok, expiring, degraded or disconnected. Never a token.',
    inputSchema: none, parse: noInput,
    run: async ctx => {
      const r = await sb<unknown[]>(ctx.cfg, scoped('/rest/v1/account_health?select=platform,account_ref,status,probed,last_check_at,expires_at,error_code&order=platform', ctx.company), { admin: true });
      if (!r.ok) throw new ToolFail('unavailable', 'Account health is not available right now.');
      return { accounts: Array.isArray(r.data) ? r.data : [] };
    } }),
];
