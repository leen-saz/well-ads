// The rest of the analytics overview page, for the overview tab: each platform's share, the month's pace and forecast,
// cost per lead by weekday, and departments. Pure functions over /dash.json, same rules as pipeline/template.html
// (renderBI, renderPace, renderDeptMini). rows = [key, day, spend, impr, clicks, leads, conv]
import { type Ad, type Dash, DEP_AR, DEP_EN, HIDDEN, addDays, family, holes, platformName } from './numbers';
import { type Lang, T, pageLang, pick } from './lang';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
// The main dashboard's platform order (channels.py), then any other platform present
const FALLBACK = ['facebook', 'instagram', 'messenger', 'snap', 'tiktok', 'google_search', 'google_pmax', 'google_display', 'google_video', 'google_demand_gen', 'google', 'meta'];

type Row = { key: string; ad: Ad; day: string; spend: number; impr: number; clicks: number; leads: number; conv: number };
function* rows(d: Dash, from: string, to: string): Generator<Row> {
  const ads = d.ads ?? {};
  for (const r of d.rows ?? []) {
    const key = String(r[0]), day = String(r[1]);
    if (day < from || day > to) continue;
    const ad = ads[key];
    if (ad) yield { key, ad, day, spend: num(r[2]), impr: num(r[3]), clicks: num(r[4]), leads: num(r[5]), conv: num(r[6]) };
  }
}

export function order(d: Dash): string[] {
  const present = new Set(Object.values(d.ads ?? {}).map(a => a?.platform).filter((p): p is string => !!p && !HIDDEN.has(p)));
  const base = ((d as { channels?: { order?: string[] } }).channels?.order ?? FALLBACK).filter(p => present.has(p));
  return [...base, ...[...present].filter(p => !base.includes(p))];
}

// ---- Each platform's share of spend and of results (leads + chats). Hidden platforms count nowhere here.
export interface Share { platform: string; spend: number; results: number; spendShare: number; resultShare: number }
export function share(d: Dash, from: string, to: string): Share[] {
  const by = new Map<string, { spend: number; results: number }>();
  for (const x of rows(d, from, to)) { const o = by.get(x.ad.platform) ?? { spend: 0, results: 0 }; o.spend += x.spend; o.results += x.leads + x.conv; by.set(x.ad.platform, o); }
  const list = order(d).filter(p => { const o = by.get(p); return !!o && (o.spend > 0 || o.results > 0); });
  const ts = list.reduce((a, p) => a + by.get(p)!.spend, 0) || 1, tl = list.reduce((a, p) => a + by.get(p)!.results, 0) || 1;
  return list.map(p => { const o = by.get(p)!; return { platform: p, spend: o.spend, results: o.results, spendShare: (100 * o.spend) / ts, resultShare: (100 * o.results) / tl }; });
}

// ---- Cost per lead by weekday (0 = Sunday), lead-goal ads only, per platform. null where there were no leads.
export interface Heat { platform: string; cpl: (number | null)[] }
export function heat(d: Dash, from: string, to: string): { rows: Heat[]; lo: number; hi: number } {
  const by = new Map<string, { s: number; l: number }[]>();
  for (const x of rows(d, from, to)) {
    if (x.ad.goal !== 'lead') continue;
    const w = new Date(x.day + 'T00:00:00Z').getUTCDay();
    const days = by.get(x.ad.platform) ?? Array.from({ length: 7 }, () => ({ s: 0, l: 0 }));
    days[w]!.s += x.spend; days[w]!.l += x.leads;
    by.set(x.ad.platform, days);
  }
  const out = order(d).filter(p => by.has(p)).map(p => ({ platform: p, cpl: by.get(p)!.map(o => (o.l ? o.s / o.l : null)) }));
  const vals = out.flatMap(h => h.cpl.filter((v): v is number => v != null));
  return { rows: out, lo: vals.length ? Math.min(...vals) : 0, hi: vals.length ? Math.max(...vals) : 0 };
}

// ---- This month: spend and results so far, the forecast to month end, and the same days of last month
export interface Pace {
  month: string; prevMonth: string; done: number; days: number; spend: number | null; results: number | null; partialToday: boolean;
  forecast: { spend: number; results: number } | null; waitDays: boolean;
  prev: { spend: number; results: number; full: boolean } | null; vs: { spend: number | null; results: number | null } | null;
}
const monthEnd = (ym: string) => addDays(addDays(ym + '-28', 4).slice(0, 8) + '01', -1);
const dom = (day: string) => new Date(day + 'T00:00:00Z').getUTCDate();
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;

export function pace(d: Dash, from: string, to: string): Pace {
  const ym = to.slice(0, 7), first = ym + '-01', last = monthEnd(ym), days = dom(last);
  const today = d.range?.today || d.range?.end || to, max = d.range?.end || to, min = d.range?.start || '';
  const pFrom = from > first ? from : first, pTo = to < last ? to : last;
  // Today's partial day never counts towards the forecast
  const dropToday = pTo === today && today !== max;
  const completeTo = dropToday ? addDays(today, -1) : pTo, complete = completeTo >= pFrom;
  const prevEnd = addDays(first, -1), prevYm = prevEnd.slice(0, 7), prevLast = dom(prevEnd);
  const prevDays = new Set<string>();
  if (complete) for (let x = pFrom; x <= completeTo; x = addDays(x, 1)) if (dom(x) <= prevLast) prevDays.add(`${prevYm}-${String(dom(x)).padStart(2, '0')}`);
  const pl = [...prevDays].sort();
  const prevKnown = pl.length > 0 && pl.every(x => x >= min) && !holes(d, pl[pl.length - 1]!).length;
  const cur = { s: 0, l: 0 }, bit = { s: 0, l: 0 }, prev = { s: 0, l: 0 };
  for (const x of rows(d, min || '0000', max > today ? max : today)) {
    const r = x.leads + x.conv;
    if (complete && x.day >= pFrom && x.day <= completeTo) { cur.s += x.spend; cur.l += r; }
    if (dropToday && x.day === today) { bit.s += x.spend; bit.l += r; }
    if (prevDays.has(x.day)) { prev.s += x.spend; prev.l += r; }
  }
  const done = complete ? span(pFrom, completeTo) : 0;
  const open = complete && holes(d, completeTo).length > 0;
  const change = (a: number, b: number) => (b ? (100 * (a - b)) / b : null);
  return {
    month: ym, prevMonth: prevYm, done, days,
    spend: complete ? cur.s : dropToday ? bit.s : null, results: complete ? cur.l : dropToday ? bit.l : null, partialToday: !complete && dropToday,
    // Fewer than 3 complete days is too little to project a whole month
    forecast: done < 3 || open ? null : { spend: (cur.s * days) / done, results: (cur.l * days) / done }, waitDays: done < 3 && !open,
    prev: prevKnown ? { spend: prev.s, results: prev.l, full: prevDays.size === prevLast && done === days } : null,
    vs: open || !prevKnown ? null : { spend: change(cur.s, prev.s), results: change(cur.l, prev.l) },
  };
}

// ---- Departments: spend, leads and cost per lead (lead-goal ads), in the dashboard's order; brand is not a department
export interface Dept { key: string; name: string; spend: number; leads: number; cpl: number | null }
type DeptCfg = { order?: string[]; departments?: Record<string, { ar?: string }> };
export function depts(d: Dash, from: string, to: string): Dept[] {
  const cfg = (d as { departments?: DeptCfg }).departments ?? {};
  const names = cfg.departments ?? {};
  const keys = (cfg.order ?? Object.keys(names)).filter(k => names[k] && k !== 'brand');
  const by = new Map<string, { spend: number; leads: number; ls: number; ln: number }>();
  for (const x of rows(d, from, to)) {
    const k = x.ad.dept || 'brand', o = by.get(k) ?? { spend: 0, leads: 0, ls: 0, ln: 0 };
    o.spend += x.spend; o.leads += x.leads;
    if (x.ad.goal === 'lead') { o.ls += x.spend; o.ln += x.leads; }
    by.set(k, o);
  }
  return keys.map(k => { const o = by.get(k) ?? { spend: 0, leads: 0, ls: 0, ln: 0 }; return { key: k, name: (pageLang() === 'en' ? DEP_EN[k] : undefined) ?? names[k]!.ar ?? DEP_AR[k] ?? k, spend: o.spend, leads: o.leads, cpl: o.ln ? o.ls / o.ln : null }; });
}

// ---- The outcome and the customer journey (template.html agg + renderKpis). CRM rows from pipeline/crm/join.py:
// crm.rows = [ad key, lead day, paid day, paid?, amount] (leads matched to ads), crm.paid_all = [lead day, paid day, amount, source]
// (every paid lead in the CRM, with or without an ad). Closings count on the lead's day or on the payment day, as Leen picks.
export type CrmBy = 'lead' | 'paid';
export interface Outcome {
  spend: number; impr: number; clicks: number; leads: number; conv: number;
  crm: boolean; crmLinked: boolean; crmLeads: number; booked: number; value: number; closings: number; paid: number;
  cpm: number | null; cpc: number | null; ctr: number | null; cpl: number | null; clickToResult: number | null;
  closeRate: number | null; roas: number | null; mer: number | null; cac: number | null;
  // The CRM as a whole in the period, whatever the platform filter: every paid closing, and those tied to an ad.
  // A platform's 0 closings only means something when the CRM ties closings to ads at all.
  closingsAll: number; bookedAll: number;
  // Lead to closing across the whole CRM: every paid closing ÷ the ads' leads and chats. Judged even when the closings
  // aren't tied to their ads (only the per-ad split is «غير مربوط» then). null with a platform filter: the CRM can't split it.
  closeRateAll: number | null;
}
type CrmData = { rows?: unknown[][]; paid_all?: unknown[][] };
const ratio = (a: number, b: number): number | null => (b ? a / b : null);

// plat: one platform only (the funnel's filter). The CRM's paid_all has no ad, so then closings and paid are the ad-linked ones.
export function outcome(d: Dash, from: string, to: string, by: CrmBy = 'lead', plat?: string): Outcome {
  let spend = 0, impr = 0, clicks = 0, leads = 0, conv = 0, ls = 0, ln = 0;
  for (const r of d.rows ?? []) {
    const day = String(r[1]);
    if (day < from || day > to || !d.ads?.[String(r[0])] || (plat && d.ads[String(r[0])]!.platform !== plat)) continue;
    const s = num(r[2]), l = num(r[5]);
    spend += s; impr += num(r[3]); clicks += num(r[4]); leads += l; conv += num(r[6]);
    if (d.ads[String(r[0])]!.goal === 'lead') { ls += s; ln += l; }
  }
  const crmData = (d as { crm?: CrmData }).crm;
  let crmLeads = 0, booked = 0, value = 0, closings = 0, paid = 0, bookedAll = 0, closingsAll = 0;
  for (const [k, leadDay, paidDay, isPaid, amount] of (crmData?.rows ?? []) as [string, string, string, unknown, number][]) {
    if (!d.ads?.[k]) continue;
    const day = by === 'paid' ? paidDay : leadDay, inPeriod = isPaid && day && day >= from && day <= to;
    if (inPeriod) bookedAll++;
    if (plat && d.ads[k]!.platform !== plat) continue;
    if (leadDay >= from && leadDay <= to) crmLeads++;
    if (inPeriod) { booked++; value += num(amount); }
  }
  for (const [leadDay, paidDay, amount] of (crmData?.paid_all ?? []) as [string, string, number][]) {
    const day = by === 'paid' ? paidDay : leadDay;
    if (day && day >= from && day <= to) { closingsAll++; if (!plat) { closings++; paid += num(amount); } }
  }
  if (plat) { closings = booked; paid = value; }
  return {
    spend, impr, clicks, leads, conv, crm: !plat && !!crmData?.paid_all, crmLinked: !!crmData, crmLeads, booked, value, closings, paid,
    cpm: impr ? (1000 * spend) / impr : null, cpc: ratio(spend, clicks), ctr: impr ? (100 * clicks) / impr : null, cpl: ratio(ls, ln),
    clickToResult: clicks ? (100 * (leads + conv)) / clicks : null, closeRate: crmLeads ? (100 * booked) / crmLeads : null,
    roas: spend && value ? value / spend : null, mer: ratio(paid, spend), cac: ratio(spend, closings), closingsAll, bookedAll,
    closeRateAll: !plat && crmData?.paid_all && leads + conv ? (100 * closings) / (leads + conv) : null,
  };
}

// The customer journey as the main dashboard draws it (pipeline/dash/05-render.js): four layers, each narrower than the
// one above, the rate that carries people down between layers, the cost beside each. The sale layer always shows: with
// no CRM block its numbers are null ("—") and noCrm says why. Values: [label, now, kind] where kind picks the format.
export type Fmt = 'qty' | 'sar' | 'pct' | 'x';
// missing: shown instead of a number that would mislead (a closing rate of 0% when no closing is tied to an ad)
export type JStat = { label: string; key: keyof Outcome | null; now: number | null; fmt: Fmt; lowerIsBetter: boolean; missing?: string };
// cost: the stage's cost shown under the band; amount: the sale stage's money, shown next to its count
export interface JStage { n: string; hint: string; width: number; colour: string; main: JStat; sub: JStat[]; rate?: JStat; cost?: JStat; amount?: JStat }
export const FUNNEL_WIDTHS = [100, 84, 68, 52];
export const FUNNEL_COLOURS = ['#7C8CFF', '#8B6CFF', '#7E57FD', '#5B36D6'];
export const NO_CRM = 'مرحلة البيع فاضية لأن أرقام نظام العملاء ما وصلت لهالنسخة من اللوحة. أول ما توصل تطلع الإقفالات هنا.';
export const NO_CRM_EN = "The sale stage is empty because the CRM numbers did not reach this copy of the dashboard. Closings show here as soon as they do.";

export const UNLINKED = 'غير مربوط';
export const UNLINKED_EN = 'Not linked';
// The ad-to-sale step can't be judged: no CRM, too few leads tied to an ad, or paid closings in the CRM with none tied to
// an ad (counted across all platforms, so a platform filter can't turn missing attribution into a 0% close rate).
// Then the step is «غير مربوط», never 0% and never the bottleneck.
export const MIN_CRM_COVERAGE = 0.3;
export function unattributed(a: Outcome): boolean {
  const results = a.leads + a.conv;
  return !a.crmLinked || (results >= 10 && a.crmLeads < MIN_CRM_COVERAGE * results) || (a.closingsAll > 0 && a.bookedAll === 0);
}

export function journey(a: Outcome, l: Lang = 'ar'): { stages: JStage[]; noCrm: string | null } {
  const t = (ar: string, en: string) => pick(l, ar, en);
  const st = (label: string, key: keyof Outcome, fmt: Fmt, lowerIsBetter = false, on = true): JStat =>
    ({ label, key: on ? key : null, now: on ? (a[key] as number | null) : null, fmt, lowerIsBetter });
  const linked = a.crmLinked, tied = !unattributed(a);
  // Counted only when the closings are tied to their ads; else «غير مربوط», no number and no change
  const ad = (label: string, key: keyof Outcome, fmt: Fmt, lowerIsBetter = false): JStat =>
    (tied ? st(label, key, fmt, lowerIsBetter) : { label, key: null, now: null, fmt, lowerIsBetter, missing: t(UNLINKED, UNLINKED_EN) });
  const cpm = st(t('تكلفة الألف ظهور', 'Cost per 1,000 impressions'), 'cpm', 'sar', true), cpc = st(t('تكلفة النقرة', 'Cost per click'), 'cpc', 'sar', true);
  const cpl = st(t('تكلفة الليد', 'Cost per lead'), 'cpl', 'sar', true), cac = st(t('تكلفة العميل', 'Cost per customer'), 'cac', 'sar', true, linked);
  // The sales amount: every paid closing in the CRM (all platforms), or this platform's ad-linked ones. When the closings
  // aren't tied to ads it is the CRM's total, said so, and the ads' share is «غير مربوط» rather than 0.
  const amount = st(a.crm && !tied ? t('إجمالي المدفوع (CRM)', 'Total paid (CRM)') : t('مبلغ المبيعات', 'Sales amount'), 'paid', 'sar', false, linked);
  const raw: Omit<JStage, 'width' | 'colour'>[] = [
    { n: t('الوعي', 'Awareness'), hint: t('كم شخص شاف الإعلان', 'How many saw the ad'), main: st(t('الظهور', 'Impressions'), 'impr', 'qty'), sub: [cpm], cost: cpm },
    { n: t('الاهتمام', 'Interest'), hint: t('كم واحد ضغط', 'How many clicked'), main: st(t('نقرات الرابط والسوايب', 'Link clicks and swipes'), 'clicks', 'qty'),
      sub: [cpc], rate: st(t('نسبة النقر', 'Click rate'), 'ctr', 'pct'), cost: cpc },
    { n: t('التحويل', 'Conversion'), hint: t('كم واحد ترك بياناته أو راسلنا', 'How many left details or messaged us'), main: st(t('الليدز', 'Leads'), 'leads', 'qty'),
      sub: [cpl, st(t('محادثات واتساب وماسنجر', 'WhatsApp and Messenger chats'), 'conv', 'qty')],
      rate: st(t('من نقرة إلى ليد أو محادثة', 'Click to lead or chat'), 'clickToResult', 'pct'), cost: cpl },
    { n: t('البيع', 'Sale'), hint: linked ? t('كم واحد دفع', 'How many paid') : t('نظام العملاء مو موصول بهالأرقام', 'The CRM is not connected to these numbers'),
      // Same as the main dashboard: every paid closing in the CRM, or the ad-linked ones when that list is missing
      main: st(t('إقفالات مدفوعة', 'Paid closings'), a.crm ? 'closings' : 'booked', 'qty', false, linked),
      sub: [amount, ...(a.crm ? [ad(t('المبيعات من الإعلانات', 'Sales from ads'), 'value', 'sar')] : []), ad(t('إقفالات من الإعلانات', 'Closings from ads'), 'booked', 'qty'),
        ad(t('العائد من الإعلانات', 'Return from ads'), 'roas', 'x'), cac],
      // CRM-wide when the CRM has its paid list (judged even when not tied to ads); else the ad-linked rate or «غير مربوط»
      rate: a.closeRateAll != null ? st(t('من ليد إلى إقفالة', 'Lead to closing'), 'closeRateAll', 'pct') : ad(t('من ليد إلى إقفالة', 'Lead to closing'), 'closeRate', 'pct'), cost: cac, amount },
  ];
  return { stages: raw.map((s, i) => ({ ...s, width: FUNNEL_WIDTHS[i]!, colour: FUNNEL_COLOURS[i]! })), noCrm: linked ? null : t(NO_CRM, NO_CRM_EN) };
}

// ---- Wins of the period against the one before it (template.html renderWins). "New winning ads" stays out: the main
// dashboard keeps it off (WIN_ON = false) until winners are judged on closed patients.
// name: an ad or idea name inside the detail (data, in whatever language it was written): shown isolated before it
export interface Win { icon: string; title: string; detail: string; name?: string }
// Idea = the same creative across ad sets and platforms: the name without the uploaded file prefix and the Spark/copy suffix
export function ideaKey(name: string): string {
  let n = String(name || '').replace(/[‎‏‪-‮]/g, '');
  n = n.replace(/^.*?\.(mp4|mov|webm|jpe?g|png|gif)_/i, '').replace(/\s*-\s*(spark|own)\s*$/i, '').replace(/\s*[-–]?\s*(copy|نسخة)(\s*\d+)?\s*$/i, '');
  return n.toLowerCase().replace(/\s+/g, ' ').trim() || 'ad:' + name;
}
type Sum = { spend: number; leads: number; conv: number; ls: number; ln: number };
const blank = (): Sum => ({ spend: 0, leads: 0, conv: 0, ls: 0, ln: 0 });
const cplOf = (o: Sum) => (o.ln ? o.ls / o.ln : null);
function sums(d: Dash, from: string, to: string) {
  const tot = blank(), plat = new Map<string, Sum>(), dept = new Map<string, Sum>(), idea = new Map<string, Sum & { name: string }>(), day = new Map<string, number>(), ads = new Set<string>();
  for (const x of rows(d, from, to)) {
    const lead = x.ad.goal === 'lead';
    for (const o of [tot, plat.get(x.ad.platform) ?? (plat.set(x.ad.platform, blank()), plat.get(x.ad.platform)!), dept.get(x.ad.dept || 'brand') ?? (dept.set(x.ad.dept || 'brand', blank()), dept.get(x.ad.dept || 'brand')!)]) {
      o.spend += x.spend; o.leads += x.leads; o.conv += x.conv; if (lead) { o.ls += x.spend; o.ln += x.leads; }
    }
    if (lead) { const k = ideaKey(x.ad.name), o = idea.get(k) ?? { ...blank(), name: x.ad.name }; o.ls += x.spend; o.ln += x.leads; idea.set(k, o); }
    day.set(x.day, (day.get(x.day) ?? 0) + x.leads);
    ads.add(x.key);
  }
  return { tot, plat, dept, idea, day, ads };
}
const pctCh = (x: number | null, y: number | null) => (x != null && y ? (100 * (x - y)) / Math.abs(y) : null);
const r0 = (v: number) => Math.round(v).toLocaleString('en-US');
const r2 = (v: number | null) => (v == null ? '—' : v.toFixed(2));
const few = (n: number, one: string, two: string, many: string) => (n === 1 ? one : n === 2 ? two : `${n} ${n <= 10 ? many : one}`);

export function wins(d: Dash, from: string, to: string, compare: boolean): Win[] {
  const out: Win[] = [];
  const A = sums(d, from, to), days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const pf = addDays(from, -days), pt = addDays(from, -1), B = compare ? sums(d, pf, pt) : null;
  if (B) {
    const c = pctCh(A.tot.leads, B.tot.leads);
    if (c != null && c >= 3) out.push({ icon: '📈', title: T(`الليدز زادت ${r0(c)}%`, `Leads up ${r0(c)}%`), detail: T(`${r0(A.tot.leads)} ليد مقابل ${r0(B.tot.leads)}`, `${r0(A.tot.leads)} leads vs ${r0(B.tot.leads)}`) });
    const l = pctCh(cplOf(A.tot), cplOf(B.tot));
    if (l != null && l <= -3) out.push({ icon: '💰', title: T(`تكلفة الليد نزلت ${r0(-l)}%`, `Cost per lead down ${r0(-l)}%`), detail: T(`${r2(cplOf(A.tot))} ريال مقابل ${r2(cplOf(B.tot))}`, `${r2(cplOf(A.tot))} SAR vs ${r2(cplOf(B.tot))}`) });
    const m = pctCh(A.tot.conv, B.tot.conv);
    if (m != null && m >= 5 && A.tot.conv >= 10) out.push({ icon: '💬', title: T(`المحادثات زادت ${r0(m)}%`, `Conversations up ${r0(m)}%`), detail: T(`${r0(A.tot.conv)} محادثة مقابل ${r0(B.tot.conv)}`, `${r0(A.tot.conv)} conversations vs ${r0(B.tot.conv)}`) });
  }
  const best = [...A.idea.values()].filter(y => y.ln >= 10).sort((p, q) => p.ls / p.ln - q.ls / q.ln)[0];
  if (best) out.push({ icon: '🎬', title: T('أرخص فكرة في الفترة', 'Cheapest idea in the period'), name: best.name, detail: T(`${r0(best.ln)} ليد بـ ${r2(best.ls / best.ln)} ريال`, `${r0(best.ln)} leads at ${r2(best.ls / best.ln)} SAR`) });
  if (B) {
    const better = (a: Map<string, Sum>, b: Map<string, Sum>, keys: string[]) => keys.map(k => {
      const x = a.get(k) ?? blank(), y = b.get(k) ?? blank();
      return { k, x, y, c: x.ln >= 10 && cplOf(y) ? pctCh(cplOf(x), cplOf(y)) : null };
    }).filter(r => r.c != null && r.c <= -5).sort((p, q) => p.c! - q.c!)[0];
    const names = depts(d, from, to);
    const dp = better(A.dept, B.dept, names.map(x => x.key));
    if (dp) out.push({ icon: '🩺', title: T(`${names.find(x => x.key === dp.k)!.name}: تكلفة الليد نزلت ${r0(-dp.c!)}%`, `${names.find(x => x.key === dp.k)!.name}: cost per lead down ${r0(-dp.c!)}%`), detail: T(`${r2(cplOf(dp.x))} ريال مقابل ${r2(cplOf(dp.y))}`, `${r2(cplOf(dp.x))} SAR vs ${r2(cplOf(dp.y))}`) });
    const pl = better(A.plat, B.plat, [...A.plat.keys()]);
    if (pl) out.push({ icon: '📣', title: T(`${platformName(family(pl.k))}: تكلفة الليد نزلت ${r0(-pl.c!)}%`, `${platformName(family(pl.k))}: cost per lead down ${r0(-pl.c!)}%`), detail: T(`${r2(cplOf(pl.x))} ريال مقابل ${r2(cplOf(pl.y))}`, `${r2(cplOf(pl.x))} SAR vs ${r2(cplOf(pl.y))}`) });
  }
  // A lead day above every day before the period, since the data starts
  const top = [...A.day.entries()].sort((p, q) => q[1] - p[1])[0];
  if (top && d.range?.start) {
    const before = sums(d, d.range.start, addDays(from, -1)), rec = Math.max(0, ...before.day.values());
    if (top[1] > rec && rec > 0) out.push({ icon: '⭐', title: T('أعلى يوم ليدز من بداية البيانات', 'Best lead day since the data began'), detail: T(`${top[0]} · ${r0(top[1])} ليد`, `${top[0]} · ${r0(top[1])} leads`) });
  }
  // Launches: campaigns and ads whose first spend is inside the period
  const firstAd = new Map<string, string>(), firstCamp = new Map<string, string>();
  for (const r of d.rows ?? []) {
    const k = String(r[0]), day = String(r[1]), ad = d.ads?.[k];
    if (!num(r[2]) || !ad) continue;
    const b = k.split('|')[0]!, c = `${ad.platform}|${ad.campaign}`;
    if (!firstAd.has(b) || day < firstAd.get(b)!) firstAd.set(b, day);
    if (!firstCamp.has(c) || day < firstCamp.get(c)!) firstCamp.set(c, day);
  }
  const camps = new Set<string>(), newAds = new Set<string>();
  for (const k of A.ads) {
    const ad = d.ads![k]!, b = k.split('|')[0]!, c = `${ad.platform}|${ad.campaign}`;
    if ((firstCamp.get(c) ?? '') >= from) camps.add(c);
    if ((firstAd.get(b) ?? '') >= from) newAds.add(b);
  }
  const en = pageLang() === 'en', many = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);
  const launched = en ? [camps.size && many(camps.size, 'campaign'), newAds.size && many(newAds.size, 'new ad')].filter(Boolean)
    : [camps.size && few(camps.size, 'حملة', 'حملتين', 'حملات'), newAds.size && few(newAds.size, 'إعلان جديد', 'إعلانين جداد', 'إعلانات جديدة')].filter(Boolean);
  if (launched.length) out.push({ icon: '🚀', title: en ? `Launched ${launched.join(' and ')}` : `أطلقنا ${launched.join(' و')}`, detail: T('أول صرف لها كان في هالفترة', 'Their first spend was in this period') });
  return out;
}

// ---- The trend by day, week (from Sunday) or month (template.html granOf + buckets). Auto: day up to 62 days, week to 200, then month.
export type Gran = 'auto' | 'day' | 'week' | 'month';
// One bar of the trend chart. `plat` = each shown platform's part, for the stacked bars (template.html stacked());
// hidden platforms count in the totals only, like everywhere else
export interface PlatPart { spend: number; results: number; leads: number }
export interface Bucket { day: string; spend: number; results: number; leads: number; impr: number; clicks: number; cpl: Record<string, number | null>; plat: Record<string, PlatPart> }
export function granOf(from: string, to: string, g: Gran): Exclude<Gran, 'auto'> {
  if (g !== 'auto') return g;
  const n = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  return n > 200 ? 'month' : n > 62 ? 'week' : 'day';
}
export function buckets(d: Dash, from: string, to: string, g: Gran = 'auto'): Bucket[] {
  const gr = granOf(from, to, g);
  const key = (day: string) => (gr === 'day' ? day : gr === 'week' ? addDays(day, -new Date(day + 'T00:00:00Z').getUTCDay()) : day.slice(0, 8) + '01');
  const out = new Map<string, Bucket & { ls: Record<string, number>; ln: Record<string, number> }>();
  for (let day = from; day <= to; day = addDays(day, 1)) { const k = key(day); if (!out.has(k)) out.set(k, { day: k, spend: 0, results: 0, leads: 0, impr: 0, clicks: 0, cpl: {}, plat: {}, ls: {}, ln: {} }); }
  for (const x of rows(d, from, to)) {
    const b = out.get(key(x.day))!;
    b.spend += x.spend; b.results += x.leads + x.conv; b.leads += x.leads; b.impr += x.impr; b.clicks += x.clicks;
    const p = x.ad.platform;
    if (!HIDDEN.has(p)) { const o = (b.plat[p] ??= { spend: 0, results: 0, leads: 0 }); o.spend += x.spend; o.results += x.leads + x.conv; o.leads += x.leads; }
    if (x.ad.goal === 'lead' && !HIDDEN.has(p)) { b.ls[p] = (b.ls[p] ?? 0) + x.spend; b.ln[p] = (b.ln[p] ?? 0) + x.leads; }
  }
  return [...out.values()].map(({ ls, ln, ...b }) => ({ ...b, cpl: Object.fromEntries(Object.keys(ls).map(p => [p, ln[p] && ls[p]! > 0 ? ls[p]! / ln[p]! : null])) }));
}
