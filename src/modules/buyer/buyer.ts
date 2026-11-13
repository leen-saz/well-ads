// The media buyer (الميديا باير): reads the daily numbers Well already stores, compares each campaign and platform with the
// playbook (playbook.ts, docs/media-buyer/) and with the company's own rules (kept in the database), and returns ranked
// recommendations: what to change, why, the risk, how success is measured, and who acts.
// READ-ONLY: it never touches an ad account and writes nothing; the media buyer decides and executes by hand.
// Every recommendation passes the marketing judge (pipeline/dash/00-judge.js) first: no scale-up while the judge says the
// cost per lead is off target, no stop while it says fine. What the judge blocks is listed under `gated`, with the reason.
import '../../../pipeline/dash/00-judge.js';
import type { Input as JudgeInput, Severity, Step, Targets } from '../../../pipeline/dash/00-judge.js';
import { PLATFORM_FACTS, PLATS, PLAT_AR, RULE, T, type Plat, type RuleId } from './playbook';

export interface AdRow { ad_key: string; platform: string; campaign?: string | null; name?: string | null; goal?: string | null; live?: boolean | null }
export interface MetricRow { ad_key: string; day: string; spend: number; impressions: number; clicks: number; leads: number; conversations?: number }
// The company's own settings per platform, kept in the database (never in this repo): the stop line (SAR per lead) and the
// planned daily budget steps, lowest to highest. Both optional.
export interface Plan { stopCpl?: number; ladder?: number[] }
export type Owner = 'media_buyer' | 'video_agent' | 'production' | 'landing';
// A company rule: which campaigns (matched by a name fragment) and what to recommend. The repo holds the mechanism only;
// every name and limit lives in control_settings.guardrails.buyer.rules, editable by the owner (see rules.ts).
export type RuleKind = 'scale' | 'stop_idle' | 'resume' | 'reduce' | 'replace_creative' | 'alert_stalled';
export interface CompanyRule {
  id: string; kind: RuleKind; platform: Plat; match: string[];
  maxCpl?: number; stepPct?: number; everyDays?: number; minIdleDays?: number; minCtr?: number; minResults?: number;
  judgeBy?: 'cpl' | 'ctr'; owner?: Owner; followUp?: string; open?: string;
}
export interface Input { today: string; ads: AdRow[]; metrics: MetricRow[]; targets: Targets; plans?: Partial<Record<Plat, Plan>>; rules?: CompanyRule[] }

// The machine-readable form of a recommendation that changes an account: a budget step in percent, or a status. Everything else
// stays advice. The execution layer (actions.ts) only ever turns THIS into a proposed action; it never parses the Arabic text.
export type Act = { op: 'budget_pct'; pct: number } | { op: 'status'; to: 'paused' | 'active' };
export type Kind = 'resume' | 'pause' | 'budget_up' | 'budget_down' | 'refresh_creative' | 'hold' | 'review' | 'shift_budget' | 'schedule';
export interface Rec {
  id: string; rule: RuleId; platform: Plat; campaign: string | null; kind: Kind;
  title: string; change: string; why: string; risk: string;
  success: { metric: string; goal: string; checkAfterDays: number[] };
  evidence: string[];
  judge: { step: 'click' | 'lead' | 'cpl'; level: Severity; line: string } | null;
  priority: number; confidence: 'high' | 'medium' | 'low';
  act?: Act;
  owner: Owner; followUp?: string; open?: string;   // who acts, a follow-up task, and a decision still open with the owner
  readOnly: true;                 // the media buyer decides and executes; this agent only recommends
}
export interface Gated { rule: RuleId; platform: Plat; campaign: string | null; reason: string }
export interface PlatSummary { spend: number; leads: number; cpl: number | null; ctr: number | null; judgeCpl: Severity; judgeClick: Severity }
export interface Report { recs: Rec[]; gated: Gated[]; platforms: Partial<Record<Plat, PlatSummary>>; window: { from: string; to: string }; note: string | null }

const DAY = 864e5;
const add = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);
const r0 = (n: number) => Math.round(n).toLocaleString('en-US');
const r1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');
const sar = (n: number) => `${n >= 100 ? r0(n) : r1(n)} ر.س`;
const pctS = (n: number) => `${r1(n)}%`;
const META = new Set(['facebook', 'instagram', 'messenger', 'audience_network', 'threads', 'whatsapp']);
export const platOf = (p: string): Plat | null =>
  p.startsWith('google') ? 'google' : p.startsWith('meta') || META.has(p) ? 'meta' : p === 'snap' || p === 'snapchat' ? 'snapchat' : p === 'tiktok' ? 'tiktok' : null;

interface Sum { spend: number; impr: number; clicks: number; leads: number }
const zero = (): Sum => ({ spend: 0, impr: 0, clicks: 0, leads: 0 });
const addTo = (s: Sum, m: MetricRow) => { s.spend += num(m.spend); s.impr += num(m.impressions); s.clicks += num(m.clicks); s.leads += num(m.leads) + num(m.conversations); };
const cpl = (s: Sum) => (s.leads > 0 ? s.spend / s.leads : null);
const ctr = (s: Sum) => (s.impr > 0 ? (100 * s.clicks) / s.impr : null);

interface Camp { plat: Plat; name: string | null; names: Set<string>; ads: Set<string>; live: boolean; lead: boolean; first: string; days: number; all: Sum; cur: Sum; prev: Sum; byDay: Map<string, Sum>; perAd: Map<string, number> }
type Verdicts = Partial<Record<Plat, ReturnType<typeof judged>>>;
type Push = (r: Omit<Rec, 'readOnly' | 'priority' | 'id' | 'success' | 'owner'> & { owner?: Owner; success: { metric: string; goal: string }; weight: number; spend?: number }) => void;

// Which step of the judge must agree before a rule may fire (the severities it needs)
const GATE: Partial<Record<RuleId, { step: 'click' | 'lead' | 'cpl'; needs: Severity[] }>> = {
  scale_up: { step: 'cpl', needs: ['fine'] },
  stop_cpl: { step: 'cpl', needs: ['watch', 'problem', 'disaster'] },
  fatigue: { step: 'cpl', needs: ['watch', 'problem', 'disaster'] },
  low_ctr: { step: 'click', needs: ['problem', 'disaster'] },
  page_leak: { step: 'lead', needs: ['problem', 'disaster'] },
  shift_budget: { step: 'cpl', needs: ['watch', 'problem', 'disaster'] },
};
const VIDEO_BRIEF = 'اطلب فيديو جديد يفتح بنتيجة عميل حقيقي في أول 3 ثواني، بموافقة كتابية من العميل، ويمر على فاحص الامتثال قبل النشر.';

const fmts = { pct: (v: number) => `${r1(v)}%`, sar, x: (v: number) => `${r1(v)}×`, qty: r0, num: (v: number, d: number) => (d ? r1(v) : r0(v)) };

// The judge's verdict for one platform's numbers (top of the funnel only: the CRM side is not this agent's business)
function judged(s: Sum, t: Targets): { cpl: Step | null; click: Step | null; lead: Step | null } {
  const input: JudgeInput = { top: { impr: s.impr, clicks: s.clicks, results: s.leads, spend: s.spend, cpl: cpl(s) },
    sale: { crm: false, results: s.leads, spend: s.spend, closings: 0, paid: 0, adClosings: 0, adLeads: 0, wide: true }, cohort: null };
  const v = globalThis.WELL_JUDGE.judge(input, t, 'ar', fmts);
  const by = (k: string) => v.steps.find(x => x.key === k) ?? null;
  return { cpl: by('cpl'), click: by('click'), lead: by('lead') };
}
const lvl = (s: Step | null | undefined): Severity => s?.level ?? 'na';

// The company's own rules, one pass over the campaigns each matches. Same read-only output; each says who acts.
function companyRules(x: Input, camps: Map<string, Camp>, end: string, verdict: Verdicts, push: Push, gated: Gated[]) {
  for (const rule of x.rules ?? []) {
    const p = rule.platform, frags = rule.match.map(m => m.toLowerCase()).filter(Boolean);
    for (const c of camps.values()) {
      if (c.plat !== p || !frags.some(f => [...c.names].some(n => n.includes(f)))) continue;
      const label = c.name ?? [...c.names][0] ?? 'الحملة', cc = cpl(c.cur), age = Math.round((Date.parse(end) - Date.parse(c.first)) / DAY) + 1;
      const base = { platform: p, campaign: c.name, owner: rule.owner ?? 'media_buyer' as Owner, judge: null as Rec['judge'], confidence: 'medium' as const,
        ...(rule.followUp ? { followUp: rule.followUp } : {}), ...(rule.open ? { open: rule.open } : {}) };
      if (rule.kind === 'alert_stalled') {
        const before = [...c.byDay.entries()].filter(([d]) => d < end).reduce((a, [, v]) => a + v.spend, 0), last = c.byDay.get(end);
        if (before > 0 && (!last || last.spend === 0)) push({ ...base, rule: 'company', kind: 'resume', weight: 95, confidence: 'high',
          title: `${label}: ما صرف يوم ${end.slice(8)}/${end.slice(5, 7)}، شغّله`, change: 'افحص حالة الحملة والميزانية والدفع في مدير الإعلانات، وشغّلها لو كانت متوقفة بدون سبب.',
          why: 'الحملة كانت تصرف قبل هالفترة وتوقف صرفها فجأة: غالباً إيقاف أو حد ميزانية أو مشكلة دفع.', risk: 'لو الإيقاف مقصود، التشغيل يصرف على شي مو مطلوب. تأكد أول.',
          evidence: [`آخر يوم (${end}) بلا صرف`], success: { metric: 'الصرف اليومي', goal: 'يرجع الصرف خلال يوم من التشغيل' } });
      }
      if (p === 'tiktok' && (rule.kind === 'scale' || rule.kind === 'stop_idle')) continue;   // lead-based: never for TikTok
      if (rule.kind === 'scale' && c.live && rule.maxCpl && cc != null && cc <= rule.maxCpl && c.cur.leads >= (rule.minResults ?? 5) && age >= 3) {
        const j = verdict[p]?.cpl;
        if (j && j.level !== 'fine') { gated.push({ rule: 'scale_up', platform: p, campaign: c.name, reason: `حكم التسويق: ${globalThis.WELL_JUDGE.SEV[j.level][0]}` }); continue; }
        const step = rule.stepPct ?? 20, every = rule.everyDays ?? 3;
        push({ ...base, act: { op: 'budget_pct', pct: step }, rule: 'company', kind: 'budget_up', weight: 58, spend: c.cur.spend, judge: j ? { step: 'cpl', level: j.level, line: j.line } : null,
          title: `${label}: الليد رخيص، ارفع الميزانية`, change: `ارفع الميزانية اليومية حوالي ${step}% كل ${every} أيام، طالما تكلفة الليد تحت ${sar(rule.maxCpl)}. أول ما تتجاوزه ارجع للميزانية السابقة.`,
          why: RULE.scale_up.why, risk: RULE.scale_up.risk, evidence: [`تكلفة الليد آخر ${T.windowDays} أيام ${sar(cc)} مقابل حد ${sar(rule.maxCpl)}`, `${r0(c.cur.leads)} نتيجة`],
          success: { metric: 'تكلفة الليد بعد الزيادة', goal: `تحت ${sar(rule.maxCpl)} بعد ${every} أيام` } });
      }
      // TikTok is judged by click rate and engagement, never by leads (the owner's decision): no lead figure is read for it
      if (rule.kind === 'resume' && !c.live && p === 'tiktok' && rule.minCtr && c.cur.impr >= T.fatigueMinImpressions && (ctr(c.cur) as number) >= rule.minCtr)
        push({ ...base, act: { op: 'status', to: 'active' }, rule: 'company', kind: 'resume', weight: 56, spend: c.cur.spend, title: `${label}: متوقفة ونسبة نقرها جيدة، شغّلها`, change: 'شغّل الحملة بميزانية صغيرة وراقب نسبة النقر والتفاعل أول 3 أيام.',
          why: 'الحملة متوقفة وآخر نسبة نقر لها فوق الحد المقبول. تيك توك يُحكم عليه بالنقر والتفاعل مو بالليدز.', risk: 'عينة قصيرة: يوم أو يومين ما يثبتون الأداء.',
          evidence: [`نسبة النقر ${pctS(ctr(c.cur) as number)} مقابل حد ${pctS(rule.minCtr)}`, `${r0(c.cur.impr)} ظهور`], success: { metric: 'نسبة النقر والتفاعل بعد التشغيل', goal: `فوق ${pctS(rule.minCtr)} على 3 أيام` } });
      if (rule.kind === 'resume' && !c.live && p !== 'tiktok' && rule.maxCpl && cc != null && cc <= rule.maxCpl && c.cur.leads >= (rule.minResults ?? 1))
        push({ ...base, act: { op: 'status', to: 'active' }, rule: 'company', kind: 'resume', weight: 56, spend: c.cur.spend, title: `${label}: متوقفة وفيها نتائج جيدة، شغّلها`, change: 'شغّل الحملة بميزانية صغيرة وراقب أول 3 أيام.',
          why: 'الحملة متوقفة وآخر أرقامها تحت الحد المقبول للتكلفة.', risk: 'عينة صغيرة: يوم أو يومين ما يثبتون الأداء.',
          evidence: [`${r0(c.cur.leads)} نتيجة بتكلفة ${sar(cc)} مقابل حد ${sar(rule.maxCpl)}`], success: { metric: 'التكلفة بعد التشغيل', goal: `تحت ${sar(rule.maxCpl)} على 3 أيام` } });
      if (rule.kind === 'stop_idle' && c.live && c.all.leads === 0 && c.days >= (rule.minIdleDays ?? 14))
        push({ ...base, act: { op: 'status', to: 'paused' }, rule: 'company', kind: 'pause', weight: 88, spend: c.cur.spend, confidence: 'high', title: `${label}: ${c.days} يوم بدون نتائج، أوقفها`,
          change: 'أوقف الحملة وحوّل صرفها للحملات اللي تجيب نتائج.', why: RULE.stop_cpl.why, risk: RULE.stop_cpl.risk, evidence: [`${c.days} يوم صرف بدون ولا نتيجة`],
          success: { metric: 'الصرف على حملات بلا نتائج', goal: 'صفر خلال أسبوع' } });
      if (rule.kind === 'reduce' && c.live && c.cur.spend > 0)
        push({ ...base, rule: 'company', kind: 'budget_down', weight: 80, spend: c.cur.spend, title: `${label}: قلّل الميزانية للحد الأدنى`, change: 'خفّض الميزانية للحد الأدنى لين تنحل المشكلة، وما ترجعها قبل الإصلاح.',
          why: 'التكلفة عالية مع نقر جيد: المشكلة غالباً بعد الإعلان.', risk: 'التقليل يبطّئ جمع البيانات.',
          evidence: [cc != null ? `تكلفة الليد ${sar(cc)}` : 'ما فيه نتائج', ctr(c.cur) != null ? `نسبة النقر ${pctS(ctr(c.cur) as number)}` : ''].filter(Boolean),
          success: { metric: 'تكلفة الليد بعد الإصلاح', goal: 'تنزل قبل إعادة الميزانية' } });
      if (rule.kind === 'replace_creative' && c.live && rule.minCtr && c.cur.impr >= T.fatigueMinImpressions && (ctr(c.cur) as number) < rule.minCtr) {
        const j = verdict[p]?.click;
        if (j && j.level === 'fine') { gated.push({ rule: 'low_ctr', platform: p, campaign: c.name, reason: 'حكم التسويق يقول تمام على نسبة النقر' }); continue; }
        push({ ...base, rule: 'company', kind: 'refresh_creative', weight: 66, spend: c.cur.spend, judge: j ? { step: 'click', level: j.level, line: j.line } : null,
          followUp: rule.followUp ?? VIDEO_BRIEF, title: `${label}: نسبة النقر ضعيفة، اطلب مادة جديدة (لا توقف الحملة)`, change: `أبقِ الحملة واطلب مادة جديدة. ${rule.followUp ?? VIDEO_BRIEF}`,
          why: RULE.low_ctr.why, risk: RULE.low_ctr.risk, evidence: [`نسبة النقر ${pctS(ctr(c.cur) as number)} مقابل حد ${pctS(rule.minCtr)}`],
          success: { metric: 'نسبة النقر', goal: `فوق ${pctS(rule.minCtr)} خلال 7 أيام من المادة الجديدة` } });
      }
    }
  }
}

export function recommend(x: Input): Report {
  const end = add(x.today, -1), curFrom = add(end, -(T.windowDays - 1)), prevFrom = add(end, -(2 * T.windowDays - 1)), prevTo = add(curFrom, -1);
  const byKey = new Map(x.ads.map(a => [a.ad_key, a]));
  const camps = new Map<string, Camp>();
  const place = new Map<string, Sum>();
  const plat: Partial<Record<Plat, { cur: Sum; prev: Sum; wk: Map<number, Sum> }>> = {};
  const wkFrom = add(end, -(7 * T.dowWeeks - 1));
  for (const m of x.metrics) {
    const a = byKey.get(m.ad_key), p = a && platOf(a.platform || '');
    if (!a || !p || m.day > end) continue;
    const cname = a.campaign || null, key = `${p}|${cname ?? m.ad_key}`;
    const c = camps.get(key) ?? { plat: p, name: cname, names: new Set<string>(), ads: new Set(), live: false, lead: false, first: m.day, days: 0, all: zero(), cur: zero(), prev: zero(), byDay: new Map(), perAd: new Map() };
    camps.set(key, c);
    if (num(m.spend) > 0 && m.day < c.first) c.first = m.day;
    addTo(c.all, m); if (num(m.spend) > 0) c.days++;
    if (a.name) c.names.add(a.name.toLowerCase()); if (cname) c.names.add(cname.toLowerCase());
    if (num(m.spend) > 0 || num(m.impressions) > 0) { c.ads.add(m.ad_key); if (a.live) c.live = true; if (a.goal === 'lead') c.lead = true; }
    const P = (plat[p] ||= { cur: zero(), prev: zero(), wk: new Map() });
    if (m.day >= curFrom) {
      addTo(c.cur, m); addTo(P.cur, m); c.perAd.set(m.ad_key, (c.perAd.get(m.ad_key) ?? 0) + num(m.spend));
      const d = c.byDay.get(m.day) ?? zero(); addTo(d, m); c.byDay.set(m.day, d);
      const pl = (a.platform || '').toLowerCase();
      if (p === 'meta' && (pl === 'facebook' || pl === 'instagram')) { const e = place.get(pl) ?? zero(); addTo(e, m); place.set(pl, e); }
    } else if (m.day >= prevFrom && m.day <= prevTo) { addTo(c.prev, m); addTo(P.prev, m); }
    if (m.day >= wkFrom) { const dow = new Date(m.day + 'T00:00:00Z').getUTCDay(); const w = P.wk.get(dow) ?? zero(); addTo(w, m); P.wk.set(dow, w); }
  }

  const recs: Rec[] = [], gated: Gated[] = [], platforms: Report['platforms'] = {};
  const totalSpend = [...camps.values()].reduce((a, c) => a + c.cur.spend, 0) || 1;
  const verdict: Verdicts = {};
  for (const p of PLATS) {
    const P = plat[p]; if (!P || P.cur.spend <= 0) continue;
    verdict[p] = judged(P.cur, x.targets);
    platforms[p] = { spend: P.cur.spend, leads: p === 'tiktok' ? 0 : P.cur.leads, cpl: p === 'tiktok' ? null : cpl(P.cur), ctr: ctr(P.cur), judgeCpl: p === 'tiktok' ? 'na' : lvl(verdict[p]!.cpl), judgeClick: lvl(verdict[p]!.click) };
  }
  const tgt = x.targets;
  const push: Push = r => {
    const { weight, spend, success, ...rest } = r;
    recs.push({ owner: 'media_buyer', ...rest, id: `${r.rule}:${r.platform}:${r.campaign ?? '*'}:${r.kind}`, success: { ...success, checkAfterDays: [...T.checkAfterDays] }, readOnly: true,
      priority: Math.round(weight + (spend ? Math.min(10, (10 * spend) / totalSpend) : 0)) });
  };
  const judgeOf = (p: Plat, step: 'click' | 'lead' | 'cpl') => { const s = verdict[p]?.[step] ?? null; return s ? { step, level: s.level, line: s.line } : null; };
  const gate = (rule: RuleId, p: Plat, campaign: string | null): boolean => {
    const need = GATE[rule]; if (!need) return true;
    const level = lvl(verdict[p]?.[need.step]);
    if (need.needs.includes(level)) return true;
    gated.push({ rule, platform: p, campaign, reason: level === 'na' ? 'الحكم ما قدر يحكم (أرقام غير كافية)' : level === 'fine' ? 'حكم التسويق يقول تمام على هالخطوة' : `حكم التسويق: ${globalThis.WELL_JUDGE.SEV[level][0]}` });
    return false;
  };

  for (const c of camps.values()) {
    if (!c.live || c.cur.spend <= 0) continue;
    const p = c.plat, f = PLATFORM_FACTS[p], plan = x.plans?.[p];
    const name = c.name, label = name ?? 'الحملة';
    const stopLine = plan?.stopCpl && plan.stopCpl > 0 ? plan.stopCpl : tgt.cpl * T.pauseCplMultiple;
    const cc = cpl(c.cur), age = Math.round((Date.parse(end) - Date.parse(c.first)) / DAY) + 1;
    const learnDays = f.learningDays ?? T.windowDays;
    const learning = age < learnDays || (p !== 'tiktok' && f.learningEvents != null && c.cur.leads < f.learningEvents && age < 2 * learnDays);

    const byClicks = p === 'tiktok';   // TikTok is judged by click rate and engagement, never by leads
    // Zero leads comes first and ignores the learning hold: money with no result is checked at once
    if (!byClicks && c.lead && c.cur.leads === 0 && c.cur.spend >= T.zeroLeadSpendMultiple * tgt.cpl) {
      push({ rule: 'zero_leads', platform: p, campaign: name, kind: 'review', weight: 85, spend: c.cur.spend, confidence: 'medium', judge: judgeOf(p, 'cpl'),
        title: `${label}: صرف بدون ولا ليد`, change: 'افحص حدث التحويل والنموذج في مدير الإعلانات (وصفحة التتبع في الداشبورد) قبل أي تغيير في الإعلان. لو التتبع سليم، وقّف الحملة.',
        why: RULE.zero_leads.why, risk: RULE.zero_leads.risk, evidence: [`الصرف آخر ${T.windowDays} أيام ${sar(c.cur.spend)} بدون ليد`, `عمر الحملة ${age} يوم`],
        success: { metric: 'وصول ليدز للحملة', goal: 'ليد واحد على الأقل خلال 48 ساعة من الإصلاح' } });
      continue;
    }
    if (learning) {
      push({ rule: 'learning_hold', platform: p, campaign: name, kind: 'hold', weight: 10, confidence: 'high', judge: null,
        title: `${label}: لسه في مرحلة التعلّم، لا تغيّر فيها`, change: f.learningEvents && p !== 'tiktok' ? `انتظر لين توصل ${f.learningEvents} نتيجة تقريباً (الحالي ${r0(c.cur.leads)}) ولا تعدّل الميزانية أو الجمهور أو الإعلان.` : 'انتظر أسبوع كامل من أول صرف قبل أي تعديل.',
        why: RULE.learning_hold.why, risk: RULE.learning_hold.risk, evidence: [`عمر الحملة ${age} يوم`, `نتائج آخر ${T.windowDays} أيام: ${r0(c.cur.leads)}`],
        success: { metric: 'خروج الحملة من التعلّم', goal: 'ثبات الـ CPL بعد الوصول للعدد المطلوب' } });
      continue;
    }
    const decidable = !byClicks && c.cur.leads >= T.minLeadsToDecide;
    const last3 = zero(); for (let i = 0; i < T.scaleDaysAtTarget; i++) { const d = c.byDay.get(add(end, -i)); if (d) { last3.spend += d.spend; last3.leads += d.leads; } }

    // Stop: the cost per lead is over the stop line with enough leads behind it
    if (decidable && cc != null && cc >= stopLine && gate('stop_cpl', p, name)) {
      const l3 = cpl(last3), pause = l3 != null && l3 >= stopLine;
      push({ rule: 'stop_cpl', platform: p, campaign: name, kind: pause ? 'pause' : 'budget_down', act: pause ? { op: 'status', to: 'paused' } : { op: 'budget_pct', pct: -20 }, weight: 90, spend: c.cur.spend, confidence: c.cur.leads >= 30 ? 'high' : 'medium', judge: judgeOf(p, 'cpl'),
        title: pause ? `${label}: الـ CPL فوق حد الإيقاف، أوقفها` : `${label}: الـ CPL فوق حد الإيقاف، خفّض ميزانيتها`,
        change: pause ? 'أوقف الحملة وحوّل صرفها للحملات اللي تحت الحد. القرار للمشتري الإعلامي.' : 'خفّض الميزانية اليومية بحدود 20%. لو بقي الـ CPL فوق الحد 3 أيام أوقفها.',
        why: RULE.stop_cpl.why, risk: RULE.stop_cpl.risk,
        evidence: [`الـ CPL آخر ${T.windowDays} أيام ${sar(cc)} مقابل حد ${sar(stopLine)}${plan?.stopCpl ? ' (حد الشركة)' : ' (افتراضي من الهدف)'}`, `${r0(c.cur.leads)} ليد في الفترة`],
        success: { metric: 'الـ CPL الإجمالي للمنصة', goal: `تحت ${sar(stopLine)} خلال 7 أيام` } });
      continue;
    }

    // Scale: at or under target for several days in a row, enough leads, the judge agrees
    const daysOk = [...Array(T.scaleDaysAtTarget).keys()].every(i => { const d = c.byDay.get(add(end, -i)); return d && d.leads > 0 && d.spend / d.leads <= tgt.cpl; });
    if (decidable && cc != null && cc <= tgt.cpl && daysOk && gate('scale_up', p, name)) {
      const daily = c.cur.spend / T.windowDays;
      const next = plan?.ladder?.filter(v => v > daily * 1.02).sort((a, b) => a - b)[0];
      const step = next ? Math.min(T.scaleStepMax, (next - daily) / daily) : T.scaleStepMax;
      if (step >= T.scaleStepMin) push({ rule: 'scale_up', platform: p, campaign: name, kind: 'budget_up', act: { op: 'budget_pct', pct: Math.round(step * 100) }, weight: 55, spend: c.cur.spend, confidence: c.cur.leads >= 30 ? 'high' : 'medium', judge: judgeOf(p, 'cpl'),
        title: `${label}: الـ CPL تحت الهدف، وسّع الميزانية`, change: `ارفع الميزانية اليومية بنسبة ${Math.round(step * 100)}% (متوسط الصرف الحالي ${sar(daily)} باليوم)${next ? '، وهذي خطوة تقترب من الدرجة التالية في خطة الميزانية' : ''}، وانتظر 3 أيام قبل أي زيادة ثانية.`,
        why: RULE.scale_up.why, risk: RULE.scale_up.risk, evidence: [`الـ CPL آخر ${T.windowDays} أيام ${sar(cc)} مقابل هدف ${sar(tgt.cpl)}`, `تحت الهدف ${T.scaleDaysAtTarget} أيام متتالية`, `${r0(c.cur.leads)} ليد في الفترة`],
        success: { metric: 'الـ CPL بعد الزيادة', goal: `تحت ${sar(tgt.cpl)} بعد 3 أيام، والليدز ترتفع تقريباً بنفس النسبة` } });
    }

    // Creative fatigue: the click rate fell and the cost rose against the week before
    const pc = cpl(c.prev), cr = ctr(c.cur), pr = ctr(c.prev);
    // The sample is checked before the judge's gate, so a campaign with too few impressions is not listed as "blocked by the judge"
    const sampled = c.cur.impr >= T.fatigueMinImpressions && c.prev.impr >= T.fatigueMinImpressions;
    const fatigued = sampled && (byClicks ? cr != null && pr != null && cr <= pr * (1 - T.fatigueCtrDrop)
      : cc != null && pc != null && cr != null && pr != null && cr <= pr * (1 - T.fatigueCtrDrop) && cc >= pc * (1 + T.fatigueCplRise) && gate('fatigue', p, name));
    if (fatigued && cr != null && pr != null) {
      // A CPL comparison on a handful of leads is noise: under the playbook's minimum in either week the confidence is low
      const thin = !byClicks && Math.min(c.cur.leads, c.prev.leads) < T.minLeadsToDecide;
      push({ rule: 'fatigue', platform: p, campaign: name, kind: 'refresh_creative', weight: 70, spend: c.cur.spend, confidence: thin ? 'low' : c.cur.leads >= 30 ? 'high' : 'medium', judge: judgeOf(p, 'cpl'),
        title: `${label}: المادة تعبت، جهّز مادة جديدة`, change: 'أضف مادة جديدة (افتتاحية مختلفة وليس نفس الفكرة) جنب الحالية، وخل المنصة توزع الصرف، وأوقف القديمة لما الجديدة تثبت.',
        why: RULE.fatigue.why, risk: RULE.fatigue.risk, evidence: [`نسبة النقر ${pctS(cr)} بعد ${pctS(pr)} الأسبوع اللي قبله`, ...(byClicks || cc == null || pc == null ? [] : [`الـ CPL ${sar(cc)} بعد ${sar(pc)}`, `${r0(c.cur.leads)} ليد هذا الأسبوع و${r0(c.prev.leads)} الأسبوع اللي قبله${thin ? ' (عينة صغيرة)' : ''}`])],
        success: { metric: byClicks ? 'نسبة النقر' : 'نسبة النقر والـ CPL', goal: byClicks ? `نسبة النقر ترجع قريبة من ${pctS(pr)}` : `نسبة النقر ترجع قريبة من ${pctS(pr)} والـ CPL ينزل` } });
    }
    // Click rate far under target, with a sample the judge accepts
    if (cr != null && c.cur.clicks >= T.minClicksForPage && cr < tgt.ctr * T.lowCtrOfTarget && gate('low_ctr', p, name)) {
      push({ rule: 'low_ctr', platform: p, campaign: name, kind: 'refresh_creative', weight: 65, spend: c.cur.spend, confidence: 'medium', judge: judgeOf(p, 'click'),
        title: `${label}: نسبة النقر ضعيفة`, change: 'غيّر أول لقطة أو أول سطر ومقطع جديد بافتتاحية مختلفة، وجرّب نسخة وحدة بس كل مرة عشان تعرف وش اللي حسّن.',
        why: RULE.low_ctr.why, risk: RULE.low_ctr.risk, evidence: [`نسبة النقر ${pctS(cr)} مقابل هدف ${pctS(tgt.ctr)}`, `${r0(c.cur.clicks)} نقرة في الفترة`],
        success: { metric: 'نسبة النقر', goal: `فوق ${pctS(tgt.ctr)}` } });
    }
    // Clicks that do not become leads: the page or the form, not the ad
    const c2l = c.cur.clicks > 0 ? (100 * c.cur.leads) / c.cur.clicks : null;
    if (!byClicks && c2l != null && c.cur.clicks >= T.minClicksForPage && c2l < tgt.clickToLead * T.clickToLeadFloor && gate('page_leak', p, name)) {
      push({ rule: 'page_leak', platform: p, campaign: name, kind: 'review', weight: 60, spend: c.cur.spend, confidence: 'medium', judge: judgeOf(p, 'lead'),
        title: `${label}: النقرات ما تصير ليدز`, change: 'جرّب النموذج والصفحة من جوال بنفسك: قصّر الحقول، وسرّع الصفحة، وتأكد إن رسالة الواتساب الجاهزة تفتح. لا تغيّر الإعلان لين تنحل الصفحة.',
        why: RULE.page_leak.why, risk: RULE.page_leak.risk, evidence: [`من نقرة إلى ليد ${pctS(c2l)} مقابل هدف ${pctS(tgt.clickToLead)}`, `${r0(c.cur.clicks)} نقرة`],
        success: { metric: 'من نقرة إلى ليد', goal: `فوق ${pctS(tgt.clickToLead)}` } });
    }
    // One creative takes nearly all the spend
    const top = Math.max(0, ...c.perAd.values());
    if (c.cur.spend >= 5 * tgt.cpl && top / c.cur.spend >= 0.8) {
      push({ rule: 'few_creatives', platform: p, campaign: name, kind: 'refresh_creative', weight: 25, spend: c.cur.spend, confidence: 'low', judge: null,
        title: `${label}: مادة وحدة تاخذ معظم الصرف`, change: 'جهّز مادتين أو ثلاث بافتتاحيات مختلفة وشغّلها جنب الحالية.',
        why: RULE.few_creatives.why, risk: RULE.few_creatives.risk, evidence: [`${c.ads.size} إعلان في الحملة، والأول ياخذ ${Math.round((100 * top) / c.cur.spend)}% من الصرف`],
        success: { metric: 'حصة الصرف لمادة ثانية', goal: 'مادة ثانية بـ CPL قريب أو أقل' } });
    }
  }

  // Between platforms: the dearest against the cheapest, each with enough leads, and the judge sees the dear one as off target
  const comparable = PLATS.filter(p => p !== 'tiktok' && plat[p] && plat[p]!.cur.leads >= T.platformMinLeads);
  if (comparable.length >= 2) {
    const cp = (p: Plat) => cpl(plat[p]!.cur) as number;
    const sorted = [...comparable].sort((a, b) => cp(a) - cp(b)), best = sorted[0]!, worst = sorted[sorted.length - 1]!;
    if (cp(worst) >= T.platformGap * cp(best) && gate('shift_budget', worst, null)) {
      push({ rule: 'shift_budget', platform: worst, campaign: null, kind: 'shift_budget', weight: 50, spend: plat[worst]!.cur.spend, confidence: 'medium', judge: judgeOf(worst, 'cpl'),
        title: `انقل جزء من ميزانية ${PLAT_AR[worst]} إلى ${PLAT_AR[best]}`, change: `حوّل حتى ${Math.round(T.shiftShare * 100)}% من الميزانية اليومية لـ${PLAT_AR[worst]} إلى ${PLAT_AR[best]}، وراجع جودة الليد في الـ CRM قبل أي نقل أكبر.`,
        why: RULE.shift_budget.why, risk: RULE.shift_budget.risk, evidence: [`الـ CPL في ${PLAT_AR[worst]} ${sar(cp(worst))}، وفي ${PLAT_AR[best]} ${sar(cp(best))}`],
        success: { metric: 'الـ CPL الإجمالي', goal: 'ينزل والليدز الإجمالية ما تنقص خلال 7 أيام' } });
    }
  }
  // Meta placements: the same objective costs far more on one placement than the other
  const fb = place.get('facebook'), ig = place.get('instagram');
  if (fb && ig && fb.leads >= T.placementMinResults && ig.leads >= T.placementMinResults) {
    const a = cpl(fb) as number, b = cpl(ig) as number, AR = { facebook: 'فيسبوك', instagram: 'انستقرام' };
    const dear = a > b ? 'facebook' : 'instagram', cheap = a > b ? 'instagram' : 'facebook', dc = Math.max(a, b), cc2 = Math.min(a, b);
    if (dc >= T.placementGap * cc2) push({ rule: 'placement_gap', platform: 'meta', campaign: null, kind: 'shift_budget', weight: 52, spend: (dear === 'facebook' ? fb : ig).spend, confidence: 'medium', judge: null,
      title: `ميتا: ${AR[dear]} أغلى من ${AR[cheap]}`, change: `انقل ميزانية ${AR[dear]} إلى ${AR[cheap]} على خطوات (حتى ${Math.round(T.shiftShare * 100)}% بالمرة)، وراجع جودة المحادثات قبل النقل الكبير.`,
      why: RULE.placement_gap.why, risk: RULE.placement_gap.risk, evidence: [`تكلفة النتيجة في ${AR[dear]} ${sar(dc)} وفي ${AR[cheap]} ${sar(cc2)}`],
      success: { metric: 'تكلفة النتيجة الإجمالية في ميتا', goal: 'تنزل والنتائج الإجمالية ما تنقص خلال 7 أيام' } });
  }
  // Weekdays: only on four full weeks and a real sample per weekday
  for (const p of PLATS) {
    const wk = plat[p]?.wk; if (!wk || wk.size < 7) continue;
    const rows = [...wk.entries()].map(([d, s]) => ({ d, c: cpl(s), l: s.leads }));
    if (rows.some(r => r.c == null || r.l < T.dowMinLeads)) continue;
    const s = [...rows].sort((a, b) => (a.c as number) - (b.c as number)), best = s[0]!, worst = s[s.length - 1]!;
    if ((worst.c as number) >= T.dowGap * (best.c as number)) {
      const DOW = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      push({ rule: 'weekday_gap', platform: p, campaign: null, kind: 'schedule', weight: 30, confidence: 'medium', judge: null,
        title: `${PLAT_AR[p]}: يوم ${DOW[worst.d]} أغلى من يوم ${DOW[best.d]}`, change: `قلّل الصرف في ${DOW[worst.d]} وزد في ${DOW[best.d]} بخطوة صغيرة، وتابع أسبوعين.`,
        why: RULE.weekday_gap.why, risk: RULE.weekday_gap.risk, evidence: [`الـ CPL ${sar(worst.c as number)} مقابل ${sar(best.c as number)} على آخر ${T.dowWeeks} أسابيع`],
        success: { metric: 'الـ CPL الأسبوعي', goal: 'ينزل بعد أسبوعين' } });
    }
  }
  if (x.rules?.length) {
    const before = new Set(recs.map(r => r.id));
    companyRules(x, camps, end, verdict, push, gated);
    // A company scale-up replaces the general one for the same campaign
    const mine = new Set(recs.filter(r => r.rule === 'company' && r.kind === 'budget_up').map(r => `${r.platform}|${r.campaign}`));
    for (let i = recs.length - 1; i >= 0; i--) { const r = recs[i]!; if (before.has(r.id) && r.rule === 'scale_up' && mine.has(`${r.platform}|${r.campaign}`)) recs.splice(i, 1); }
  }

  recs.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return { recs, gated, platforms, window: { from: curFrom, to: end }, note: Object.keys(platforms).length ? null : 'ما فيه صرف في آخر 7 أيام عشان نحلله.' };
}
