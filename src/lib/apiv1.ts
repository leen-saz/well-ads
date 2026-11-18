// /api/v1/*: the dashboard's numbers as JSON for tools and agents, read-only, behind one static key (src/lib/readkey.ts, docs/api-v1.md).
// This router is the only code a key reaches. It calls read helpers and never a write path; it is separate from every other /api route,
// which keep asking for the browser session. The gate lets /api/v1/* through without a session (src/lib/gate.ts), so everything under
// that prefix, including unknown paths, is authenticated here first and fails closed.
import { sb, json, missingSchema, type Cfg } from './auth';
import { authenticate, type KeyEnv } from './readkey';
import { WELL_COMPANY, scoped } from './tenant';
import { dataStatus, type StatusBucket } from './datastatus';
import { J, judgeInput, resolveTargets } from '../modules/overview/judge';
import { outcome } from '../modules/overview/analytics';
import { addDays, lastDay, type Dash } from '../modules/overview/numbers';
import { openapi } from './apiv1-openapi';

type Env = KeyEnv & { FILES?: R2Bucket };
type Row = Record<string, unknown>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HEADERS = { 'cache-control': 'private, no-store' };
const reply = (status: number, body: unknown, extra: Record<string, string> = {}) => json(status, body, { ...HEADERS, ...extra });
const err = (status: number, code: string, message: string, extra: Record<string, string> = {}) => reply(status, { error: code, message }, extra);
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const omit = <T extends object>(o: T, ...keys: string[]): Row => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

// ---- dash.json: Well's file is site/dash.json (what the overview serves); another company reads its own copy or nothing
type Parsed = Dash & { rows_cols?: { k: string[]; d: string[]; c: unknown[][] }; crm?: { rows?: unknown[][]; paid_all?: unknown[][]; [k: string]: unknown }; aud?: unknown };
async function loadDash(e: Env): Promise<Parsed | null> {
  if (!e.FILES) return null;
  const obj = await e.FILES.get('site/dash.json');
  if (!obj) return null;
  let d: Parsed;
  try { d = await obj.json() as Parsed; } catch { return null; }
  if (!d || typeof d !== 'object') return null;
  // The page ships the daily rows column-wise (pipeline/dash_split.py); this puts them back as [ad, day, spend, impr, clicks, leads, conv]
  const rc = d.rows_cols;
  if (!d.rows && rc && Array.isArray(rc.c) && Array.isArray(rc.k) && Array.isArray(rc.d)) {
    const [ki, di] = rc.c as number[][];
    d.rows = (ki ?? []).map((k, i) => [rc.k[k] as string, rc.d[(di as number[])[i] as number] as string, ...rc.c.slice(2).map(col => (col as unknown[])[i])]);
  }
  return d;
}
// The CRM block as totals: no lead rows, no per-lead days or amounts. Per ad only counts and the sum paid.
function crmSummary(d: Parsed): Row | undefined {
  const c = d.crm;
  if (!c || typeof c !== 'object') return undefined;
  const byAd: Record<string, { leads: number; paid: number; paid_sar: number }> = {};
  for (const r of rows(c.rows)) {
    const a = byAd[String(r[0])] ??= { leads: 0, paid: 0, paid_sar: 0 };
    a.leads++;
    if (r[3]) { a.paid++; a.paid_sar += num(r[4]); }
  }
  for (const a of Object.values(byAd)) a.paid_sar = Math.round(a.paid_sar * 100) / 100;
  return { ...omit(c, 'rows', 'paid_all'), matched_leads: rows(c.rows).length, closings_total: rows(c.paid_all).length, by_ad: byAd };
}
const cleanDash = (d: Parsed): Row => {
  const rest = omit(d, 'crm', 'aud', 'rows_cols', 'rows', 'ads');
  // The audience detail per ad (aud) is a separate file in the pipeline; it is dropped here if one slipped in
  const ads = Object.fromEntries(Object.entries(d.ads ?? {}).map(([k, a]) => [k, omit(a, 'aud')]));
  const out: Row = { ...rest, ads, rows: d.rows ?? [] };
  const crm = crmSummary(d);
  if (crm) out.crm = crm;
  return out;
};
const missingDash = () => err(404, 'not_found', 'No dashboard data yet.');

function period(d: Dash, q: URLSearchParams): { from: string; to: string } | Response {
  const to0 = q.get('to'), from0 = q.get('from');
  if ((to0 && !DAY.test(to0)) || (from0 && !DAY.test(from0))) return err(400, 'bad_request', 'from and to must be days like 2026-11-01.');
  const to = to0 || lastDay(d) || new Date().toISOString().slice(0, 10);
  const from = from0 || addDays(to, -29);
  if (from > to) return err(400, 'bad_request', 'from is after to.');
  return { from, to };
}

// ---- endpoints
const ENDPOINTS = new Set(['dash', 'overview', 'ads', 'decisions', 'campaigns', 'health']);

async function dashEndpoint(e: Env): Promise<Response> {
  const d = await loadDash(e);
  return d ? reply(200, cleanDash(d)) : missingDash();
}

async function overviewEndpoint(e: Env, q: URLSearchParams): Promise<Response> {
  const d = await loadDash(e);
  if (!d) return missingDash();
  const p = period(d, q);
  if (p instanceof Response) return p;
  const o = outcome(d, p.from, p.to, 'lead');
  const targets = resolveTargets(d, null);
  // The judge is the dashboard's own rules table (pipeline/dash/00-judge.js). If it cannot run on this data the numbers still answer.
  let verdict: unknown = null;
  try { verdict = J.judge(judgeInput(d, p.from, p.to, 'lead', undefined, targets.maturityDays), targets, 'en', { pct: v => `${v.toFixed(2)}%`, sar: v => `${v.toFixed(2)} SAR`, x: v => `${v.toFixed(2)}x`, qty: v => String(Math.round(v)), num: (v, dp) => v.toFixed(dp ?? 1) }); } catch { /* numbers only */ }
  return reply(200, { period: p, generated_at: d.generated_at ?? null, totals: o, targets, judge: verdict });
}

const AD_FIELDS = ['name', 'campaign', 'platform', 'dept', 'goal', 'dest', 'status', 'live', 'group'] as const;
async function adsEndpoint(e: Env, q: URLSearchParams): Promise<Response> {
  const d = await loadDash(e);
  if (!d) return missingDash();
  const p = period(d, q);
  if (p instanceof Response) return p;
  const platform = q.get('platform'), status = q.get('status');
  const limit = Math.min(2000, Math.max(1, parseInt(q.get('limit') || '500', 10) || 500));
  const sum = new Map<string, number[]>();
  for (const r of d.rows ?? []) {
    const day = String(r[1]);
    if (day < p.from || day > p.to) continue;
    const s = sum.get(String(r[0])) ?? [0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) s[i] = (s[i] as number) + num(r[2 + i]);
    sum.set(String(r[0]), s);
  }
  const out: Row[] = [];
  for (const [id, ad] of Object.entries(d.ads ?? {})) {
    if (platform && ad.platform !== platform) continue;
    if (status && String(ad.status ?? '') !== status) continue;
    const [spend = 0, impr = 0, clicks = 0, leads = 0, conv = 0] = sum.get(id) ?? [];
    const a: Row = { id };
    for (const f of AD_FIELDS) if (ad[f] !== undefined) a[f] = ad[f];
    const results = leads + conv;
    out.push({ ...a, metrics: { spend, impressions: impr, clicks, leads, conversations: conv, ctr: impr ? clicks / impr : null, cost_per_result: results ? spend / results : null } });
  }
  out.sort((x, y) => num((y.metrics as Row).spend) - num((x.metrics as Row).spend));
  return reply(200, { period: p, count: out.length, truncated: out.length > limit, ads: out.slice(0, limit) });
}

// Only Well has a decision board for now (suggestions have no company column): other companies get 404
const SUGGESTION_COLS = 'id,created_at,platform,level,target_id,target_name,campaign,kind,params,reason,evidence,priority,source,status,decided_at';
async function decisionsEndpoint(cfg: Cfg): Promise<Response> {
  const [open, done, outs] = await Promise.all([
    sb(cfg, `/rest/v1/suggestions?select=${SUGGESTION_COLS}&status=eq.open&order=priority.desc,created_at.desc&limit=100`, { admin: true }),
    sb(cfg, `/rest/v1/suggestions?select=${SUGGESTION_COLS}&status=neq.open&order=decided_at.desc.nullslast&limit=50`, { admin: true }),
    sb(cfg, scoped('/rest/v1/buyer_outcomes?select=day,measured_at,platform,rec_rule,kind,before,after,result&order=measured_at.desc&limit=50', WELL_COMPANY), { admin: true }),
  ]);
  if (!open.ok || !done.ok) return err(502, 'upstream', 'The decisions could not be read. Try again shortly.');
  // The outcomes table comes from a later migration: without it that part is just empty
  return reply(200, { open: rows(open.data), recent: rows(done.data), outcomes: outs.ok ? rows(outs.data) : missingSchema(outs) ? [] : null });
}

// Plans and task status only: no outputs (generated text, pictures, voice) and no author emails
async function campaignsEndpoint(cfg: Cfg): Promise<Response> {
  const c = await sb(cfg, scoped('/rest/v1/campaigns?select=id,title,status,estimate_usd,created_at,updated_at,approved_at&order=created_at.desc&limit=50', WELL_COMPANY), { admin: true });
  if (missingSchema(c)) return reply(200, { campaigns: [] });
  if (!c.ok) return err(502, 'upstream', 'The campaigns could not be read. Try again shortly.');
  const camps = rows(c.data);
  const ids = camps.map(x => String(x.id)).filter(x => /^[0-9a-f-]{36}$/i.test(x));
  const t = ids.length ? await sb(cfg, scoped(`/rest/v1/campaign_tasks?select=campaign_id,position,agent,title,status,blocked_reason,updated_at&campaign_id=in.(${ids.join(',')})&order=position.asc&limit=1000`, WELL_COMPANY), { admin: true }) : null;
  if (t && !t.ok) return err(502, 'upstream', 'The campaigns could not be read. Try again shortly.');
  const tasks = t ? rows(t.data) : [];
  return reply(200, { campaigns: camps.map(x => ({ ...x, tasks: tasks.filter(k => k.campaign_id === x.id).map(k => omit(k, 'campaign_id')) })) });
}

// Freshness and step status, from the same read the owner's health page uses. No dependencies, versions, migrations or environment.
async function healthEndpoint(e: Env): Promise<Response> {
  const s = await dataStatus(e.FILES as StatusBucket | undefined);
  return reply(200, s);
}

// ---- entry
export async function handleV1(request: Request, e: Env): Promise<Response> {
  // Key unset: 404 for everything. Then the method, then the key and the limits (src/lib/readkey.ts)
  const a = await authenticate(request, e);
  if (!a.ok) return request.method === 'HEAD' ? new Response(null, { status: a.res.status, headers: a.res.headers }) : a.res;
  const url = new URL(request.url);
  const name = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/$/, '');
  let res: Response;
  if (name === 'openapi.json') res = reply(200, openapi(url.origin));
  else if (!ENDPOINTS.has(name)) res = err(404, 'not_found', 'No such endpoint. See /api/v1/openapi.json.');
  else {
    try {
      res = name === 'dash' ? await dashEndpoint(e)
        : name === 'overview' ? await overviewEndpoint(e, url.searchParams)
        : name === 'ads' ? await adsEndpoint(e, url.searchParams)
        : name === 'decisions' ? await decisionsEndpoint(a.cfg)
        : name === 'campaigns' ? await campaignsEndpoint(a.cfg)
        : await healthEndpoint(e);
    } catch (x) {
      // The error's name only: a message could carry request text, and nothing here may log the token
      console.error('api_v1_error', name, x instanceof Error ? x.name : 'unknown');
      res = err(500, 'server_error', 'Something went wrong. Try again shortly.');
    }
  }
  return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
