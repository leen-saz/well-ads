// تحليل رحلة العميل بالقواعد (بدون نموذج وبدون ما تطلع الأرقام لأي مكان): كل خطوة بين مرحلتين تنقارن بنفس الخطوة في
// الفترة اللي قبلها، وبالوسيط اليومي لآخر 30 يوم، وبحد أدنى معقول. الخطوة ضعيفة بس إذا كانت أضعف من كل مرجع عندها بفرق
// واضح، أو تحت حدها الأدنى. وإذا ما فيه شي من هذا: «لا توجد مشكلة واضحة». كل النصوص بالعربي والإنجليزي حسب لغة الصفحة.
// وهنا بعد شكل الشريط: ارتفاع كل مرحلة من حجمها (مقياس مخفّف) وضيق الوصلة من قوة الخطوة، واتجاهه حسب اللغة.
import type { Dash } from './numbers';
import { addDays } from './numbers';
import { type Outcome, unattributed } from './analytics';
import { type Lang, pick as tr } from './lang';

export type StepKey = 'click' | 'lead' | 'sale' | 'cpl';
export type Level = 'bad' | 'watch' | 'ok';

// Below the floor the step is weak whatever the history says. Rates in %; cost per lead has no floor (SAR varies by offer).
export const FLOORS: Record<'click' | 'lead' | 'sale', number> = { click: 0.7, lead: 1.5, sale: 2 };
// How much weaker than every reference before it counts: 15% → watch, 30% → bad. Smaller gaps are normal noise.
export const WATCH = 0.85, BAD = 0.7;
const MIN_DAYS = 7;

export interface Step {
  key: StepKey;
  label: string;
  // The link it sits on in the funnel: 0 = awareness→interest, 1 = interest→conversion, 2 = conversion→sale. cpl sits on stage 2.
  link: number;
  now: number | null; prev: number | null; median: number | null; floor: number | null;
  lowerIsBetter: boolean;
  // 1 = as usual; below 1 = weaker than every reference it has (the closest of them). null = nothing to judge.
  score: number | null;
  level: Level;
  // Not tied to ads (analytics.ts unattributed): shown as «غير مربوط», never scored, never the bottleneck
  unattributed: boolean;
  line: string;
}

export interface Verdict { step: StepKey | null; level: Level; title: string; where: string; why: string; todo: string; unlinked: { why: string; todo: string } | null }

const med = (xs: number[]): number | null => {
  if (xs.length < MIN_DAYS) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);

// The usual level of each step: the median of its daily values over the 30 days up to `to`, counting only days with
// enough volume to mean something. Ad-linked closings are too few per day, so the sale step has none.
export function medians(d: Dash, to: string, plat?: string): { click: number | null; lead: number | null; cpl: number | null } {
  const from = addDays(to, -29);
  const day = new Map<string, { impr: number; clicks: number; res: number; ls: number; ln: number }>();
  for (const r of d.rows ?? []) {
    const k = String(r[0]), dd = String(r[1]), ad = d.ads?.[k];
    if (dd < from || dd > to || !ad || (plat && ad.platform !== plat)) continue;
    const o = day.get(dd) ?? { impr: 0, clicks: 0, res: 0, ls: 0, ln: 0 };
    o.impr += num(r[3]); o.clicks += num(r[4]); o.res += num(r[5]) + num(r[6]);
    if (ad.goal === 'lead') { o.ls += num(r[2]); o.ln += num(r[5]); }
    day.set(dd, o);
  }
  const v = [...day.values()];
  return {
    click: med(v.filter(o => o.impr >= 200).map(o => (100 * o.clicks) / o.impr)),
    lead: med(v.filter(o => o.clicks >= 20).map(o => (100 * o.res) / o.clicks)),
    cpl: med(v.filter(o => o.ln >= 1).map(o => o.ls / o.ln)),
  };
}

// The score against the history: the best of the comparisons, so a step "close to usual" is never called weak just
// because the earlier period was better (and the other way round). Under the floor it is weak anyway.
function judge(now: number | null, prev: number | null, median: number | null, floor: number | null, lowerIsBetter: boolean): number | null {
  if (now == null) return null;
  const r: number[] = [];
  const ratio = (ref: number | null) => (ref ? (lowerIsBetter ? (now ? ref / now : null) : now / ref) : null);
  for (const ref of [prev, median]) { const x = ratio(ref); if (x != null) r.push(x); }
  const hist = r.length ? Math.max(...r) : 1;
  return floor != null && now < floor ? Math.min(hist, now / floor) : hist;
}
const levelOf = (score: number | null, belowFloor: boolean): Level => (score == null ? 'ok' : belowFloor || score < BAD ? 'bad' : score < WATCH ? 'watch' : 'ok');

// One sentence per step: against the earlier period, the usual level and the floor
function sentence(l: Lang, label: string, now: number | null, prev: number | null, median: number | null, floor: number | null, fmt: (v: number) => string): string {
  const t = (ar: string, en: string) => tr(l, ar, en);
  if (now == null) return `${label}: ${t('ما فيه أرقام كفاية.', 'not enough numbers.')}`;
  const parts: string[] = [];
  if (prev) {
    const ch = (100 * (now - prev)) / prev, n = Math.abs(ch).toFixed(0);
    parts.push(Math.abs(ch) < 5 ? t('نفس الفترة السابقة تقريبًا', 'about the same as the earlier period')
      : ch > 0 ? t(`أعلى من الفترة السابقة بـ ${n}%`, `${n}% higher than the earlier period`) : t(`أقل من الفترة السابقة بـ ${n}%`, `${n}% lower than the earlier period`));
  }
  if (median) {
    const ch = (now - median) / median;
    parts.push(Math.abs(ch) < 0.1 ? t(`قريب من المعتاد (${fmt(median)})`, `close to usual (${fmt(median)})`)
      : ch > 0 ? t(`أعلى من المعتاد (${fmt(median)})`, `above usual (${fmt(median)})`) : t(`أقل من المعتاد (${fmt(median)})`, `below usual (${fmt(median)})`));
  }
  if (floor != null && now < floor) parts.push(t(`وتحت الحد المقبول (${fmt(floor)})`, `and under the floor (${fmt(floor)})`));
  return `${label} ${fmt(now)}${parts.length ? ': ' + parts.join(t('، ', ', ')) : ''}.`;
}

// The four steps of the period. b is the earlier period's outcome, only when the comparison is valid.
export function steps(a: Outcome, b: Partial<Outcome> | null, m: { click: number | null; lead: number | null; cpl: number | null }, l: Lang = 'ar'): Step[] {
  const t = (ar: string, en: string) => tr(l, ar, en);
  const pc = (v: number) => `${v.toFixed(2)}%`, money = (v: number) => `${v.toFixed(2)} ${t('ر.س', 'SAR')}`;
  const mk = (key: StepKey, label: string, link: number, now: number | null, prev: number | null, median: number | null, floor: number | null, lowerIsBetter: boolean, fmt: (v: number) => string, off = false): Step => {
    if (off) return { key, label, link, now: null, prev: null, median: null, floor, lowerIsBetter, score: null, level: 'ok', unattributed: true, line: unlinkedLine(a, l) };
    const score = judge(now, prev, median, floor, lowerIsBetter);
    const below = floor != null && now != null && now < floor;
    return { key, label, link, now, prev, median, floor, lowerIsBetter, score, level: levelOf(score, below), unattributed: false, line: sentence(l, label, now, prev, median, floor, fmt) };
  };
  const off = unattributed(a);
  return [
    mk('click', t('نسبة النقر', 'Click rate'), 0, a.ctr, b?.ctr ?? null, m.click, FLOORS.click, false, pc),
    mk('lead', t('من نقرة إلى ليد أو محادثة', 'Click to lead or chat'), 1, a.clickToResult, b?.clickToResult ?? null, m.lead, FLOORS.lead, false, pc),
    // The earlier period's rate only counts when it was tied to ads too (b.closeRate is null otherwise)
    mk('sale', t('من ليد إلى إقفالة', 'Lead to closing'), 2, a.closeRate, b && !unattributed(b as Outcome) ? b.closeRate ?? null : null, null, FLOORS.sale, false, pc, off),
    mk('cpl', t('تكلفة الليد', 'Cost per lead'), 1, a.cpl, b?.cpl ?? null, m.cpl, null, true, money),
  ];
}

// Why the sale step is «غير مربوط», in the reader's words
function unlinkedLine(a: Outcome, l: Lang): string {
  const t = (ar: string, en: string) => tr(l, ar, en);
  if (!a.crmLinked) return t('غير مربوط: نظام العملاء مو موصول بهالأرقام، فما نعرف كم ليد صار إقفالة.', 'Not linked: the CRM is not connected to these numbers, so we cannot tell how many leads closed.');
  if (a.closingsAll > 0 && a.bookedAll === 0) return t(`غير مربوط: في نظام العملاء ${a.closingsAll} إقفالة مدفوعة بس ولا وحدة منها مربوطة بإعلان، فنسبة الإقفال من الإعلانات ما تنحسب (مو صفر).`,
    `Not linked: the CRM has ${a.closingsAll} paid closings but none is tied to an ad, so the ad close rate cannot be computed (it is not zero).`);
  return t(`غير مربوط: أغلب الليدز ما انربطت بإعلان في نظام العملاء (${a.crmLeads} من ${a.leads + a.conv})، فنسبة الإقفال ما تنحكم.`,
    `Not linked: most leads are not tied to an ad in the CRM (${a.crmLeads} of ${a.leads + a.conv}), so the close rate cannot be judged.`);
}

type Advice = { title: string; where: string; why: string; todo: string };
// Not a bottleneck: the sale step just can't be read until the CRM ties closings to ads
const UNLINKED_ADVICE: Record<Lang, { why: string; todo: string }> = {
  ar: { why: 'الإقفالات ما توصل من نظام العملاء مربوطة بإعلاناتها، فما نقدر نقول وين تضيع الليدز بعد التواصل.', todo: 'شيك على ربط نظام العملاء من صفحة الربط، وتأكد إن كل ليد يوصل ومعه رقم الإعلان.' },
  en: { why: 'Closings reach us from the CRM without their ads, so we cannot tell where leads drop after contact.', todo: 'Check the CRM link on the Connectors page and make sure every lead arrives with its ad id.' },
};
const ADVICE: Record<Lang, Record<StepKey, Advice>> = {
  ar: {
    click: { title: 'الإعلان ما يجيب نقرات كفاية', where: 'من الظهور للنقرة', why: 'الإعلان ما يشد: الصورة أو أول سطر ما يوقف اللي يمرر.', todo: 'جرّب مادة جديدة، وغيّر أول سطر والعنوان، وابدأ بالفايدة أو بسؤال يلمس المشكلة.' },
    lead: { title: 'النقرات ما تصير ليدز', where: 'من النقرة لليد', why: 'الناس تضغط بس ما تكمل: النموذج طويل، أو الصفحة بطيئة، أو دخول الواتساب فيه خطوة زايدة.', todo: 'قصّر النموذج، وشيك على سرعة الصفحة من الجوال، وجرّب رسالة الواتساب الجاهزة بنفسك.' },
    sale: { title: 'الليدز ما تصير إقفالات', where: 'من الليد للإقفالة', why: 'المتابعة متأخرة، أو جودة الليدز نازلة.', todo: 'شيك كم ياخذ الفريق عشان يرد على الليد، وراجع أسئلة النموذج عشان تفلتر الجادين.' },
    cpl: { title: 'تكلفة الليد طالعة', where: 'تكلفة الليد', why: 'الجمهور تشبّع، أو المواد تعبت من كثر ما انعرضت.', todo: 'وسّع الجمهور أو غيّره، وبدّل المواد اللي صار لها فترة طويلة تنعرض.' },
  },
  en: {
    click: { title: 'The ads get too few clicks', where: 'Impression to click', why: 'The ad does not stop the scroll: the image or the first line.', todo: 'Try a new creative and a new first line and headline; lead with the benefit or a question about the problem.' },
    lead: { title: 'Clicks are not becoming leads', where: 'Click to lead', why: 'People click but do not finish: a long form, a slow page, or an extra step into WhatsApp.', todo: 'Shorten the form, check the page speed on a phone, and try the WhatsApp entry yourself.' },
    sale: { title: 'Leads are not closing', where: 'Lead to closing', why: 'Follow-up is slow, or lead quality dropped.', todo: 'Check how long the team takes to answer a lead, and tighten the form questions to filter serious ones.' },
    cpl: { title: 'Cost per lead is rising', where: 'Cost per lead', why: 'The audience is saturated, or the creatives are worn out from running too long.', todo: 'Widen or change the audience, and replace creatives that have run for a long time.' },
  },
};

// The bottleneck: the weakest step that can be judged, under-the-floor (bad) before only-weaker (watch). Nothing weak
// enough: «لا توجد مشكلة واضحة», with no step singled out. An unattributed step is never it; it gets its own note.
export function verdict(list: Step[], l: Lang = 'ar'): Verdict {
  const unlinked = list.some(s => s.unattributed) ? UNLINKED_ADVICE[l] : null;
  const rank: Record<Level, number> = { bad: 0, watch: 1, ok: 2 };
  const top = list.filter(s => s.score != null).sort((x, y) => rank[x.level] - rank[y.level] || x.score! - y.score!)[0];
  if (!top) return { step: null, level: 'ok', title: tr(l, 'ما فيه أرقام كفاية للتحليل', 'Not enough numbers to judge'), where: '', why: '', todo: '', unlinked };
  if (top.level === 'ok') return { step: null, level: 'ok', title: tr(l, 'لا توجد مشكلة واضحة', 'No clear problem'), where: '',
    why: tr(l, 'كل خطوة في حدودها المعتادة أو قريبة منها، وما فيه شي تحت حده الأدنى.', 'Every step is at or near its usual level and nothing is under its floor.'), todo: tr(l, 'كمّل على نفس الخطة.', 'Keep the plan.'), unlinked };
  const a = ADVICE[l][top.key];
  return { step: top.key, level: top.level, title: a.title, where: a.where, why: a.why, todo: a.todo, unlinked };
}

// ---- The band. Heights on an eased scale ((v / top)^EASE) between minH and maxH: it visibly shrinks with the numbers
// (a log scale made 1.9M impressions and 27K clicks look alike) while the sale stage stays visible. Every link narrows
// into a neck (NECK of the smaller stage), pinched further by a weak step's score, so a weak step reads as the bottleneck.
export const EASE = 0.25, NECK = 0.6, MIN_NECK = 8;
export interface Shape { heights: number[]; waists: number[] }
export function shape(volumes: (number | null)[], linkScores: (number | null)[], maxH: number, minH: number): Shape {
  const top = Math.max(1, ...volumes.map(v => v ?? 0));
  const h = (v: number | null) => (v == null || v <= 0 ? minH : minH + (maxH - minH) * (v / top) ** EASE);
  const heights = volumes.map(h);
  const waists = linkScores.map((s, i) => Math.max(MIN_NECK, Math.min(heights[i]!, heights[i + 1]!) * NECK * Math.max(0.35, Math.min(1, s ?? 1))));
  return { heights, waists };
}

// Where stage i sits: stage 1 on the right when the page reads right to left (Arabic), on the left in English
export const stageX = (i: number, n: number, width: number, rtl = true): number => (rtl ? width - (i + 0.5) * (width / n) : (i + 0.5) * (width / n));
export const linkX = (i: number, n: number, width: number, rtl = true): number => (stageX(i, n, width, rtl) + stageX(i + 1, n, width, rtl)) / 2;

// The band's points left to right for d3-shape's area: a flat run over each stage and a waist between stages
export function points(s: Shape, width: number, rtl = true, plateau = 0.42): { x: number; h: number }[] {
  const n = s.heights.length, slot = width / n, cx = (i: number) => stageX(i, n, width, rtl);
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => cx(i) - cx(j));
  const out: { x: number; h: number }[] = [];
  order.forEach((i, k) => {
    out.push({ x: cx(i) - (slot * plateau) / 2, h: s.heights[i]! }, { x: cx(i) + (slot * plateau) / 2, h: s.heights[i]! });
    const j = order[k + 1];
    if (j != null) out.push({ x: (cx(i) + cx(j)) / 2, h: s.waists[Math.min(i, j)]! });
  });
  out[0] = { ...out[0]!, x: 0 }; out[out.length - 1] = { ...out[out.length - 1]!, x: width };
  return out;
}
