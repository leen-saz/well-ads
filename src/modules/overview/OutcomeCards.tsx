// النتيجة ورحلة العميل: الإقفالات والمدفوع والعائد وتكلفة العميل من نظام العملاء، وبعدها مراحل الرحلة بنسبة كل انتقال. الحساب في analytics.ts.
import * as React from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type Dash, canCompare, change, previous } from './numbers';
import { type CrmBy, type Fmt, type JStat, type Outcome, journey, outcome } from './analytics';
import { qty, sar } from './format';

interface Props { data: Dash; from: string; to: string }
const p2 = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`);
const x2 = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}×`);
const show: Record<Fmt, (v: number | null) => string> = { qty: v => (v == null ? '—' : qty(v)), sar: v => (v == null ? '—' : sar(v)), pct: p2, x: x2 };

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
  const j = journey(a);
  const was = (x: JStat) => (x.key ? v(x.key) : null);

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
      <Card>
        <CardHeader><CardTitle>رحلة العميل</CardTitle><CardDescription>كل مرحلة أضيق من اللي فوقها: عددها في النص، تكلفتها على الجنب، والنسبة اللي تنقل الناس للمرحلة اللي بعدها بينهم.</CardDescription></CardHeader>
        <CardContent>
          {/* Same funnel as the main dashboard (template.html .ffun): layer name, a trapezoid band, the cost beside it */}
          <ol className="grid" aria-label="رحلة العميل">
            {j.stages.map((s, i) => (
              <li key={s.n} className="grid">
                {s.rate && (
                  <div className="flex items-center justify-center gap-2 py-1.5 text-sm">
                    <span aria-hidden="true" className="font-bold text-primary">↓</span>
                    <span className="flex flex-wrap items-baseline gap-1.5 rounded-full bg-primary/10 px-3 py-0.5">
                      <span className="text-xs text-muted-foreground">{s.rate.label}</span>
                      <b className="tabular-nums">{show[s.rate.fmt](s.rate.now)}</b>
                      <Delta now={s.rate.now} was={was(s.rate)} lowerIsBetter={false} />
                    </span>
                  </div>
                )}
                <div className="grid items-center gap-1.5 md:grid-cols-[minmax(7.5rem,1fr)_minmax(0,2.4fr)_minmax(9rem,1fr)] md:gap-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="grid size-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground">{i + 1}</b>
                    <span className="font-semibold">{s.n}</span>
                    <span className="basis-full text-xs text-muted-foreground">{s.hint}</span>
                  </div>
                  <div className="flex justify-center">
                    <div className="grid justify-items-center gap-0.5 px-5 pt-3 pb-3.5 text-center text-white md:min-w-44"
                      style={{ width: `${s.width}%`, background: s.colour, clipPath: 'polygon(0 0,100% 0,94% 100%,6% 100%)' }}>
                      <span className="text-sm opacity-85">{s.main.label}</span>
                      <span className="text-2xl font-semibold tabular-nums">{show[s.main.fmt](s.main.now)}</span>
                      <span className="opacity-85 [&_span]:text-white!"><Delta now={s.main.now} was={was(s.main)} lowerIsBetter={s.main.lowerIsBetter} /></span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-1">
                    {s.sub.map(x => <Stat key={x.label} label={x.label} value={show[x.fmt](x.now)} now={x.now} was={was(x)} lowerIsBetter={x.lowerIsBetter} />)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {j.noCrm && <p className="mt-3 text-sm text-muted-foreground">{j.noCrm}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
