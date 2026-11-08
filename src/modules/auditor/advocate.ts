// Part 2 of the auditor: the devil's advocate. Rules only, no model, no key. For the verdict and each flagged step it tries
// to break the claim: a timing artifact, Simpson's paradox across platforms, an attribution gap larger than the effect, a
// target that is only a default, a small sample, a comparison period with holes. Each challenge says what it does to the
// verdict (contradicts / weakens) and what data would settle it.
import { type AuditConfig, type Claim, type ClaimStep, type Finding, type StepKey } from './contract';
import { type Facts, valueOf, volumeOf } from './facts';
import { nameOf, type Run } from './checks';

const pc = (v: number | null, d = 1) => (v == null ? '—' : v.toFixed(d));
const FLOORED = ['click', 'lead', 'sale'] as const;
const floorOf = (c: Claim, s: ClaimStep, cfg: AuditConfig): number | null =>
  s.target ?? ((FLOORED as readonly string[]).includes(s.key) ? cfg.floors[s.key as 'click' | 'lead' | 'sale'] : null);

export function advocate(c: Claim, f: Facts, cfg: AuditConfig): Run {
  const r: Run = { findings: [], checked: 0 };
  const add = (x: Finding) => r.findings.push(x);
  const min = { ...cfg.minSample, ...c.minSample };
  const weak = c.steps.filter(s => !s.unattributed && s.level !== 'ok');
  const flagged: StepKey[] = c.verdict.step ? [c.verdict.step] : [];
  const says = c.verdict.level === 'ok' || c.verdict.step == null ? 'ok' : 'problem';

  // ---- 1. Small sample: the volume under the verdict (a «no problem» needs enough volume everywhere)
  r.checked++;
  const subject = says === 'ok' ? c.steps.filter(s => !s.unattributed).map(s => s.key) : flagged;
  for (const k of subject) {
    const v = volumeOf(f, k), m = min[v.kind];
    if (v.n < m) add({ id: 'small_sample', kind: 'challenge', effect: v.n < m / 3 ? 'contradicts' : 'weakens', step: says === 'ok' ? 'verdict' : k,
      text: { ar: `${nameOf(k).ar}: الحجم (${v.n.toLocaleString('en-US')}) أقل من الحد الأدنى للعيّنة (${m.toLocaleString('en-US')})، فالفرق ممكن يكون صدفة.`,
        en: `${nameOf(k).en}: the volume (${v.n.toLocaleString('en-US')}) is below the minimum sample (${m.toLocaleString('en-US')}); the gap may be chance.` },
      needs: { ar: 'فترة أطول أو منصات مجمّعة لين يوصل الحجم للحد الأدنى.', en: 'A longer period, or platforms pooled, until the volume reaches the minimum.' } });
  }

  // ---- 2. Simpson's paradox: the total against the platforms, on the steps that have a floor
  r.checked++;
  const plats = Object.entries(f.byPlat);
  if (!c.plat && plats.length > 1) for (const k of FLOORED) {
    const s = c.steps.find(x => x.key === k);
    if (!s || s.unattributed) continue;
    const fl = floorOf(c, s, cfg);
    if (fl == null) continue;
    const rows = plats.map(([p, t]) => ({ p, v: k === 'click' ? t.ctr : k === 'lead' ? t.c2r : (t.crm.leads ? (100 * t.crm.booked) / t.crm.leads : null),
      n: k === 'click' ? t.impr : k === 'lead' ? t.clicks : t.crm.leads })).filter(x => x.v != null && x.n >= min[k === 'click' ? 'impr' : k === 'lead' ? 'clicks' : 'crmLeads']);
    if (rows.length < 2) continue;
    const total = rows.reduce((a, x) => a + x.n, 0);
    if (s.level !== 'ok' && flagged.includes(k) && rows.every(x => x.v! >= fl))
      add({ id: 'simpson_mix', kind: 'challenge', effect: 'contradicts', step: k,
        text: { ar: `${nameOf(k).ar}: كل منصة لحالها فوق الحد (${pc(fl)}%) والإجمالي تحته. الضعف من خلطة المنصات مو من خطوة ضعيفة.`, en: `${nameOf(k).en}: every platform on its own is above the limit (${pc(fl)}%) and only the total is under it. It is a mix effect, not a weak step.` },
        needs: { ar: 'مقارنة نفس الخطوة داخل كل منصة على فترتين.', en: 'The same step compared inside each platform over two periods.' } });
    const hidden = rows.filter(x => x.v! < fl && x.n / total >= 0.25);
    if ((s.level === 'ok' || !flagged.includes(k)) && hidden.length)
      add({ id: 'simpson_hidden', kind: 'challenge', effect: 'weakens', step: says === 'ok' ? 'verdict' : k,
        text: { ar: `${nameOf(k).ar}: الإجمالي يبدو سليم لكن ${hidden.map(x => x.p).join('، ')} (${pc(100 * hidden.reduce((a, x) => a + x.n, 0) / total, 0)}% من الحجم) تحت الحد.`,
          en: `${nameOf(k).en}: the total looks fine but ${hidden.map(x => x.p).join(', ')} (${pc(100 * hidden.reduce((a, x) => a + x.n, 0) / total, 0)}% of the volume) is under the limit.` },
        needs: { ar: 'حكم لكل منصة بدل الإجمالي.', en: 'A verdict per platform instead of the total.' } });
  }

  // ---- 3. Attribution gap: closings the CRM has but no ad owns. Over all ad results the closing rate sits in a range.
  const sale = c.steps.find(x => x.key === 'sale');
  const U = f.crm.unattributed, res = f.scope.results;
  if (sale && f.crm.linked && res > 0) {
    r.checked++;
    const fl = floorOf(c, sale, cfg) ?? cfg.floors.sale;
    const worst = (100 * f.crm.booked) / res, best = (100 * (f.crm.booked + U)) / res;
    if (says === 'ok' && best < fl)
      add({ id: 'silent_below_floor', kind: 'challenge', effect: 'contradicts', step: 'verdict',
        text: { ar: `الحكم «لا مشكلة» لكن حتى لو كل إقفالة في نظام العملاء من هالإعلانات (${f.crm.closingsAll.toLocaleString('en-US')} من ${res.toLocaleString('en-US')} نتيجة ≈ ${pc(best)}%) تبقى تحت الحد (${pc(fl)}%). صمت الحكم هنا غلط مو غياب مشكلة.`,
          en: `“No problem”, yet even if every CRM closing came from these ads (${f.crm.closingsAll.toLocaleString('en-US')} of ${res.toLocaleString('en-US')} results ≈ ${pc(best)}%) the rate stays under the limit (${pc(fl)}%). The silence is wrong, not the absence of a problem.` },
        needs: { ar: 'ربط الإقفالات بإعلاناتها، أو متابعة مصدر كل إقفالة مدفوعة.', en: 'Tie closings to their ads, or trace the source of each paid closing.' } });
    else if (says === 'problem' && flagged.includes('sale') && best >= fl)
      add({ id: 'attribution_gap_exceeds_effect', kind: 'challenge', effect: 'weakens', step: 'sale',
        text: { ar: `فجوة الربط (${U.toLocaleString('en-US')} إقفالة بدون إعلان) أكبر من الفرق: لو كلها من هالإعلانات توصل النسبة ${pc(best)}% وهي فوق الحد (${pc(fl)}%).`,
          en: `The attribution gap (${U.toLocaleString('en-US')} closings with no ad) is larger than the shortfall: if they all came from these ads the rate would be ${pc(best)}%, above the limit (${pc(fl)}%).` },
        needs: { ar: 'مصدر الإقفالات اللي بدون إعلان.', en: 'The source of the closings that have no ad.' } });
    else if (says === 'ok' && sale && !sale.unattributed && worst < fl && best >= fl)
      add({ id: 'attribution_range_straddles', kind: 'challenge', effect: 'weakens', step: 'verdict',
        text: { ar: `نسبة الإقفال بين ${pc(worst)}% و${pc(best)}% حسب مصدر الإقفالات غير المربوطة، والحد ${pc(fl)}% داخل المدى: «لا مشكلة» مو محسومة.`,
          en: `The closing rate is between ${pc(worst)}% and ${pc(best)}% depending on where unlinked closings came from, and the limit ${pc(fl)}% is inside that range: “no problem” is not settled.` },
        needs: { ar: 'مصدر الإقفالات غير المربوطة.', en: 'The source of the unlinked closings.' } });
    const rg = c.verdict.range;
    if (rg) {
      r.checked++;
      if (Math.abs(rg.best - best) > 0.05 || Math.abs(rg.worst - worst) > 0.05)
        add({ id: 'range_mismatch', kind: 'integrity', effect: 'weakens', step: 'verdict',
          text: { ar: `المدى المذكور (${pc(rg.worst)}–${pc(rg.best)}%) غير مدى الأدنى والأعلى المحسوب هنا (${pc(worst)}–${pc(best)}%، على كل النتائج).`,
            en: `The quoted range (${pc(rg.worst)}–${pc(rg.best)}%) differs from the range computed here (${pc(worst)}–${pc(best)}%, over all results).` } });
    }
  }

  // ---- 4. Timing: leads younger than the usual time to close have not had the chance. Only the lead-date cohort is affected.
  if (c.by === 'lead' && f.cohort.immatureShare != null) {
    r.checked++;
    const sh = f.cohort.immatureShare, fl = sale ? floorOf(c, sale, cfg) ?? cfg.floors.sale : cfg.floors.sale;
    if (sh >= cfg.immatureShare && (flagged.includes('sale') || says === 'ok'))
      add({ id: 'timing_artifact', kind: 'challenge', effect: flagged.includes('sale') && f.cohort.matureRate != null && f.cohort.matureRate >= fl ? 'contradicts' : flagged.includes('sale') ? 'weakens' : 'info', step: flagged.includes('sale') ? 'sale' : 'verdict',
        text: { ar: `${pc(100 * sh, 0)}% من ليدز الفترة أصغر من المدة المعتادة للإقفال (${f.lag.p75} يوم)، فإقفالاتها لسا ما صارت.${f.cohort.matureRate != null ? ` على الليدز الناضجة بس النسبة ${pc(f.cohort.matureRate)}%.` : ''}`,
          en: `${pc(100 * sh, 0)}% of the period's leads are younger than the usual time to close (${f.lag.p75} days), so their closings have not happened yet.${f.cohort.matureRate != null ? ` On mature leads alone the rate is ${pc(f.cohort.matureRate)}%.` : ''}` },
        needs: { ar: `نفس الفترة بعد ${f.lag.p75} يوم، أو مقارنة الليدز الناضجة فقط.`, en: `The same period after ${f.lag.p75} days, or mature leads only.` } });
  }

  // ---- 5. A target that is only a default, behind a step flagged on that target alone
  for (const s of weak) {
    if (!flagged.includes(s.key)) continue;
    r.checked++;
    const fl = floorOf(c, s, cfg);
    if (fl == null || s.now == null || s.targetEdited !== false || s.now >= fl) continue;
    // Is the history also against it? Then the default is not what decides.
    const refs = [s.prev, s.median].filter((x): x is number => x != null && x > 0);
    const histWeak = refs.length > 0 && refs.every(x => (s.key === 'cpl' || s.key === 'cpm' ? x / s.now! : s.now! / x) < cfg.watch);
    if (!histWeak) add({ id: 'default_target', kind: 'challenge', effect: 'weakens', step: s.key,
      text: { ar: `${nameOf(s.key).ar}: الحكم يعتمد على حد (${pc(fl)}%) لسا على قيمته الافتراضية ولا أحد ضبطه، وبالمقارنة مع التاريخ الخطوة مو أضعف.`,
        en: `${nameOf(s.key).en}: the verdict rests on a limit (${pc(fl)}%) still at its shipped default that nobody set, and against its own history the step is not weaker.` },
      needs: { ar: 'تأكيد الحد من المالكة أو من المسؤول عن الخطوة.', en: 'The limit confirmed by the owner or the step owner.' } });
  }

  // ---- 6. The comparison period must have data on most of its days
  if (weak.some(s => s.prev != null)) {
    r.checked++;
    if (f.prev.days > 0 && f.prev.daysWithData / f.prev.days < cfg.prevMinDays)
      add({ id: 'prev_period_holes', kind: 'challenge', effect: 'weakens', step: flagged[0] ?? 'verdict',
        text: { ar: `الفترة السابقة فيها أرقام لـ ${f.prev.daysWithData} من ${f.prev.days} يوم بس، فالمقارنة معها ناقصة.`, en: `The earlier period has data for ${f.prev.daysWithData} of ${f.prev.days} days only, so the comparison with it is incomplete.` },
        needs: { ar: 'أرقام الأيام الناقصة.', en: 'The numbers of the missing days.' } });
  }

  // ---- 7. A verdict with no CRM at all cannot say «no problem» about the sale stage
  if (says === 'ok' && !f.crm.linked) {
    r.checked++;
    add({ id: 'ok_without_crm', kind: 'challenge', effect: 'weakens', step: 'verdict',
      text: { ar: 'نظام العملاء مو موصول: «لا مشكلة» تغطي الإعلانات بس، ما نعرف شي عن الإقفال.', en: 'The CRM is not connected: “no problem” covers the ads only; nothing is known about closing.' },
      needs: { ar: 'ربط نظام العملاء.', en: 'Connect the CRM.' } });
  }
  return r;
}
