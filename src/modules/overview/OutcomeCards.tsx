// النتيجة ورحلة العميل: الإقفالات والمدفوع والعائد وتكلفة العميل من نظام العملاء، وبعدها الرحلة كشريط ينساب بين المراحل
// (FunnelChart، يتحمّل متأخر) مع تحليل عنق الزجاجة (funnel.ts). الحساب في analytics.ts.
import * as React from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type Dash, canCompare, platformNameIn, previous } from './numbers';
import { type CrmBy, type JStat, type Outcome, journey, order, outcome } from './analytics';
import { type Targets, J, configTargets, formats, judgeFunnel, resolveTargets, saveTargets, savedTargets } from './judge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fullDay, qty, sar, show, val } from './format';
import type { DataSpan } from './span';
import { Delta } from './Delta';
import { T, pageLang, pick } from './lang';
import { AuditBadge } from './AuditBadge';

// The band (d3-shape) and its motion (motion) load after the numbers
const FunnelChart = React.lazy(() => import('./FunnelChart'));

interface Props { data: Dash; from: string; to: string }
const x2 = show.x;
// Severity colours (the words come from the rules file: تمام / انتبه / مشكلة / كارثة)
const LEVEL = { disaster: 'text-destructive font-semibold', problem: 'text-destructive', watch: 'text-amber-700 dark:text-amber-400', fine: 'text-primary', na: 'text-muted-foreground' } as const;
const DOT = { disaster: 'bg-destructive ring-2 ring-destructive/30', problem: 'bg-destructive', watch: 'bg-amber-500', fine: 'bg-primary', na: 'bg-muted-foreground/40' } as const;
const CONF = { ar: { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' }, en: { high: 'high', medium: 'medium', low: 'low' } } as const;

function Stat({ label, value, now, was, lowerIsBetter, big }: { label: string; value: string; now: number | null; was: number | null; lowerIsBetter: boolean | null; big?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`${big ? 'text-2xl' : 'text-lg'} font-semibold tabular-nums`}>{value}</span>
      <Delta now={now} was={was} lowerIsBetter={lowerIsBetter} />
    </div>
  );
}

export function OutcomeCards({ data, from, to }: Props) {
  const [by, setBy] = React.useState<CrmBy>('lead');
  const a = outcome(data, from, to, by);
  const [pf, pt] = previous(from, to);
  // Same rule as the main dashboard: no comparison when the earlier period is incomplete
  const b: Partial<Outcome> = canCompare(data, from, to) ? outcome(data, pf, pt, by) : {};
  const v = (k: keyof Outcome) => (b[k] as number | null | undefined) ?? null;
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{T('النتيجة', 'Result')}</CardTitle>
          <CardDescription>{a.crm ? T('الإقفالات والمدفوع من كل المصادر في نظام العملاء. العائد على الصرف = المدفوع ÷ الصرف. تكلفة العميل = الصرف ÷ الإقفالات.', 'Closings and payments from every source in the CRM. Return on spend = paid ÷ spend. Cost per customer = spend ÷ closings.') : T('نظام العملاء مو مربوط، فما فيه إقفالات.', 'The CRM is not connected, so there are no closings.')}</CardDescription>
          {a.crm && (
            <CardAction>
              <ToggleGroup type="single" variant="outline" value={by} onValueChange={x => x && setBy(x as CrmBy)} aria-label={T('الإقفالات حسب', 'Closings by')}>
                <ToggleGroupItem value="lead" className="px-3">{T('يوم الليد', 'Lead day')}</ToggleGroupItem>
                <ToggleGroupItem value="paid" className="px-3">{T('يوم الدفع', 'Payment day')}</ToggleGroupItem>
              </ToggleGroup>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <Stat big label={T('الصرف', 'Spend')} value={sar(a.spend)} now={a.spend} was={v('spend')} lowerIsBetter={null} />
          {a.crm && <>
            <Stat big label={T('الإقفالات', 'Closings')} value={qty(a.closings)} now={a.closings} was={v('closings')} lowerIsBetter={false} />
            <Stat big label={T('المدفوع', 'Paid')} value={sar(a.paid)} now={a.paid} was={v('paid')} lowerIsBetter={false} />
            <Stat big label={T('العائد على الصرف', 'Return on spend')} value={a.closings ? x2(a.mer) : T('لا توجد إقفالات', 'No closings')} now={a.mer} was={v('mer')} lowerIsBetter={false} />
            <Stat big label={T('تكلفة العميل', 'Cost per customer')} value={a.closings ? sar(a.cac) : T('لا توجد إقفالات', 'No closings')} now={a.cac} was={v('cac')} lowerIsBetter />
          </>}
        </CardContent>
      </Card>
      <JourneyCard data={data} from={from} to={to} by={by} />
      <DataSpanCard />
    </div>
  );
}

// The journey for the period, all platforms or one. The marketing judge (judge.ts, the main page's own rules file) puts
// every step against an absolute target and names the worst, its owner, the evidence and the money at stake.
// Every word follows the page language (lang.ts): the word list in i18n.js can't translate sentences with numbers in them.
function JourneyCard({ data, from, to, by }: Props & { by: CrmBy }) {
  const l = pageLang(), t = (ar: string, en: string) => pick(l, ar, en);
  const [plat, setPlat] = React.useState('all');
  const [edits, setEdits] = React.useState<Partial<Targets> | null>(() => savedTargets());
  const p = plat === 'all' ? undefined : plat;
  const a = outcome(data, from, to, by, p);
  const [pf, pt] = previous(from, to);
  const b = canCompare(data, from, to) ? outcome(data, pf, pt, by, p) : null;
  const was = (x: JStat) => (b && x.key ? ((b[x.key] as number | null | undefined) ?? null) : null);
  const j = journey(a, l);
  const targets = resolveTargets(data, edits);
  const v = judgeFunnel(data, from, to, by, p, targets);
  const list = v.steps;
  const plats = order(data);
  const edit = (k: keyof Targets, x: string) => {
    const next = { ...(edits ?? {}) } as Record<string, number>;
    const n = Number(x);
    if (x === '' || !(n > 0)) delete next[k]; else next[k] = n;
    setEdits(next); saveTargets(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('رحلة العميل', 'Customer journey')}</CardTitle>
        <CardDescription>{t('الشريط أعرض كل ما زاد العدد، ويضيق بين المرحلتين إذا كانت الخطوة تحت هدفها. مرّر على أي مرحلة أو وصلة عشان تشوف أرقامها.',
          'The band is wider where the count is higher and narrows between two stages when that step is under its target. Hover a stage or a link to see its numbers.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* A wrapping row in the body, not the header's action slot: five platforms are wider than a phone */}
        {plats.length > 1 && (
          <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={plat} onValueChange={x => x && setPlat(x)} aria-label={t('المنصة', 'Platform')} className="flex w-full flex-wrap justify-start">
            <ToggleGroupItem value="all" className="flex-none px-3">{t('الكل', 'All')}</ToggleGroupItem>
            {plats.map(x => <ToggleGroupItem key={x} value={x} className="flex-none px-3">{platformNameIn(x, l)}</ToggleGroupItem>)}
          </ToggleGroup>
        )}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
          {/* The pipe and its analysis in one column, the verdict beside them: the two columns end together */}
          <div className="grid min-w-0 gap-4">
            <React.Suspense fallback={<Skeleton className="h-[260px] rounded-xl" />}>
              <FunnelChart stages={j.stages} steps={list} verdict={v} was={was} />
            </React.Suspense>
            <section aria-labelledby="analysis-h" className="grid gap-1.5 text-sm">
              <h4 id="analysis-h" className="m-0 font-semibold">{t('التحليل', 'Analysis')}</h4>
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {list.map(x => (
                  <li key={x.key} className="flex items-start gap-2">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[x.level]}`} aria-hidden="true" />
                    <span className="grid gap-0.5">
                      <span className={LEVEL[x.level]}>{x.line}</span>
                      {/* Who owns this step; and, when it is under target or not linked, that department's fix */}
                      <span className="text-xs text-muted-foreground">{t('المسؤول', 'Owner')}: {x.owner}{x.unattributed || (x.level !== 'fine' && x.level !== 'na') ? ` · ${x.fix}` : ''}</span>
                    </span>
                  </li>
                ))}
                {v.e2e && (
                  <li className="flex items-start gap-2">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[v.e2e.level]}`} aria-hidden="true" />
                    <span className={LEVEL[v.e2e.level]}>{v.e2e.line}</span>
                  </li>
                )}
              </ul>
              <div className="grid gap-0.5 text-xs text-muted-foreground">
                {v.biggest && <p className="m-0 text-sm font-semibold text-foreground">{v.biggest}</p>}
                <p className="m-0">{v.trust.line}</p>
                {v.cohort && <p className="m-0">{v.cohort.line}</p>}
              </div>
            </section>
          </div>
          <section aria-labelledby="verdict-h" data-level={v.level} className="grid gap-2 rounded-xl border p-4">
            <div className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${DOT[v.level]}`} aria-hidden="true" />
              <span className={`text-xs font-semibold ${LEVEL[v.level]}`}>{J.pick(l, J.SEV[v.level])}</span>
              <span className="ms-auto text-xs text-muted-foreground">{t('الثقة', 'Confidence')}: {CONF[l][v.confidence]}</span>
            </div>
            <h3 id="verdict-h" className="font-semibold">{v.title}</h3>
            {v.owner && <Owner who={v.owner} label={t('المسؤول', 'Owner')} />}
            <AuditBadge data={data} from={from} to={to} by={by} plat={p} />
            {v.stage && <p className="text-sm"><span className="text-muted-foreground">{t('المرحلة: ', 'Stage: ')}</span>{v.stage}</p>}
            {v.evidence && <p className="text-sm tabular-nums"><span className="text-muted-foreground">{t('الدليل: ', 'Evidence: ')}</span>{v.evidence}</p>}
            {v.sar != null && <p className="text-sm tabular-nums"><span className="text-muted-foreground">{t('على المحك: ', 'At stake: ')}</span><b>≈ {formats().sar(v.sar)}</b></p>}
            {v.why && <p className="text-sm"><span className="text-muted-foreground">{t('ليش: ', 'Why: ')}</span>{v.why}</p>}
            {v.todo && <p className="text-sm"><span className="text-muted-foreground">{t('وش تسوي: ', 'What to do: ')}</span>{v.todo}</p>}
            {v.change && <p className="text-sm"><span className="text-muted-foreground">{t('وش يغيّر الحكم: ', 'What would change it: ')}</span>{v.change}</p>}
            {v.unlinked && (
              <div className="grid gap-1 rounded-lg border border-dashed p-2.5 text-sm">
                <b className="text-muted-foreground">{t('الربط بالإعلانات ناقص', 'Attribution to ads is incomplete')}</b>
                <Owner who={v.unlinked.owner} label={t('المسؤول', 'Owner')} />
                <p>{v.unlinked.why}</p>
                <p><span className="text-muted-foreground">{t('وش تسوي: ', 'What to do: ')}</span>{v.unlinked.todo}</p>
              </div>
            )}
            {v.rule && <p className="text-xs text-muted-foreground">{t('القاعدة: ', 'Rule: ')}{v.rule}</p>}
            <p className="text-xs text-muted-foreground">{t('حكم بالقواعد: كل خطوة مقابل هدف ثابت من جدول الأهداف تحت. ما تطلع الأرقام لأي مكان.',
              'Rule-based: every step against a fixed target from the table below. No figures leave the page.')}</p>
          </section>
        </div>
        {j.noCrm && <p className="text-sm text-muted-foreground">{j.noCrm}</p>}
        <TargetsTable targets={targets} config={configTargets(data)} edits={edits} onEdit={edit} onReset={() => { setEdits(null); saveTargets(null); }} />
        <details className="min-w-0 text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t('الأرقام كجدول', 'The numbers as a table')}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] text-start">
              <caption className="sr-only">{t('رحلة العميل بالأرقام', 'Customer journey in numbers')}</caption>
              <thead><tr className="border-b text-muted-foreground">
                <th className="p-2 text-start font-normal">{t('المرحلة', 'Stage')}</th><th className="p-2 text-start font-normal">{t('العدد', 'Count')}</th>
                <th className="p-2 text-start font-normal">{t('التكلفة', 'Cost')}</th><th className="p-2 text-start font-normal">{t('النسبة من اللي قبلها', 'Rate from the stage before')}</th></tr></thead>
              <tbody>
                {j.stages.map((s, i) => (
                  <tr key={s.n} className="border-b last:border-0">
                    <th scope="row" className="p-2 text-start font-semibold">{i + 1}. {s.n}</th>
                    <td className="p-2 tabular-nums">{s.main.label}: {val(s.main)} <Delta now={s.main.now} was={was(s.main)} lowerIsBetter={false} /></td>
                    <td className="p-2 tabular-nums">{s.sub.map(x => `${x.label}: ${val(x)}`).join(t('، ', ', '))}</td>
                    <td className="p-2 tabular-nums">{s.rate ? `${s.rate.label}: ${val(s.rate)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

// The benchmark table: the targets the judge uses. Each starts as the default (targets.json); a change here is the
// viewer's own (kept in this browser, shared with the main page) until «رجّع الافتراضي».
function TargetsTable({ targets, config, edits, onEdit, onReset }: { targets: Targets; config: Targets; edits: Partial<Targets> | null; onEdit: (k: keyof Targets, v: string) => void; onReset: () => void }) {
  const l = pageLang(), t = (ar: string, en: string) => pick(l, ar, en);
  const unit = { '%': '%', sar: t('ريال', 'SAR'), share: t('من قيمتها', 'of its value'), x: '×', days: t('يوم', 'days') } as const;
  const edited = !!edits && Object.keys(edits).length > 0;
  return (
    <details className="min-w-0 text-sm">
      <summary className="cursor-pointer text-muted-foreground">{t('الأهداف اللي ينحكم عليها', 'The targets it judges against')}</summary>
      <div className="mt-2 grid gap-2">
        <div className="overflow-x-auto">
          <table className="w-full text-start">
            <caption className="sr-only">{t('جدول الأهداف', 'Targets table')}</caption>
            <tbody>
              {J.FIELDS.map(f => {
                const mine = edits?.[f.key] != null && edits[f.key] !== config[f.key];
                return (
                  <tr key={f.key} className="border-b last:border-0">
                    <th scope="row" className="p-2 text-start font-normal">{J.pick(l, f.label)}</th>
                    <td className="p-2">
                      <label className="flex items-center gap-2">
                        <span className="sr-only">{J.pick(l, f.label)}</span>
                        <Input type="number" inputMode="decimal" min={0} step="any" className="h-8 w-20 tabular-nums" value={targets[f.key]} onChange={e => onEdit(f.key, e.target.value)} />
                        <span className="text-muted-foreground">{unit[f.unit]}</span>
                      </label>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{mine ? t('معدّل منك', 'Your edit') : t('افتراضي — عدّله', 'Default — edit it')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t('التعديل يتحفظ في متصفحك بس. الأهداف الدائمة تتعدّل في ملف الأهداف بطلب تغيير.', 'Edits are kept in this browser only. The lasting targets live in pipeline/config/targets.json.')}</span>
          {edited && <Button variant="outline" size="sm" onClick={onReset}>{t('رجّع الافتراضي', 'Back to defaults')}</Button>}
        </div>
      </div>
    </details>
  );
}

// The department that owns a problem, as a chip
function Owner({ who, label }: { who: string; label: string }) {
  return <span className="w-fit rounded-full border px-2.5 py-0.5 text-xs"><span className="text-muted-foreground">{label}: </span><b>{who}</b></span>;
}

// How much history the judge sees, for the owner only (/api/overview/span answers nobody else, and then this shows
// nothing): the daily-spend span overall and per channel, the CRM closing days. Counts and dates only. A media-mix model
// (MMM) later needs about two years of daily spend per channel.
function DataSpanCard() {
  const [span, setSpan] = React.useState<DataSpan | null>(null);
  React.useEffect(() => {
    let on = true;
    fetch('/api/overview/span', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() as Promise<DataSpan> : null)).then(x => { if (on && x) setSpan(x); }).catch(() => {});
    return () => { on = false; };
  }, []);
  if (!span) return null;
  const l = pageLang(), t = (ar: string, en: string) => pick(l, ar, en);
  const range = (x: { first: string | null; last: string | null; days: number }) => x.first && x.last
    ? t(`من ${fullDay(x.first)} إلى ${fullDay(x.last)} · ${qty(x.days)} يوم`, `${fullDay(x.first)} to ${fullDay(x.last)} · ${qty(x.days)} days`) : t('ما فيه أيام', 'no days');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('مدى البيانات', 'Data span')}</CardTitle>
        <CardDescription>{t('لك بس: كم تاريخ يشوف الحكم. أيام وأعداد بس، بدون مبالغ.', 'Owner only: how much history the judge sees. Days and counts only, no amounts.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="m-0"><span className="text-muted-foreground">{t('الصرف اليومي: ', 'Daily spend: ')}</span><span className="tabular-nums">{range(span.spend)}</span></p>
        <ul className="m-0 grid list-none gap-1 p-0">
          {span.channels.map(c => (
            <li key={c.channel} className="flex flex-wrap gap-x-2">
              <b>{platformNameIn(c.channel, l)}</b><span className="tabular-nums text-muted-foreground">{range(c)}</span>
              <span className={c.mmmReady ? 'text-primary' : 'text-amber-700 dark:text-amber-400'}>{c.mmmReady ? t('يكفي', 'enough') : t(`ناقص ${qty(span.mmm.needDays - c.days)} يوم`, `${qty(span.mmm.needDays - c.days)} days short`)}</span>
            </li>
          ))}
        </ul>
        <p className="m-0"><span className="text-muted-foreground">{t('إقفالات نظام العملاء: ', 'CRM closings: ')}</span>
          <span className="tabular-nums">{span.crm ? t(`${qty(span.crm.closings)} إقفالة على ${qty(span.crm.days)} يوم`, `${qty(span.crm.closings)} closings over ${qty(span.crm.days)} days`) + (span.crm.first ? ` · ${range(span.crm)}` : '') : t('نظام العملاء مو موصول', 'the CRM is not connected')}</span></p>
        <p className={`m-0 font-semibold ${span.mmm.ready ? 'text-primary' : ''}`}>
          {span.mmm.ready ? t('نموذج توزيع الميزانية (MMM) ممكن: كل قناة عندها سنتين من الصرف اليومي.', 'A media-mix model (MMM) is feasible: every channel has two years of daily spend.')
            : t(`نموذج توزيع الميزانية (MMM) مو جاهز للحين: يحتاج تقريبًا ${qty(span.mmm.needDays)} يوم من الصرف اليومي لكل قناة.`, `A media-mix model (MMM) is not feasible yet: it needs about ${qty(span.mmm.needDays)} days of daily spend per channel.`)}
        </p>
      </CardContent>
    </Card>
  );
}
