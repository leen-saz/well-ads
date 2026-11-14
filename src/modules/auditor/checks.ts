// Part 1 of the auditor: every number a verdict quotes is recomputed from the raw data (facts.ts) and compared, and the
// verdict is checked against itself. A check whose input the verdict does not state is skipped (and not counted).
import { type AuditConfig, type Claim, type ClaimStep, type Finding, type StepKey, OWNER_RULE } from './contract';
import { type Facts, valueOf, volumeOf } from './facts';

const NAME: Record<StepKey, { ar: string; en: string }> = {
  click: { ar: 'نسبة النقر', en: 'click rate' }, lead: { ar: 'من نقرة إلى ليد', en: 'click to lead' }, sale: { ar: 'من ليد إلى إقفالة', en: 'lead to closing' },
  cpl: { ar: 'تكلفة الليد', en: 'cost per lead' }, cpm: { ar: 'تكلفة الألف ظهور', en: 'cost per 1,000 impressions' },
  cpa: { ar: 'تكلفة الإقفالة', en: 'cost per closing' }, roas: { ar: 'العائد على الصرف', en: 'return on spend' },
};
export const nameOf = (k: StepKey) => NAME[k];
const num = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d));

export interface Run { findings: Finding[]; checked: number }
const bad = (r: Run, f: Finding) => { r.findings.push(f); };

export function integrity(c: Claim, f: Facts, cfg: AuditConfig): Run {
  const r: Run = { findings: [], checked: 0 };
  // 1. The quoted number of every step is the number the raw data gives
  const compare = (s: ClaimStep, what: 'now' | 'prev' | 'median', quoted: number | null | undefined, truth: number | null) => {
    if (quoted === undefined) return;
    r.checked++;
    // An unattributed step carries no number on purpose
    if (s.unattributed && what === 'now') return;
    const off = quoted == null || truth == null ? quoted !== truth : Math.abs(quoted - truth) > cfg.tol + 1e-9 * Math.abs(truth);
    if (!off) return;
    const w = { now: ['الرقم', 'the figure'], prev: ['رقم الفترة السابقة', 'the earlier period figure'], median: ['المعتاد', 'the usual level'] }[what];
    bad(r, { id: `mismatch_${what}`, kind: 'integrity', effect: 'contradicts', step: s.key,
      text: { ar: `${NAME[s.key].ar}: ${w[0]} المذكور (${num(quoted)}) ما يطابق إعادة الحساب من البيانات الخام (${num(truth)}).`,
        en: `${NAME[s.key].en}: the quoted ${w[1]} (${num(quoted)}) does not match the recomputation from raw data (${num(truth)}).` },
      needs: { ar: 'إعادة تشغيل الحكم على نفس البيانات ومقارنة الحقل بالحقل.', en: 'Re-run the judge on the same data and compare field by field.' } });
  };
  const prevOf = (k: StepKey): number | null => (k === 'click' ? f.prev.scope.ctr : k === 'lead' ? f.prev.scope.c2r : k === 'sale' ? f.prev.closeRate : k === 'cpl' ? f.prev.scope.cpl : f.prev.scope.cpm);
  const usualOf = (k: StepKey): number | null => (k === 'click' ? f.usual.click : k === 'lead' ? f.usual.lead : k === 'cpl' ? f.usual.cpl : k === 'cpm' ? f.usual.cpm : null);
  for (const s of c.steps) {
    compare(s, 'now', s.now, valueOf(f, s.key));
    // The earlier period only counts when the sale step was tied to ads then too; a missing figure there is not a mismatch
    // A missing earlier figure or usual level means «not stated» (no valid comparison): only a stated one is checked
    if (s.prev != null) compare(s, 'prev', s.prev, prevOf(s.key));
    if (s.median != null && s.key !== 'sale') compare(s, 'median', s.median, usualOf(s.key));
  }

  // 2. Coverage the verdict quotes
  if (c.verdict.coverage !== undefined) {
    r.checked++;
    const t = f.crm.coverage, q = c.verdict.coverage;
    if ((q == null) !== (t == null) || (q != null && t != null && Math.abs(q - t) > 0.005))
      bad(r, { id: 'mismatch_coverage', kind: 'integrity', effect: 'contradicts', step: 'verdict',
        text: { ar: `نسبة ربط الليدز بالإعلانات المذكورة (${num(q == null ? null : q * 100, 1)}%) ما تطابق الحساب من البيانات (${num(t == null ? null : t * 100, 1)}%).`,
          en: `The quoted attribution coverage (${num(q == null ? null : q * 100, 1)}%) does not match the data (${num(t == null ? null : t * 100, 1)}%).` } });
  }

  // 3. The rates multiply to the end to end rate. ctr × click→result × close rate = booked / impressions ÷ coverage, an
  // identity of the raw counts: a wrong figure in any of the three breaks it. Each quoted rate may be off by cfg.tol
  // (rounding), so the true end to end rate must lie between the products of the three rates moved down and up by tol;
  // outside that band at least one figure is wrong. (A fixed absolute slack here was loose on low rates and tight on high ones.)
  const q = Object.fromEntries(c.steps.map(s => [s.key, s])) as Partial<Record<StepKey, ClaimStep>>;
  const a = q.click, b = q.lead, d = q.sale;
  if (a?.now != null && b?.now != null && d?.now != null && !d.unattributed && f.scope.impr > 0 && f.crm.coverage != null) {
    r.checked++;
    const rs = [a.now, b.now, d.now], end = f.crm.booked / f.scope.impr / f.crm.coverage;
    const lo = rs.reduce((x, v) => x * Math.max(0, v - cfg.tol) / 100, 1), hi = rs.reduce((x, v) => x * (v + cfg.tol) / 100, 1);
    if (end < lo * (1 - 1e-9) || end > hi * (1 + 1e-9))
      bad(r, { id: 'chain_product', kind: 'consistency', effect: 'contradicts', step: 'verdict',
        text: { ar: 'نسب الرحلة (النقر × ليد × إقفالة) ما تتضارب لتعطي النسبة من الظهور للإقفالة. رقم واحد على الأقل غلط.',
          en: 'The journey rates (click × lead × closing) do not multiply to the impression-to-closing rate. At least one figure is wrong.' } });
  }

  // 4. SAR at stake: sums, bounds and (when the judge states its method) the amount itself
  const sars = c.steps.filter(s => s.sarAtStake != null);
  if (c.verdict.sarAtStake != null || sars.length) {
    r.checked++;
    const total = c.verdict.sarAtStake;
    if (sars.some(s => s.sarAtStake! < 0) || (total != null && total < 0))
      bad(r, { id: 'sar_negative', kind: 'consistency', effect: 'contradicts', step: 'verdict', text: { ar: 'مبلغ معرّض للخسارة بالسالب.', en: 'A negative SAR at stake.' } });
    if (total != null && sars.length && total > 0) {
      const sum = sars.reduce((x, s) => x + s.sarAtStake!, 0);
      // A verdict names one step: its amount is that step's. A sum of all steps is also fine.
      const named = c.verdict.step ? q[c.verdict.step]?.sarAtStake : null;
      if (Math.abs(total - sum) > 0.5 && (named == null || Math.abs(total - named) > 0.5))
        bad(r, { id: 'sar_sum', kind: 'consistency', effect: 'contradicts', step: 'verdict', text: { ar: 'المبلغ المعرّض للخسارة في الحكم ما يساوي مجموع الخطوات ولا مبلغ الخطوة المذكورة.', en: 'The verdict SAR at stake equals neither the sum of the steps nor the named step.' } });
    }
    if ((total ?? 0) > f.scope.spend + 0.5 || sars.some(s => s.sarAtStake! > f.scope.spend + 0.5))
      bad(r, { id: 'sar_over_spend', kind: 'consistency', effect: 'contradicts', step: 'verdict', text: { ar: 'مبلغ معرّض للخسارة أكبر من كل الصرف في الفترة.', en: 'SAR at stake is more than all spend in the period.' } });
    if (c.sarMethod === 'shortfall') for (const s of sars) {
      r.checked++;
      const t = s.target, v = valueOf(f, s.key);
      const truth = t && v != null ? f.scope.spend * Math.max(0, 1 - v / t) : null;
      if (truth != null && Math.abs(truth - s.sarAtStake!) > 0.5)
        bad(r, { id: 'sar_recompute', kind: 'integrity', effect: 'contradicts', step: s.key, text: { ar: `${NAME[s.key].ar}: المبلغ المعرّض للخسارة ما يطابق إعادة الحساب.`, en: `${NAME[s.key].en}: the SAR at stake does not match the recomputation.` } });
    }
  }

  // 5. No verdict on a step whose volume is below the minimum sample
  const min = { ...cfg.minSample, ...c.minSample };
  const named = c.verdict.step ? q[c.verdict.step] : null;
  if (c.verdict.step && named) {
    r.checked++;
    const v = volumeOf(f, c.verdict.step);
    if (v.n < min[v.kind])
      bad(r, { id: 'below_min_sample', kind: 'consistency', effect: 'contradicts', step: c.verdict.step,
        text: { ar: `الحكم على «${NAME[c.verdict.step].ar}» مبني على حجم أقل من الحد الأدنى للعيّنة.`, en: `The verdict on “${NAME[c.verdict.step].en}” stands on a volume below the minimum sample.` },
        needs: { ar: 'فترة أطول حتى يوصل الحجم للحد الأدنى.', en: 'A longer period, until the volume reaches the minimum.' } });
  }

  // 6. «No problem» only if every step meets its target; a named step must itself be weak
  r.checked++;
  if (c.verdict.level === 'ok' || c.verdict.step == null) {
    const worse = c.steps.filter(s => !s.unattributed && s.level !== 'ok');
    if (worse.length)
      bad(r, { id: 'ok_with_weak_step', kind: 'consistency', effect: 'contradicts', step: 'verdict',
        text: { ar: `الحكم «لا مشكلة» لكن ${worse.map(s => NAME[s.key].ar).join('، ')} مو في حدها.`, en: `The verdict says “no problem” but ${worse.map(s => NAME[s.key].en).join(', ')} is not within its limit.` } });
    for (const s of c.steps) {
      const fl = s.target ?? (s.key === 'click' || s.key === 'lead' || s.key === 'sale' ? cfg.floors[s.key] : null), v = valueOf(f, s.key);
      if (!s.unattributed && fl != null && v != null && v < fl)
        bad(r, { id: 'ok_below_target', kind: 'consistency', effect: 'contradicts', step: s.key,
          text: { ar: `الحكم «لا مشكلة» بينما ${NAME[s.key].ar} (${num(v)}%) تحت هدفها (${num(fl)}%) حسب البيانات الخام.`, en: `“No problem”, yet ${NAME[s.key].en} (${num(v)}%) is under its target (${num(fl)}%) in the raw data.` } });
    }
  } else if (named && named.level === 'ok') {
    bad(r, { id: 'named_step_not_weak', kind: 'consistency', effect: 'contradicts', step: c.verdict.step, text: { ar: 'الحكم يسمي خطوة هي نفسها «سليمة».', en: 'The verdict names a step that is itself fine.' } });
  }
  if (named && c.verdict.level !== named.level && c.verdict.level !== 'ok') {
    r.checked++;
    bad(r, { id: 'level_mismatch', kind: 'consistency', effect: 'contradicts', step: c.verdict.step!, text: { ar: 'مستوى الحكم غير مستوى الخطوة المسماة.', en: 'The verdict level differs from the level of the step it names.' } });
  }

  // 7. The owner matches the rule table
  if (c.verdict.step && c.verdict.owner) {
    r.checked++;
    const o = OWNER_RULE[c.verdict.step];
    if (c.verdict.owner !== o.ar && c.verdict.owner !== o.en)
      bad(r, { id: 'owner_mismatch', kind: 'consistency', effect: 'contradicts', step: c.verdict.step, text: { ar: `المسؤول المذكور (${c.verdict.owner}) غير المسؤول حسب جدول القواعد (${o.ar}).`, en: `The quoted owner (${c.verdict.owner}) differs from the rule table (${o.en}).` } });
  }
  for (const s of c.steps) {
    r.checked++;
    const o = OWNER_RULE[s.unattributed ? 'crm' : s.key];
    if (s.owner !== o.ar && s.owner !== o.en)
      bad(r, { id: 'owner_mismatch_step', kind: 'consistency', effect: 'contradicts', step: s.key, text: { ar: `${NAME[s.key].ar}: المسؤول غير المسؤول حسب جدول القواعد.`, en: `${NAME[s.key].en}: the owner differs from the rule table.` } });
  }

  // 8. Confidence matches coverage: high needs good coverage, low is what poor coverage gives
  const cov = f.crm.coverage;
  if (c.verdict.confidence && cov != null) {
    r.checked++;
    if (c.verdict.confidence === 'high' && cov < cfg.coverageHigh)
      bad(r, { id: 'confidence_too_high', kind: 'consistency', effect: 'contradicts', step: 'verdict', text: { ar: `الثقة «عالية» مع ربط ${num(cov * 100, 0)}% فقط من الليدز بالإعلانات.`, en: `Confidence “high” with only ${num(cov * 100, 0)}% of leads tied to ads.` } });
    if (c.verdict.confidence !== 'low' && cov < cfg.coverageLow)
      bad(r, { id: 'confidence_vs_coverage', kind: 'consistency', effect: 'weakens', step: 'verdict', text: { ar: `الربط ${num(cov * 100, 0)}% (تحت ${num(cfg.coverageLow * 100, 0)}%) والثقة مو «منخفضة».`, en: `Coverage ${num(cov * 100, 0)}% (under ${num(cfg.coverageLow * 100, 0)}%) and confidence is not “low”.` } });
  }
  if (c.verdict.range) {
    r.checked++;
    if (c.verdict.range.best < c.verdict.range.worst)
      bad(r, { id: 'range_inverted', kind: 'consistency', effect: 'contradicts', step: 'verdict', text: { ar: 'المدى: الأفضل أقل من الأسوأ.', en: 'The range has best below worst.' } });
  }
  return r;
}
