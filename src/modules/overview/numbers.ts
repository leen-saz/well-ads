// Numbers for the overview tab, from /dash.json (pipeline/build.py). Pure functions: the React pieces only draw them.
// rows = [key, day, spend, impr, clicks, leads, conv]; the result of an ad follows its goal, like the main dashboard.

export interface Ad { name: string; campaign: string; platform: string; dept?: string; goal?: string; status?: string; live?: boolean; group?: string }
export interface Dash { ads?: Record<string, Ad>; rows?: unknown[][]; generated_at?: string }
export interface Totals { spend: number; impr: number; clicks: number; results: number; cpr: number | null; ctr: number | null }
export interface Day { day: string; spend: number; results: number }
export interface AdRow extends Totals { key: string; name: string; campaign: string; platform: string; dept: string; goal: string; live: boolean }

// Never shown (PRD §3.1 and §5)
const HIDDEN = new Set(['audience_network', 'meta_whatsapp']);

export const PLATFORM: Record<string, string> = {
  facebook: 'فيسبوك', instagram: 'إنستغرام', messenger: 'ماسنجر', threads: 'ثريدز', meta: 'ميتا',
  snap: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل', google_search: 'جوجل · بحث', google_pmax: 'جوجل · أداء أقصى',
  google_display: 'جوجل · شبكة العرض', google_video: 'جوجل · يوتيوب', google_demand_gen: 'جوجل · توليد الطلب',
};
export const platformName = (p: string): string => PLATFORM[p] ?? p;

export const GOAL: Record<string, string> = { lead: 'ليدز', messages: 'محادثات' };

// Leads for lead campaigns, conversations for WhatsApp campaigns, both otherwise
export function result(goal: string | undefined, leads: number, conv: number): number {
  if (goal === 'lead') return leads;
  if (goal === 'messages') return conv;
  return leads + conv;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function lastDay(d: Dash): string | null {
  let max: string | null = null;
  for (const r of d.rows ?? []) { const day = String(r[1] ?? ''); if (!max || day > max) max = day; }
  return max;
}

// Visible rows inside [from, to], as {ad, day, spend, impr, clicks, res}
function* visible(d: Dash, from: string, to: string) {
  const ads = d.ads ?? {};
  for (const r of d.rows ?? []) {
    const key = String(r[0]), day = String(r[1]);
    if (day < from || day > to) continue;
    const ad = ads[key];
    if (!ad || HIDDEN.has(ad.platform)) continue;
    yield { key, ad, day, spend: num(r[2]), impr: num(r[3]), clicks: num(r[4]), res: result(ad.goal, num(r[5]), num(r[6])) };
  }
}

function totals(spend: number, impr: number, clicks: number, results: number): Totals {
  return { spend, impr, clicks, results, cpr: ratio(spend, results), ctr: ratio(clicks, impr) };
}

export function summarize(d: Dash, from: string, to: string): Totals {
  let spend = 0, impr = 0, clicks = 0, res = 0;
  for (const x of visible(d, from, to)) { spend += x.spend; impr += x.impr; clicks += x.clicks; res += x.res; }
  return totals(spend, impr, clicks, res);
}

// Same length, just before `from`
export function previous(from: string, to: string): [string, string] {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  return [addDays(from, -days), addDays(from, -1)];
}

// Percent change; null when there is nothing to compare with
export function change(now: number | null, before: number | null): number | null {
  if (now == null || before == null || before === 0) return null;
  return ((now - before) / before) * 100;
}

export function daily(d: Dash, from: string, to: string): Day[] {
  const m = new Map<string, Day>();
  for (let day = from; day <= to; day = addDays(day, 1)) m.set(day, { day, spend: 0, results: 0 });
  for (const x of visible(d, from, to)) { const o = m.get(x.day)!; o.spend += x.spend; o.results += x.res; }
  return [...m.values()];
}

export function byAd(d: Dash, from: string, to: string): AdRow[] {
  const m = new Map<string, { ad: Ad; spend: number; impr: number; clicks: number; res: number }>();
  for (const x of visible(d, from, to)) {
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
