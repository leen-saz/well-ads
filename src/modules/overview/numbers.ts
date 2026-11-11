// Numbers for the overview tab, from /dash.json (pipeline/build.py). Pure functions: the React pieces only draw them.
// Same rules as the main dashboard (pipeline/template.html): agg(), derive(), holesBetween(), compareOk.
// rows = [key, day, spend, impr, clicks, leads, conv]

import { pageLang } from './lang';

export interface Ad { name: string; campaign: string; platform: string; dept?: string; goal?: string; dest?: string; status?: string; live?: boolean; group?: string }
// Cost per lead counts only lead-goal spend whose leads the platform can measure. A TikTok ad that opens WhatsApp reports
// no leads there, so its spend stays out (same rule as pipeline/dash/03-agg.js). dest is 'whatsapp' | 'unknown' | absent.
export const isWhatsappDest = (a: { dest?: string }): boolean => a.dest === 'whatsapp';
export const countsAsLead = (a: { goal?: string; dest?: string }): boolean => a.goal === 'lead' && !isWhatsappDest(a);

export interface Coverage { coverage_end?: string; synced_at?: string; ok?: boolean; stale_from?: string }
export interface Dash {
  ads?: Record<string, Ad>; rows?: unknown[][]; generated_at?: string;
  range?: { start?: string; end?: string; today?: string }; platforms?: Record<string, Coverage>;
}
export interface Totals { spend: number; impr: number; clicks: number; results: number; cpr: number | null; ctr: number | null }
export interface Day { day: string; spend: number; results: number }
export interface AdRow extends Totals { key: string; name: string; campaign: string; platform: string; dept: string; goal: string; live: boolean }

// Counted in the totals like the main dashboard, but never shown on their own (PRD §3.1)
export const HIDDEN = new Set(['audience_network', 'meta_whatsapp']);

export const PLATFORM: Record<string, string> = {
  facebook: 'فيسبوك', instagram: 'إنستغرام', messenger: 'ماسنجر', threads: 'ثريدز', meta: 'ميتا',
  snap: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل', google_search: 'جوجل · بحث', google_pmax: 'جوجل · أداء أقصى',
  google_display: 'جوجل · شبكة العرض', google_video: 'جوجل · يوتيوب', google_demand_gen: 'جوجل · توليد الطلب',
};
const PLATFORM_EN: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', threads: 'Threads', meta: 'Meta',
  snap: 'Snapchat', tiktok: 'TikTok', google: 'Google', google_search: 'Google · Search', google_pmax: 'Google · Performance Max',
  google_display: 'Google · Display', google_video: 'Google · YouTube', google_demand_gen: 'Google · Demand Gen',
  google_shopping: 'Google · Shopping', google_app: 'Google · App', google_smart: 'Google · Smart', google_local: 'Google · Local',
};
// The department names when dash.json has none (pipeline/config/departments.json), and the main dashboard's English ones
export const DEP_AR: Record<string, string> = { iv: 'المحاليل الوريدية', midwife: 'القبالة / رعاية الحمل', foot: 'تقويم القدم', renan: 'رينان لصحة الطفل', brand: 'العلامة التجارية / الوعي' };
// (pipeline/dash/01-base.js DEP_EN)
export const DEP_EN: Record<string, string> = { iv: 'IV Drips', midwife: 'Midwifery / Maternity', foot: 'Foot Alignment', renan: 'Renan Child Health', brand: 'Brand / Awareness' };
// In the page language (lang.ts): every caller gets the right name, including .map(platformName)
export const platformName = (p: string): string => platformNameIn(p, pageLang());
export const platformNameIn = (p: string, lang: 'ar' | 'en'): string => (lang === 'en' ? PLATFORM_EN[p] : PLATFORM[p]) ?? p;

export const GOAL: Record<string, string> = { lead: 'ليدز', messages: 'محادثات' };
const GOAL_EN: Record<string, string> = { lead: 'Leads', messages: 'Conversations' };
// The goal's name in the page language; fallback when the ad has none
export const goalName = (g: string, other = '—'): string => (pageLang() === 'en' ? GOAL_EN[g] : GOAL[g]) ?? (other === '—' ? '—' : pageLang() === 'en' ? 'Other' : other);

const META = new Set(['facebook', 'instagram', 'messenger', 'threads', 'audience_network']);
export const family = (p: string): string => (p.startsWith('google') ? 'google' : p.startsWith('meta') || META.has(p) ? 'meta' : p);

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The last full day (range.end), like the main dashboard; the rows also carry today's partial day.
export function lastDay(d: Dash): string | null {
  if (d.range?.end && DAY.test(d.range.end)) return d.range.end;
  let max: string | null = null;
  for (const r of d.rows ?? []) { const day = String(r[1] ?? ''); if (!max || day > max) max = day; }
  return max;
}

function* inRange(d: Dash, from: string, to: string) {
  const ads = d.ads ?? {};
  for (const r of d.rows ?? []) {
    const key = String(r[0]), day = String(r[1]);
    if (day < from || day > to) continue;
    const ad = ads[key];
    if (!ad) continue;
    // Results = leads + conversations, for every ad (template.html renderBI)
    yield { key, ad, day, spend: num(r[2]), impr: num(r[3]), clicks: num(r[4]), res: num(r[5]) + num(r[6]) };
  }
}

function totals(spend: number, impr: number, clicks: number, results: number): Totals {
  return { spend, impr, clicks, results, cpr: ratio(spend, results), ctr: ratio(clicks, impr) };
}

export function summarize(d: Dash, from: string, to: string): Totals {
  let spend = 0, impr = 0, clicks = 0, res = 0;
  for (const x of inRange(d, from, to)) { spend += x.spend; impr += x.impr; clicks += x.clicks; res += x.res; }
  return totals(spend, impr, clicks, res);
}

// Which platform moved a number the most between two periods (the 'why' line under a card)
export function mover(d: Dash, from: string, to: string, pf: string, pt: string, field: 'spend' | 'res'): { platform: string; delta: number } | null {
  const by = new Map<string, number>();
  for (const x of inRange(d, from, to)) by.set(x.ad.platform, (by.get(x.ad.platform) ?? 0) + x[field]);
  for (const x of inRange(d, pf, pt)) by.set(x.ad.platform, (by.get(x.ad.platform) ?? 0) - x[field]);
  let best: { platform: string; delta: number } | null = null;
  for (const [platform, delta] of by) if (Math.abs(delta) > 0.004 && (!best || Math.abs(delta) > Math.abs(best.delta))) best = { platform, delta };
  return best;
}

// Same length, just before `from`
export function previous(from: string, to: string): [string, string] {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  return [addDays(from, -days), addDays(from, -1)];
}

// Last day a platform family's data is complete (template.html coverEnd)
function coverEnd(d: Dash, fam: string): string | null {
  const info = d.platforms?.[fam] ?? {};
  const today = d.range?.today || d.range?.end || null;
  if (DAY.test(info.coverage_end ?? '')) return info.coverage_end!;
  if (fam === 'tiktok') { const day = String(info.synced_at ?? '').slice(0, 10); return DAY.test(day) ? day : null; }
  if (info.ok === false) { const day = String(info.stale_from ?? '').slice(0, 10); return DAY.test(day) ? day : null; }
  return today;
}

// Platforms whose data stops before `to`: comparing over them would show a false drop
export function holes(d: Dash, to: string): string[] {
  const fams = new Set(Object.values(d.ads ?? {}).filter(a => a && !HIDDEN.has(a.platform)).map(a => family(a.platform)));
  return [...fams].filter(f => { const end = coverEnd(d, f); return !end || to > end; });
}

// Compare only when the earlier period is inside the data and no platform has a gap (template.html compareOk)
export function canCompare(d: Dash, from: string, to: string): boolean {
  const [pf, pt] = previous(from, to);
  const start = d.range?.start;
  if (start && pf < start) return false;
  return !holes(d, to).length && !holes(d, pt).length;
}

// Percent change; null when there is nothing to compare with
export function change(now: number | null, before: number | null): number | null {
  if (now == null || before == null || before === 0) return null;
  return ((now - before) / before) * 100;
}

export function daily(d: Dash, from: string, to: string): Day[] {
  const m = new Map<string, Day>();
  for (let day = from; day <= to; day = addDays(day, 1)) m.set(day, { day, spend: 0, results: 0 });
  for (const x of inRange(d, from, to)) { const o = m.get(x.day)!; o.spend += x.spend; o.results += x.res; }
  return [...m.values()];
}

// Ads table: hidden platforms stay out of the list (their numbers are still in the totals above)
export function byAd(d: Dash, from: string, to: string): AdRow[] {
  const m = new Map<string, { ad: Ad; spend: number; impr: number; clicks: number; res: number }>();
  for (const x of inRange(d, from, to)) {
    if (HIDDEN.has(x.ad.platform)) continue;
    const o = m.get(x.key) ?? { ad: x.ad, spend: 0, impr: 0, clicks: 0, res: 0 };
    o.spend += x.spend; o.impr += x.impr; o.clicks += x.clicks; o.res += x.res;
    m.set(x.key, o);
  }
  return [...m.entries()]
    .filter(([, o]) => o.spend > 0 || o.res > 0)
    .map(([key, o]) => ({
      key, name: o.ad.name, campaign: o.ad.campaign, platform: o.ad.platform, dept: o.ad.dept ?? '', goal: o.ad.goal ?? '',
      live: !!o.ad.live, ...totals(o.spend, o.impr, o.clicks, o.res),
    }))
    .sort((a, b) => b.spend - a.spend);
}

export function adDaily(d: Dash, key: string, from: string, to: string): Day[] {
  return daily({ ads: d.ads ?? {}, rows: (d.rows ?? []).filter(r => String(r[0]) === key) }, from, to);
}
