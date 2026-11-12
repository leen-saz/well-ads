// «صحة الداتا» (owner only, read-only): how fresh each source is, row counts, join rates, duplicates, orphans and which
// migrations are missing. Everything returned is a count, a date or a table/platform name: no ad names, no lead
// ids, no mention text. The groupings below run inside the Worker and only their sizes leave it.
import { missingSchema, sb, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { readAll } from './health';
import { dataStatus } from '../../lib/datastatus';
import { SCHEMA } from './schema';
import { linkedShare } from '../../lib/linked';

const PLATFORMS = ['meta', 'snap', 'tiktok', 'google'];
// ads.platform values are the platforms' own names in the pipeline; keep any other value visible as it is
export type Fresh = { platform: string; ads: number; newest_ad_update: string | null; newest_metric_day: string | null; token_expires_at: string | null };

type AdRow = { ad_key: string; platform: string; name: string; campaign: string; updated_at: string | null };
type MetricRow = { ad_key: string; day: string };
type ConnRow = { platform: string; expires_at: string | null };

const key = (...p: unknown[]) => p.map(x => String(x ?? '').trim().toLowerCase()).join('\u0001');
// Rows beyond the first of each group: 3 identical rows = 2 duplicates
export function surplus<T>(rows: T[], by: (r: T) => string | null): number {
  const seen = new Map<string, number>();
  for (const r of rows) { const k = by(r); if (k) seen.set(k, (seen.get(k) || 0) + 1); }
  let n = 0;
  for (const c of seen.values()) if (c > 1) n += c - 1;
  return n;
}
const newest = (a: string | null, b?: string | null) => (b && (!a || Date.parse(b) > Date.parse(a)) ? b : a);

export function freshness(ads: AdRow[], metrics: MetricRow[], conns: ConnRow[]): Fresh[] {
  const plat = new Map(ads.map(a => [a.ad_key, a.platform]));
  const by = new Map<string, Fresh>();
  const get = (p: string) => { let f = by.get(p); if (!f) by.set(p, f = { platform: p, ads: 0, newest_ad_update: null, newest_metric_day: null, token_expires_at: null }); return f; };
  for (const p of PLATFORMS) get(p);
  for (const a of ads) { const f = get(a.platform || '?'); f.ads++; f.newest_ad_update = newest(f.newest_ad_update, a.updated_at); }
  for (const m of metrics) { const p = plat.get(m.ad_key); if (p) { const f = get(p); f.newest_metric_day = newest(f.newest_metric_day, m.day); } }
  for (const c of conns) { const f = by.get(c.platform); if (f) f.token_expires_at = c.expires_at; }
  return [...by.values()];
}

// Why each paid closing did or did not reach an ad (pipeline/crm/join.py attach): counts per reason, source words cleaned
const WHY = ['id', 'name', 'via_customer', 'source', 'no_id', 'broken_id', 'not_in_ads'];
function cleanAttribution(a: { paid?: number; why?: Record<string, number>; unmatched_sources?: Record<string, number> } | undefined) {
  if (!a || typeof a !== 'object') return null;
  const why = Object.fromEntries(WHY.map(k => [k, Number(a.why?.[k]) || 0]));
  const sources = Object.fromEntries(Object.entries(a.unmatched_sources ?? {}).filter(([k]) => /^[a-z0-9_]{1,40}$/.test(k)).map(([k, n]) => [k, Number(n) || 0]));
  return { paid: Number(a.paid) || 0, why, unmatched_sources: sources };
}

// The crm block of dash.json: how many leads matched an ad. Counts only.
export function joinRates(crm: unknown) {
  const c = (crm && typeof crm === 'object' ? crm : {}) as { rows?: unknown[]; paid_all?: unknown[]; unmatched?: number; total?: number; via_customer?: number; synced?: string; attribution?: { paid?: number; why?: Record<string, number>; unmatched_sources?: Record<string, number> } };
  // The same numbers the performance summary and the tracking page show (src/lib/linked.ts)
  const L = linkedShare(c), unmatched = Number(c.unmatched) || 0;
  return { leads: L?.leads ?? 0, matched: L?.linked ?? 0, unmatched, matched_pct: L?.leadsPct ?? null,
    closings_all: L?.closings ?? 0, closings_with_ad: L?.closingsLinked ?? 0, closings_unattributed: L?.closingsUnlinked ?? 0, closings_pct: L?.closingsPct ?? null,
    credited_via_customer: Number(c.via_customer) || 0, attribution: cleanAttribution(c.attribution), synced: typeof c.synced === 'string' ? c.synced : null };
}

// PostgREST count without the rows: Range 0-0 and Prefer count=exact, the total is after the slash in content-range
async function count(cfg: Cfg, path: string): Promise<number | null> {
  const res = await fetch(cfg.url + path, { method: 'HEAD', headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}`, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } });
  if (!res.ok) return null;
  const n = Number((res.headers.get('content-range') || '').split('/')[1]);
  return Number.isFinite(n) ? n : null;
}

const TABLES = ['ads', 'ad_metrics', 'crm_leads', 'listen_watch', 'listen_mentions', 'knowledge', 'brand_assets', 'copy_projects', 'motion_projects', 'social_posts', 'audit_log'];
// Tables that carry company_id with no foreign key to companies: the only ones that can point to a company that is gone
const NO_FK = ['ads', 'crm_leads', 'audit_log', 'connections'];

export async function migrationsMissing(cfg: Cfg): Promise<{ migration: string; table: string; columns: string[]; reason: 'table' | 'column' }[]> {
  const out: { migration: string; table: string; columns: string[]; reason: 'table' | 'column' }[] = [];
  const probed = await Promise.all(SCHEMA.map(async p => ({ p, r: await sb(cfg, `/rest/v1/${p.table}?select=${p.columns.join(',')}&limit=0`, { admin: true }) })));
  for (const { p, r } of probed) {
    if (r.ok) continue;
    const code = String((r.data as { code?: unknown } | null)?.code ?? '');
    if (missingSchema(r)) out.push({ ...p, reason: code === 'PGRST205' || code === '42P01' ? 'table' : 'column' });
  }
  return out;
}

// One request to the Worker may make at most 50 subrequests on Cloudflare's free plan (1000 on Paid). The page asks for
// the parts one after another and each part stays under 40 calls, so the page works on either plan.
export const PARTS = ['sources', 'content', 'counts', 'schema'] as const;
export type Part = (typeof PARTS)[number];

async function sources(cfg: Cfg, company: string, files?: R2Bucket) {                      // <= 8 + 1 + 1 + 1 + 15 = 26 calls
  const [ads, conns, sync, watches] = await Promise.all([
    readAll<AdRow>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,name,campaign,updated_at&order=ad_key.asc', company), 8),
    readAll<ConnRow>(cfg, scoped('/rest/v1/connections?select=platform,expires_at', company), 1),
    sb<{ last_updated_at: string | null; last_run_at: string | null; rows_last_run: number | null }[]>(cfg, '/rest/v1/crm_sync_state?id=eq.1&select=last_updated_at,last_run_at,rows_last_run', { admin: true }),
    readAll<{ fetched_at: string | null }>(cfg, scoped('/rest/v1/listen_watch?select=fetched_at', company), 1),
  ]);
  // The last days of metrics are enough to say when each platform last delivered a day
  const since = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  const metrics = await readAll<MetricRow>(cfg, `/rest/v1/ad_metrics?select=ad_key,day&day=gte.${since}&order=ad_key.asc,day.asc`, 15);
  let dash: { crm?: unknown } | null = null, dashUploaded: string | null = null;
  const obj = files ? await files.get('site/dash.json') : null;
  if (obj) { dashUploaded = obj.uploaded.toISOString(); try { dash = JSON.parse(await obj.text()); } catch { dash = null; } }
  const state = sync.ok && Array.isArray(sync.data) ? sync.data[0] || null : null;
  return {
    freshness: { platforms: freshness(ads.rows, metrics.rows, conns.rows),
      crm: state ? { last_run_at: state.last_run_at, last_updated_at: state.last_updated_at, rows_last_run: state.rows_last_run } : null,
      listening_last_fetch: watches.rows.reduce<string | null>((a, w) => newest(a, w.fetched_at), null), dash_json_uploaded: dashUploaded },
    data_status: await dataStatus(files),
    joins: dash ? joinRates(dash.crm) : null,
    duplicates: { ads: surplus(ads.rows, a => (a.name ? key(a.platform, a.name, a.campaign) : null)) },
  };
}

async function content(cfg: Cfg, company: string) {                                           // <= 25 + 4 + 3 + 2 = 34 calls
  const [leads, mentions, knowledge, assets] = await Promise.all([
    readAll<{ customer_id: string | null; source_platform: string | null; created_at: string }>(cfg, scoped('/rest/v1/crm_leads?select=customer_id,source_platform,created_at&order=lead_id.asc', company), 25),
    readAll<{ source: string; title: string }>(cfg, scoped('/rest/v1/listen_mentions?select=source,title&order=id.asc', company), 4),
    readAll<{ kind: string; title: string; body: string }>(cfg, scoped('/rest/v1/knowledge?select=kind,title,body&order=id.asc', company), 3),
    readAll<{ kind: string; title: string }>(cfg, scoped('/rest/v1/brand_assets?select=kind,title&order=id.asc', company), 2),
  ]);
  return { duplicates: {
    leads: surplus(leads.rows, l => (l.customer_id ? key(l.customer_id, l.source_platform, l.created_at) : null)),
    mentions: surplus(mentions.rows, m => (m.title ? key(m.source, m.title) : null)),
    knowledge: surplus(knowledge.rows, k => key(k.kind, k.title, k.body)),
    library: surplus(assets.rows, a => (a.title ? key(a.kind, a.title) : null)),
  } };
}

async function counts(cfg: Cfg, company: string) {                                            // 11 + 1 + 4 = 16 calls
  // ad_metrics has no company column; every other table is this company's rows
  const c = Object.fromEntries(await Promise.all(TABLES.map(async t => [t, await count(cfg, t === 'ad_metrics' ? '/rest/v1/ad_metrics?select=ad_key' : scoped(`/rest/v1/${t}?select=*`, company))])));
  const ids = (await readAll<{ id: string }>(cfg, '/rest/v1/companies?select=id', 1)).rows.map(x => x.id);
  const orphans: Record<string, number | null> = {};
  if (ids.length) for (const t of NO_FK) orphans[t] = await count(cfg, `/rest/v1/${t}?select=*&company_id=not.in.(${ids.join(',')})`);
  return { counts: c, orphans };
}

// One part of the page. Each returns only counts, dates and names; the page merges them.
export async function dataHealth(cfg: Cfg, company: string, part: Part, files?: R2Bucket) {
  const body = part === 'sources' ? await sources(cfg, company, files) : part === 'content' ? await content(cfg, company)
    : part === 'counts' ? await counts(cfg, company) : { migrations_missing: await migrationsMissing(cfg) };
  return { part, checked_at: new Date().toISOString(), ...body };
}
