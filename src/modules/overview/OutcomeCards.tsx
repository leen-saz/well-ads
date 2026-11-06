// النتيجة ورحلة العميل: الإقفالات والمدفوع والعائد وتكلفة العميل من نظام العملاء، وبعدها الرحلة كشريط ينساب بين المراحل
// (FunnelChart، يتحمّل متأخر) مع تحليل عنق الزجاجة (funnel.ts). الحساب في analytics.ts.
import * as React from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type Dash, canCompare, change, platformName, previous } from './numbers';
import { type CrmBy, type JStat, type Outcome, journey, order, outcome } from './analytics';
import { medians, steps, verdict } from './funnel';
import { qty, sar, show } from './format';

// The band (d3-shape) and its motion (motion) load after the numbers
const FunnelChart = React.lazy(() => import('./FunnelChart'));

interface Props { data: Dash; from: string; to: string }
const x2 = show.x;
const LEVEL = { bad: 'text-destructive', watch: 'text-amber-700 dark:text-amber-400', ok: 'text-primary' } as const;
const DOT = { bad: 'bg-destructive', watch: 'bg-amber-500', ok: 'bg-primary' } as const;
const BADGE = { bad: 'مشكلة', watch: 'انتبه', ok: 'تمام' } as const;

// The change against the same length before; lowerIsBetter colours a drop in cost as good news, null = neither
function Delta({ now, was, lowerIsBetter }: { now: number | null; was: number | null; lowerIsBetter: boolean | null }) {
  const d = change(now, was);
  if (d == null) return null;
  const good = lowerIsBetter == null ? null : lowerIsBetter ? d < 0 : d > 0;
  return <span dir="ltr" className={`text-xs tabular-nums ${good == null ? 'text-muted-foreground' : good ? 'text-primary' : 'text-destructive'}`}>{d > 0 ? '+' : ''}{d.toFixed(1)}%</span>;
}

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
function JourneyCard({ data, from, to, by }: Props & { by: CrmBy }) {
  const [plat, setPlat] = React.useState('all');
  const p = plat === 'all' ? undefined : plat;
  const a = outcome(data, from, to, by, p);
  const [pf, pt] = previous(from, to);
  const b = canCompare(data, from, to) ? outcome(data, pf, pt, by, p) : null;
  const was = (x: JStat) => (b && x.key ? ((b[x.key] as number | null | undefined) ?? null) : null);
  const j = journey(a);
  const list = steps(a, b, medians(data, to, p));
  const v = verdict(list);
  const plats = order(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle>رحلة العميل</CardTitle>
        <CardDescription>الشريط أعرض كل ما زاد العدد، ويضيق بين المرحلتين إذا كانت الخطوة ضعيفة. مرّر على أي مرحلة أو وصلة عشان تشوف أرقامها.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* A wrapping row in the body, not the header's action slot: five platforms are wider than a phone */}
        {plats.length > 1 && (
          <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={plat} onValueChange={x => x && setPlat(x)} aria-label="المنصة" className="flex w-full flex-wrap justify-start">
            <ToggleGroupItem value="all" className="flex-none px-3">الكل</ToggleGroupItem>
            {plats.map(x => <ToggleGroupItem key={x} value={x} className="flex-none px-3">{platformName(x)}</ToggleGroupItem>)}
          </ToggleGroup>
        )}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <React.Suspense fallback={<Skeleton className="h-[340px] rounded-xl" />}>
            <FunnelChart stages={j.stages} steps={list} verdict={v} was={was} />
          </React.Suspense>
          <section aria-labelledby="verdict-h" className="grid gap-2 rounded-xl border p-4">
            <div className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${DOT[v.level]}`} aria-hidden="true" />
              <span className={`text-xs font-semibold ${LEVEL[v.level]}`}>{BADGE[v.level]}</span>
            </div>
            <h3 id="verdict-h" className="font-semibold">{v.title}</h3>
            {v.why && <p className="text-sm"><span className="text-muted-foreground">ليش: </span>{v.why}</p>}
            {v.todo && <p className="text-sm"><span className="text-muted-foreground">وش تسوي: </span>{v.todo}</p>}
            <p className="text-xs text-muted-foreground">حكم بالقواعد: كل خطوة مقارنة بالفترة اللي قبلها وبالمعتاد آخر 30 يوم وبحد أدنى. ما تطلع الأرقام لأي مكان.</p>
          </section>
        </div>
        <ul className="grid gap-1.5 text-sm" aria-label="التحليل لكل خطوة">
          {list.map(x => (
            <li key={x.key} className="flex items-start gap-2">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[x.level]}`} aria-hidden="true" />
              <span><b>التحليل</b> <span className="text-muted-foreground">({x.label})</span>: <span className={x.level === 'ok' ? '' : LEVEL[x.level]}>{x.line}</span></span>
            </li>
          ))}
        </ul>
        {j.noCrm && <p className="text-sm text-muted-foreground">{j.noCrm}</p>}
        <details className="min-w-0 text-sm">
          <summary className="cursor-pointer text-muted-foreground">الأرقام كجدول</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] text-start">
              <caption className="sr-only">رحلة العميل بالأرقام</caption>
              <thead><tr className="border-b text-muted-foreground"><th className="p-2 text-start font-normal">المرحلة</th><th className="p-2 text-start font-normal">العدد</th><th className="p-2 text-start font-normal">التكلفة</th><th className="p-2 text-start font-normal">النسبة من اللي قبلها</th></tr></thead>
              <tbody>
                {j.stages.map((s, i) => (
                  <tr key={s.n} className="border-b last:border-0">
                    <th scope="row" className="p-2 text-start font-semibold">{i + 1}. {s.n}</th>
                    <td className="p-2 tabular-nums">{s.main.label}: {show[s.main.fmt](s.main.now)} <Delta now={s.main.now} was={was(s.main)} lowerIsBetter={false} /></td>
                    <td className="p-2 tabular-nums">{s.sub.map(x => `${x.label}: ${show[x.fmt](x.now)}`).join('، ')}</td>
                    <td className="p-2 tabular-nums">{s.rate ? `${s.rate.label}: ${show[s.rate.fmt](s.rate.now)}` : '—'}</td>
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
