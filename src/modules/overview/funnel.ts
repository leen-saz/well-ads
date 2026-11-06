// تحليل رحلة العميل بالقواعد (بدون نموذج وبدون ما تطلع الأرقام لأي مكان): كل خطوة بين مرحلتين تنقارن بنفس الخطوة في
// الفترة اللي قبلها، وبالوسيط اليومي لآخر 30 يوم، وبحد أدنى معقول. أضعف خطوة هي عنق الزجاجة، ولها سبب واقتراح.
// وهنا بعد شكل الشريط: ارتفاع كل مرحلة من حجمها (مقياس لوغاريتمي) وضيق الوصلة من قوة الخطوة.
import type { Dash } from './numbers';
import { addDays } from './numbers';
import type { Outcome } from './analytics';

export type StepKey = 'click' | 'lead' | 'sale' | 'cpl';
export type Level = 'bad' | 'watch' | 'ok';

// Below the floor the step is weak whatever the history says. Rates in %; cost per lead has no floor (SAR varies by offer).
export const FLOORS: Record<'click' | 'lead' | 'sale', number> = { click: 0.7, lead: 1.5, sale: 2 };
// The share of leads the CRM should have tied to an ad before the sale step can be judged
export const MIN_CRM_COVERAGE = 0.3;
const MIN_DAYS = 7;

export interface Step {
  key: StepKey;
  label: string;
  // The link it sits on in the funnel: 0 = awareness→interest, 1 = interest→conversion, 2 = conversion→sale. cpl sits on stage 2.
  link: number;
  now: number | null; prev: number | null; median: number | null; floor: number | null;
  lowerIsBetter: boolean;
  // 1 = as usual; below 1 = weaker (the lowest of the comparisons). null = nothing to judge.
  score: number | null;
  level: Level;
  crmGap: boolean;
  line: string;
}

export interface Verdict { step: StepKey | 'crm' | null; level: Level; title: string; where: string; why: string; todo: string }

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

const pc = (v: number) => `${v.toFixed(2)}%`;
const money = (v: number) => `${v.toFixed(2)} ر.س`;

function judge(now: number | null, prev: number | null, median: number | null, floor: number | null, lowerIsBetter: boolean): number | null {
  if (now == null) return null;
  const r: number[] = [];
  const ratio = (ref: number | null) => (ref ? (lowerIsBetter ? (now ? ref / now : null) : now / ref) : null);
  for (const ref of [prev, median]) { const x = ratio(ref); if (x != null) r.push(x); }
  if (floor != null && now < floor) r.push(now / floor);
  return r.length ? Math.min(...r) : 1;
}
const levelOf = (score: number | null, belowFloor: boolean): Level => (score == null ? 'ok' : belowFloor || score < 0.75 ? 'bad' : score < 0.9 ? 'watch' : 'ok');

// One sentence per step: against the earlier period, the usual level and the floor
function sentence(label: string, now: number | null, prev: number | null, median: number | null, floor: number | null, fmt: (v: number) => string): string {
  if (now == null) return `${label}: ما فيه أرقام كفاية.`;
  const parts: string[] = [];
  if (prev) {
    const ch = (100 * (now - prev)) / prev;
    parts.push(Math.abs(ch) < 5 ? 'نفس الفترة اللي قبلها تقريبًا' : `${ch > 0 ? 'أعلى' : 'أقل'} من الفترة اللي قبلها بـ ${Math.abs(ch).toFixed(0)}%`);
  }
  if (median) {
    const ch = (now - median) / median;
    parts.push(Math.abs(ch) < 0.1 ? `قريب من المعتاد (${fmt(median)})` : `${ch > 0 ? 'أعلى' : 'أقل'} من المعتاد (${fmt(median)})`);
  }
  if (floor != null && now < floor) parts.push(`وتحت الحد المقبول (${fmt(floor)})`);
  return `${label} ${fmt(now)}${parts.length ? ': ' + parts.join('، ') : ''}.`;
}

// The four steps of the period. b is the earlier period's outcome, only when the comparison is valid.
export function steps(a: Outcome, b: Partial<Outcome> | null, m: { click: number | null; lead: number | null; cpl: number | null }): Step[] {
  const mk = (key: StepKey, label: string, link: number, now: number | null, prev: number | null, median: number | null, floor: number | null, lowerIsBetter: boolean, fmt: (v: number) => string, crmGap = false): Step => {
    const score = crmGap ? 0 : judge(now, prev, median, floor, lowerIsBetter);
    const below = floor != null && now != null && now < floor;
    const line = crmGap
      ? (a.crmLinked ? `أغلب الليدز ما انربطت بإعلان في نظام العملاء (${a.crmLeads} من ${a.leads + a.conv})، فنسبة الإقفال ما تنحكم.` : 'نظام العملاء مو موصول بهالأرقام، فما نعرف كم ليد صار إقفالة.')
      : sentence(label, now, prev, median, floor, fmt);
    return { key, label, link, now, prev, median, floor, lowerIsBetter, score, level: crmGap ? 'bad' : levelOf(score, below), crmGap, line };
  };
  const results = a.leads + a.conv;
  const crmGap = !a.crmLinked || (results >= 10 && a.crmLeads < MIN_CRM_COVERAGE * results);
  return [
    mk('click', 'نسبة النقر', 0, a.ctr, b?.ctr ?? null, m.click, FLOORS.click, false, pc),
    mk('lead', 'من نقرة إلى ليد أو محادثة', 1, a.clickToResult, b?.clickToResult ?? null, m.lead, FLOORS.lead, false, pc),
    mk('sale', 'من ليد إلى إقفالة', 2, crmGap ? null : a.closeRate, crmGap ? null : b?.closeRate ?? null, null, FLOORS.sale, false, pc, crmGap),
    mk('cpl', 'تكلفة الليد', 1, a.cpl, b?.cpl ?? null, m.cpl, null, true, money),
  ];
}

const ADVICE: Record<StepKey | 'crm', { title: string; where: string; why: string; todo: string }> = {
  click: { title: 'الإعلان ما يجيب نقرات كفاية', where: 'من الظهور للنقرة', why: 'الإعلان ما يشد: الصورة أو أول سطر ما يوقف اللي يمرر.', todo: 'جرّب مادة جديدة، وغيّر أول سطر والعنوان، وابدأ بالفايدة أو بسؤال يلمس المشكلة.' },
  lead: { title: 'النقرات ما تصير ليدز', where: 'من النقرة لليد', why: 'الناس تضغط بس ما تكمل: النموذج طويل، أو الصفحة بطيئة، أو دخول الواتساب فيه خطوة زايدة.', todo: 'قصّر النموذج، وشيك على سرعة الصفحة من الجوال، وجرّب رسالة الواتساب الجاهزة بنفسك.' },
  sale: { title: 'الليدز ما تصير إقفالات', where: 'من الليد للإقفالة', why: 'المتابعة متأخرة، أو جودة الليدز نازلة.', todo: 'شيك كم ياخذ الفريق عشان يرد على الليد، وراجع أسئلة النموذج عشان تفلتر الجادين.' },
  cpl: { title: 'تكلفة الليد طالعة', where: 'تكلفة الليد', why: 'الجمهور تشبّع، أو المواد تعبت من كثر ما انعرضت.', todo: 'وسّع الجمهور أو غيّره، وبدّل المواد اللي صار لها فترة طويلة تنعرض.' },
  crm: { title: 'أرقام البيع ناقصة', where: 'مرحلة البيع', why: 'الإقفالات ما توصل من نظام العملاء، أو أغلب الليدز ما انربطت بإعلان.', todo: 'شيك على ربط نظام العملاء من صفحة الربط، وتأكد إن كل ليد يوصل ومعه رقم الإعلان.' },
};

// The bottleneck: the weakest step. A CRM gap comes first (the sale step can't be judged without it).
export function verdict(list: Step[]): Verdict {
  const gap = list.find(s => s.crmGap);
  const pick = gap ?? [...list].filter(s => s.score != null).sort((x, y) => x.score! - y.score!)[0];
  if (!pick) return { step: null, level: 'ok', title: 'ما فيه أرقام كفاية للتحليل', where: '', why: '', todo: '' };
  const key = gap ? 'crm' : pick.key;
  const a = ADVICE[key];
  if (pick.level === 'ok') return { step: pick.key, level: 'ok', title: 'ما فيه عنق زجاجة واضح', where: a.where, why: `أضعف خطوة ${a.where}، بس هي في حدودها المعتادة.`, todo: 'كمّل على نفس الخطة وراقب هالخطوة.' };
  return { step: pick.key, level: pick.level, title: a.title, where: a.where, why: a.why, todo: a.todo };
}

// ---- The band. Heights on a log scale between minH and maxH so the sale stage stays visible next to the impressions;
// each link's waist is the smaller of its two stages, pinched by the step's score (a weak step looks like a bottleneck).
export interface Shape { heights: number[]; waists: number[] }
export function shape(volumes: (number | null)[], linkScores: (number | null)[], maxH: number, minH: number): Shape {
  const top = Math.max(1, ...volumes.map(v => v ?? 0));
  const h = (v: number | null) => (v == null || v <= 0 ? minH : minH + ((maxH - minH) * Math.log10(v + 1)) / Math.log10(top + 1));
  const heights = volumes.map(h);
  const waists = linkScores.map((s, i) => Math.min(heights[i]!, heights[i + 1]!) * Math.max(0.35, Math.min(1, s ?? 1)));
  return { heights, waists };
}

// The band's points left to right for d3-shape's area: a flat run over each stage and a waist between stages.
// Stage 1 sits on the right (the page reads right to left), so the stages are laid out from the last to the first.
export function points(s: Shape, width: number, plateau = 0.42): { x: number; h: number }[] {
  const n = s.heights.length, slot = width / n;
  const cx = (i: number) => width - (i + 0.5) * slot;
  const out: { x: number; h: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push({ x: cx(i) - (slot * plateau) / 2, h: s.heights[i]! }, { x: cx(i) + (slot * plateau) / 2, h: s.heights[i]! });
    if (i > 0) out.push({ x: (cx(i) + cx(i - 1)) / 2, h: s.waists[i - 1]! });
  }
  out[0] = { ...out[0]!, x: 0 }; out[out.length - 1] = { ...out[out.length - 1]!, x: width };
  return out;
}
export const stageX = (i: number, n: number, width: number): number => width - (i + 0.5) * (width / n);
export const linkX = (i: number, n: number, width: number): number => (stageX(i, n, width) + stageX(i + 1, n, width)) / 2;
