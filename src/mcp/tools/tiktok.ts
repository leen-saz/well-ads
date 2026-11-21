// TikTok read tools (M14): campaigns, ads and the daily ad report, straight from TikTok's MCP server through the adapter.
// Read scope; the advertiser is the configured one only (src/mcp/adapters/tiktok.ts), never an argument.
import { advertiserOf, forgetToken, tiktokSession, TikTokError, type TikTokEnv } from '../adapters/tiktok';
import { ToolFail, type Ctx, type Parsed, type Tool } from '../types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 30;   // report_integrated_get takes at most 30 days per call
const AD_FIELDS = ['ad_id', 'ad_name', 'campaign_id', 'campaign_name', 'adgroup_id', 'adgroup_name', 'operation_status', 'secondary_status'];
const CAMPAIGN_FIELDS = ['campaign_id', 'campaign_name', 'objective_type', 'operation_status', 'budget', 'budget_mode'];
const METRICS = ['spend', 'impressions', 'clicks', 'conversion'];

const MSG: Record<TikTokError['code'], [ToolFail['code'], string]> = {
  not_connected: ['unavailable', 'TikTok is not connected. Connect it from the Connectors page.'],
  no_advertiser: ['unavailable', 'The TikTok ad account to read is not set yet (TIKTOK_ADVERTISER_ID).'],
  excluded: ['forbidden', 'This TikTok ad account is excluded.'],
  token: ['unavailable', 'TikTok refused the sign-in. Reconnect TikTok from the Connectors page.'],
  rotated_not_saved: ['unavailable', 'TikTok issued a new sign-in that could not be saved. Reconnect TikTok from the Connectors page.'],
  refused: ['forbidden', 'Only read calls are allowed.'],
  platform: ['unavailable', 'TikTok did not answer. Try again shortly.'],
};
async function withTikTok<T>(ctx: Ctx, fn: (m: Awaited<ReturnType<typeof tiktokSession>>, adv: string) => Promise<T>): Promise<T> {
  try {
    const adv = advertiserOf(ctx.env as TikTokEnv);
    return await fn(await tiktokSession(ctx.cfg, ctx.company, fetch), adv);
  } catch (e) {
    if (e instanceof TikTokError) {
      if (e.code === 'token') forgetToken(ctx.company);
      const [code, msg] = MSG[e.code]; throw new ToolFail(code, msg); }
    throw e;
  }
}
const obj = (a: unknown): Record<string, unknown> => (a && typeof a === 'object' && !Array.isArray(a) ? a as Record<string, unknown> : {});
const none = { type: 'object', properties: {}, additionalProperties: false };
const ok = <T,>(value: T): Parsed<T> => ({ ok: true, value });

type Period = { from: string; to: string };
export function parsePeriod(args: unknown, now = Date.now()): Parsed<Period> {
  const a = obj(args);
  const to = a.to === undefined ? new Date(now + 3 * 3600_000).toISOString().slice(0, 10) : a.to;   // Riyadh today
  if (typeof to !== 'string' || !DAY.test(to)) return { ok: false, error: 'to: a day as YYYY-MM-DD' };
  const from = a.from === undefined ? new Date(Date.parse(to) - 6 * 864e5).toISOString().slice(0, 10) : a.from;
  if (typeof from !== 'string' || !DAY.test(from)) return { ok: false, error: 'from: a day as YYYY-MM-DD' };
  const span = (Date.parse(to) - Date.parse(from)) / 864e5 + 1;
  if (!(span >= 1)) return { ok: false, error: 'from must be on or before to' };
  if (span > MAX_DAYS) return { ok: false, error: `At most ${MAX_DAYS} days per call` };
  return ok({ from, to });
}

const read = <T,>(t: Omit<Tool<T>, 'write'>): Tool<T> => ({ ...t, write: false });
export const TIKTOK_TOOLS: Tool<never>[] = [
  read<Record<string, never>>({ name: 'tiktok.campaigns.list', title: 'TikTok campaigns', description: 'Campaigns of the TikTok ad account: name, objective, status, budget.',
    inputSchema: none, parse: () => ok({}),
    run: ctx => withTikTok(ctx, async (m, adv) => ({ campaigns: await m.pages('campaign_get', { advertiser_id: adv, fields: CAMPAIGN_FIELDS, filtering: { primary_status: 'STATUS_ALL' } }) })) }),
  read<Record<string, never>>({ name: 'tiktok.ads.list', title: 'TikTok ads', description: 'Ads of the TikTok ad account with their campaign, ad group and status.',
    inputSchema: none, parse: () => ok({}),
    run: ctx => withTikTok(ctx, async (m, adv) => ({ ads: await m.pages('ad_get', { advertiser_id: adv, fields: AD_FIELDS, filtering: { primary_status: 'STATUS_ALL' } }) })) }),
  read<Period>({ name: 'tiktok.report.read', title: 'TikTok daily report', description: `Spend, impressions, clicks and conversions per ad and day. Default: the last 7 days; at most ${MAX_DAYS} days.`,
    inputSchema: { type: 'object', properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } }, additionalProperties: false },
    parse: a => parsePeriod(a),
    run: (ctx, p) => withTikTok(ctx, async (m, adv) => ({ from: p.from, to: p.to, rows: await m.pages('report_integrated_get', {
      advertiser_id: adv, report_type: 'BASIC', data_level: 'AUCTION_AD', dimensions: ['ad_id', 'stat_time_day'], metrics: METRICS, start_date: p.from, end_date: p.to }) })) }),
] as Tool<never>[];
