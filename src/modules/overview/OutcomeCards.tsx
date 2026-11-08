// النتيجة ورحلة العميل: الإقفالات والمدفوع والعائد وتكلفة العميل من نظام العملاء، وبعدها الرحلة كشريط ينساب بين المراحل
// (FunnelChart، يتحمّل متأخر) مع تحليل عنق الزجاجة (funnel.ts). الحساب في analytics.ts.
import * as React from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type Dash, canCompare, platformNameIn, previous } from './numbers';
import { type CrmBy, type JStat, type Outcome, journey, order, outcome } from './analytics';
import { medians, steps, verdict } from './funnel';
import { qty, sar, show, val } from './format';
import { Delta } from './Delta';
import { pageLang, pick } from './lang';

// The band (d3-shape) and its motion (motion) load after the numbers
const FunnelChart = React.lazy(() => import('./FunnelChart'));

interface Props { data: Dash; from: string; to: string }
const x2 = show.x;
const LEVEL = { bad: 'text-destructive', watch: 'text-amber-700 dark:text-amber-400', ok: 'text-primary' } as const;
const DOT = { bad: 'bg-destructive', watch: 'bg-amber-500', ok: 'bg-primary' } as const;
const BADGE = { ar: { bad: 'مشكلة', watch: 'انتبه', ok: 'تمام' }, en: { bad: 'Problem', watch: 'Watch', ok: 'Fine' } } as const;

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
          <CardTitle>النتيجة</CardTitle>
          <CardDescription>{a.crm ? 'الإقفالات والمدفوع من كل المصادر في نظام العملاء. العائد على الصرف = المدفوع ÷ الصرف. تكلفة العميل = الصرف ÷ الإقفالات.' : 'نظام العملاء مو مربوط، فما فيه إقفالات.'}</CardDescription>
          {a.crm && (
            <CardAction>
              <ToggleGroup type="single" variant="outline" value={by} onValueChange={x => x && setBy(x as CrmBy)} aria-label="الإقفالات حسب">
                <ToggleGroupItem value="lead" className="px-3">يوم الليد</ToggleGroupItem>
                <ToggleGroupItem value="paid" className="px-3">يوم الدفع</ToggleGroupItem>
              </ToggleGroup>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <Stat big label="الصرف" value={sar(a.spend)} now={a.spend} was={v('spend')} lowerIsBetter={null} />
          {a.crm && <>
            <Stat big label="الإقفالات" value={qty(a.closings)} now={a.closings} was={v('closings')} lowerIsBetter={false} />
            <Stat big label="المدفوع" value={sar(a.paid)} now={a.paid} was={v('paid')} lowerIsBetter={false} />
            <Stat big label="العائد على الصرف" value={x2(a.mer)} now={a.mer} was={v('mer')} lowerIsBetter={false} />
            <Stat big label="تكلفة العميل" value={sar(a.cac)} now={a.cac} was={v('cac')} lowerIsBetter />
          </>}
        </CardContent>
      </Card>
      <JourneyCard data={data} from={from} to={to} by={by} />
    </div>
  );
}

// The journey for the period, all platforms or one. The rules (funnel.ts) mark the weakest step and say why and what to do.
// Every word follows the page language (lang.ts): the word list in i18n.js can't translate sentences with numbers in them.
function JourneyCard({ data, from, to, by }: Props & { by: CrmBy }) {
  const l = pageLang(), t = (ar: string, en: string) => pick(l, ar, en);
  const [plat, setPlat] = React.useState('all');
  const p = plat === 'all' ? undefined : plat;
  const a = outcome(data, from, to, by, p);
  const [pf, pt] = previous(from, to);
  const b = canCompare(data, from, to) ? outcome(data, pf, pt, by, p) : null;
  const was = (x: JStat) => (b && x.key ? ((b[x.key] as number | null | undefined) ?? null) : null);
  const j = journey(a, l);
  const list = steps(a, b, medians(data, to, p), l);
  const v = verdict(list, l);
  const plats = order(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('رحلة العميل', 'Customer journey')}</CardTitle>
        <CardDescription>{t('الشريط أعرض كل ما زاد العدد، ويضيق بين المرحلتين إذا كانت الخطوة ضعيفة. مرّر على أي مرحلة أو وصلة عشان تشوف أرقامها.',
          'The band is wider where the count is higher and narrows between two stages when that step is weak. Hover a stage or a link to see its numbers.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* A wrapping row in the body, not the header's action slot: five platforms are wider than a phone */}
        {plats.length > 1 && (
          <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={plat} onValueChange={x => x && setPlat(x)} aria-label={t('المنصة', 'Platform')} className="flex w-full flex-wrap justify-start">
            <ToggleGroupItem value="all" className="flex-none px-3">{t('الكل', 'All')}</ToggleGroupItem>
            {plats.map(x => <ToggleGroupItem key={x} value={x} className="flex-none px-3">{platformNameIn(x, l)}</ToggleGroupItem>)}
          </ToggleGroup>
        )}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
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
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${x.unattributed ? 'bg-muted-foreground/40' : DOT[x.level]}`} aria-hidden="true" />
                    <span className={x.unattributed ? 'text-muted-foreground' : x.level === 'ok' ? '' : LEVEL[x.level]}>{x.line}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <section aria-labelledby="verdict-h" className="grid gap-2 rounded-xl border p-4">
            <div className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${DOT[v.level]}`} aria-hidden="true" />
              <span className={`text-xs font-semibold ${LEVEL[v.level]}`}>{BADGE[l][v.level]}</span>
            </div>
            <h3 id="verdict-h" className="font-semibold">{v.title}</h3>
            {v.why && <p className="text-sm"><span className="text-muted-foreground">{t('ليش: ', 'Why: ')}</span>{v.why}</p>}
            {v.todo && <p className="text-sm"><span className="text-muted-foreground">{t('وش تسوي: ', 'What to do: ')}</span>{v.todo}</p>}
            {v.unlinked && (
              <div className="grid gap-1 rounded-lg border border-dashed p-2.5 text-sm">
                <b className="text-muted-foreground">{t('مرحلة البيع غير مربوطة', 'The sale stage is not linked')}</b>
                <p>{v.unlinked.why}</p>
                <p><span className="text-muted-foreground">{t('وش تسوي: ', 'What to do: ')}</span>{v.unlinked.todo}</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t('حكم بالقواعد: كل خطوة مقارنة بالفترة السابقة وبالمعتاد آخر 30 يوم وبحد أدنى. ما تطلع الأرقام لأي مكان.',
              'Rule-based: each step is compared with the earlier period, its usual level over the last 30 days, and a floor. No figures leave the page.')}</p>
          </section>
        </div>
        {j.noCrm && <p className="text-sm text-muted-foreground">{j.noCrm}</p>}
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
