// The detailed creative tab: each idea (the same creative across ad sets, platforms and copies, ideaKey) with its
// numbers for the period, its versions side by side, and the ads under it. Pure functions over /dash.json, same rules
// as the creative wall (pipeline/dash/10-creative.js): cost per lead counts only lead-goal spend and leads
// (leadSpend / leadN), and video numbers are lifetime. rows = [key, day, spend, impr, clicks, leads, conv]
import { type Ad, type Dash, family } from './numbers';
import { ideaKey } from './analytics';

// Lifetime video numbers (pipeline/fetch_data.py vid_doc): i impressions, v first-seconds views, c watched to the end
export interface Vid { i?: number; v?: number; c?: number }
export interface CreativeAd extends Ad {
  text?: string; format?: string; thumb?: string; video?: string; vid?: Vid;
  preview_url?: string; permalink?: string; image_url?: string; link?: string;
}

export interface Sums { spend: number; impr: number; clicks: number; leads: number; conv: number; leadSpend: number; leadN: number }
export interface Metrics extends Sums { results: number; cpl: number | null; ctr: number | null; hook: number | null; hold: number | null }
// One ad key (a Meta ad has one key per placement: m123|facebook, m123|instagram)
export interface AdStat extends Metrics { key: string; ad: CreativeAd }
// One version of the idea = one ad across its placements
export interface Version extends Metrics { id: string; ad: CreativeAd; ads: AdStat[]; platforms: string[]; live: boolean }
export interface Idea extends Metrics {
  key: string; name: string; ad: CreativeAd; versions: Version[]; ads: AdStat[];
  platforms: string[]; formats: string[]; depts: string[]; live: boolean;
}

export interface Filters { platform: string; dept: string; goal: string; format: string; q: string }
export const ALL: Filters = { platform: 'all', dept: 'all', goal: 'all', format: 'all', q: '' };
export type Sort = 'spend' | 'results' | 'cpl' | 'ctr' | 'hook';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const blank = (): Sums => ({ spend: 0, impr: 0, clicks: 0, leads: 0, conv: 0, leadSpend: 0, leadN: 0 });
const add = (o: Sums, x: Sums) => { for (const f of Object.keys(o) as (keyof Sums)[]) o[f] += x[f]; };
const base = (key: string) => key.split('|')[0]!;
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

// The format as the filter shows it: video, image, or what the platform calls it (search text, carousel...)
export function formatOf(a: CreativeAd): string {
  const f = (a.format || '').trim();
  if (/فيديو|video/i.test(f) || (!f && a.vid?.v)) return 'فيديو';
  if (/صورة|image|photo/i.test(f)) return 'صورة';
  return f || 'غير محدد';
}

export function matches(a: CreativeAd, f: Filters): boolean {
  if (f.platform !== 'all' && family(a.platform) !== f.platform) return false;
  if (f.dept !== 'all' && (a.dept || 'brand') !== f.dept) return false;
  if (f.goal !== 'all' && (a.goal || 'other') !== f.goal) return false;
  if (f.format !== 'all' && formatOf(a) !== f.format) return false;
  const q = f.q.trim().toLowerCase();
  return !q || `${a.name} ${a.campaign} ${a.group ?? ''} ${a.text ?? ''}`.toLowerCase().includes(q);
}

// Hook = stopped to watch (first seconds) ÷ impressions; hold = watched to the end ÷ those who stopped. Lifetime, and one
// Meta ad's placements share one video record, so each ad counts once.
export function video(ads: { key: string; ad: CreativeAd }[]): { hook: number | null; hold: number | null } {
  const seen = new Set<string>();
  let i = 0, v = 0, c = 0;
  for (const { key, ad } of ads) {
    const x = ad.vid;
    if (!x?.v || seen.has(base(key))) continue;
    seen.add(base(key));
    i += num(x.i); v += num(x.v); c += num(x.c);
  }
  return { hook: ratio(v, i), hold: ratio(c, v) };
}

function metrics(s: Sums, ads: { key: string; ad: CreativeAd }[]): Metrics {
  return { ...s, results: s.leads + s.conv, cpl: ratio(s.leadSpend, s.leadN), ctr: ratio(s.clicks, s.impr), ...video(ads) };
}

// Every ad that spent or brought a result in the period and passes the filters
export function adStats(d: Dash, from: string, to: string, f: Filters = ALL): AdStat[] {
  const ads = (d.ads ?? {}) as Record<string, CreativeAd>;
  const by = new Map<string, Sums>();
  for (const r of d.rows ?? []) {
    const key = String(r[0]), day = String(r[1]), ad = ads[key];
    if (day < from || day > to || !ad || !matches(ad, f)) continue;
    const s = num(r[2]), l = num(r[5]), lead = ad.goal === 'lead';
    const o = by.get(key) ?? blank();
    add(o, { spend: s, impr: num(r[3]), clicks: num(r[4]), leads: l, conv: num(r[6]), leadSpend: lead ? s : 0, leadN: lead ? l : 0 });
    by.set(key, o);
  }
  return [...by.entries()]
    .filter(([, o]) => o.spend > 0 || o.leads + o.conv > 0)
    .map(([key, o]) => ({ key, ad: ads[key]!, ...metrics(o, [{ key, ad: ads[key]! }]) }));
}

// The ad that stands for a group: one with a picture first, then the biggest spender (10-creative.js ideaList)
const face = (xs: AdStat[]) => [...xs].sort((p, q) => Number(!!q.ad.thumb) - Number(!!p.ad.thumb) || q.spend - p.spend)[0]!;

function versionsOf(ads: AdStat[]): Version[] {
  const by = new Map<string, AdStat[]>();
  for (const x of ads) by.set(base(x.key), [...(by.get(base(x.key)) ?? []), x]);
  return [...by.entries()].map(([id, xs]) => {
    const s = blank();
    for (const x of xs) add(s, x);
    return { id, ad: face(xs).ad, ads: xs.sort((p, q) => q.spend - p.spend), platforms: uniq(xs.map(x => x.ad.platform)), live: xs.some(x => !!x.ad.live), ...metrics(s, xs) };
  }).sort((p, q) => q.spend - p.spend);
}

export function ideas(d: Dash, from: string, to: string, f: Filters = ALL): Idea[] {
  const by = new Map<string, AdStat[]>();
  for (const x of adStats(d, from, to, f)) { const k = ideaKey(x.ad.name); by.set(k, [...(by.get(k) ?? []), x]); }
  return [...by.entries()].map(([key, ads]) => {
    const s = blank();
    for (const x of ads) add(s, x);
    const top = face(ads);
    return {
      key, name: top.ad.name, ad: top.ad, versions: versionsOf(ads), ads: [...ads].sort((p, q) => q.spend - p.spend),
      platforms: uniq(ads.map(x => family(x.ad.platform))), formats: uniq(ads.map(x => formatOf(x.ad))),
      depts: uniq(ads.map(x => x.ad.dept || 'brand')), live: ads.some(x => !!x.ad.live), ...metrics(s, ads),
    };
  });
}

// Biggest first; costs cheapest first, and an idea with no cost (no leads) or no video goes last
export function sortIdeas<T extends Metrics>(list: T[], by: Sort): T[] {
  const key: Record<Sort, (x: T) => number> = {
    spend: x => -x.spend, results: x => -x.results, cpl: x => x.cpl ?? Infinity, ctr: x => -(x.ctr ?? -1), hook: x => -(x.hook ?? -1),
  };
  return [...list].sort((p, q) => key[by](p) - key[by](q) || q.spend - p.spend);
}

// Filter choices from the data itself, so the lists only offer what exists
export function options(d: Dash): { platforms: string[]; depts: string[]; goals: string[]; formats: string[] } {
  const ads = Object.values((d.ads ?? {}) as Record<string, CreativeAd>).filter(Boolean);
  return {
    platforms: uniq(ads.map(a => family(a.platform))),
    depts: uniq(ads.map(a => a.dept || 'brand')),
    goals: uniq(ads.map(a => a.goal || 'other')),
    formats: uniq(ads.map(formatOf)).sort(),
  };
}

// Side by side: the best value in each row is highlighted. Costs are best when lowest; spend is neither good nor bad.
export type Dir = 1 | -1 | 0;
export function best(values: (number | null)[], dir: Dir): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (!dir || v.length < 2) return null;
  return dir > 0 ? Math.max(...v) : Math.min(...v);
}

// The card shows how cost per lead was worked out whenever it is not simply the spend shown ÷ the leads shown
export const cplDiffers = (m: Metrics): boolean => m.cpl != null && (m.leadSpend !== m.spend || m.leadN !== m.leads);

// What the preview can show: the picture and a playable video file, from this site only (the page's CSP allows images from
// 'self' and data: only), and the outside page, video or image that opens in a new tab. The Snap API link answers 403.
export function media(a: CreativeAd): { img: string; video: string; open: string } {
  const http = (u?: string) => (/^https?:/i.test(u || '') && !/adsapi\.snapchat\.com/i.test(u || '') ? u! : '');
  const local = (u?: string) => (/^\/(?!\/)/.test(u || '') ? u! : '');
  const img = /^(data:image\/|\/(?!\/))/.test(a.thumb || '') ? a.thumb! : '';
  const video = [a.video, a.preview_url, a.link].map(local).find(u => /\.(mp4|webm|mov)(\?|$)/i.test(u)) ?? '';
  return { img, video, open: http(a.preview_url) || http(a.permalink) || http(a.video) || http(a.image_url) || http(a.link) };
}
