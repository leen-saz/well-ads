// كروت الأرقام: كل رقم مع نسبة تغيّره عن نفس المدة اللي قبلها، وخط صغير لمشيه خلال الفترة
import * as React from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { type Dash, canCompare, change, mover, platformName, previous, summarize } from './numbers';
import { type Bucket, buckets } from './analytics';
import { pct, qty, sar } from './format';

interface Props { data: Dash; from: string; to: string }

// Recharts (the biggest library on the page) loads after the cards: until then the line's space is kept empty
const SparkLine = React.lazy(() => import('./Spark'));
function Spark({ points }: { points: (number | null)[] }) {
  if (points.filter(v => v != null).length < 2) return null;
  return <React.Suspense fallback={<div className="h-10 w-full" aria-hidden="true" />}><SparkLine points={points} /></React.Suspense>;
}
const per = (a: number, b: number) => (b > 0 ? a / b : null);

export function SectionCards({ data, from, to }: Props) {
  const now = summarize(data, from, to);
  const [pf, pt] = previous(from, to);
  const was = summarize(data, pf, pt);
  // No comparison when the earlier period is outside the data or a platform has a gap, like the main dashboard
  const ok = canCompare(data, from, to);
  const vs = (a: number | null, b: number | null) => (ok ? change(a, b) : null);
  // lowerIsBetter: a drop in cost per result is good news; spend is neither good nor bad (null)
  // The 'why' line: the platform that moved the number most (shadcn dashboard-01 card footer)
  const why = (field: 'spend' | 'res', fmt: (n: number) => string) => {
    if (!ok) return null;
    const m = mover(data, from, to, pf, pt, field);
    if (!m) return null;
    const sign = m.delta > 0 ? '+' : '−';
    return `${m.delta > 0 ? 'أكبر زيادة' : 'أكبر نزول'} من ${platformName(m.platform)}: ${sign}${fmt(Math.abs(m.delta))}`;
  };
  const bk = buckets(data, from, to);
  const line = (f: (b: Bucket) => number | null) => bk.map(f);
  const cards: { label: string; value: string; d: number | null; lowerIsBetter: boolean | null; note: string; points: (number | null)[]; why?: string | null }[] = [
    { label: 'الصرف', value: sar(now.spend), d: vs(now.spend, was.spend), lowerIsBetter: null, note: ok ? `قبلها ${sar(was.spend)}` : 'ما فيه مقارنة: الفترة اللي قبلها ناقصة', points: line(b => b.spend), why: why('spend', sar) },
    { label: 'النتائج', value: qty(now.results), d: vs(now.results, was.results), lowerIsBetter: false, note: 'الليدز والمحادثات', points: line(b => b.results), why: why('res', qty) },
    { label: 'تكلفة النتيجة', value: sar(now.cpr), d: vs(now.cpr, was.cpr), lowerIsBetter: true, note: ok ? `قبلها ${sar(was.cpr)}` : 'الصرف ÷ الليدز والمحادثات', points: line(b => per(b.spend, b.results)) },
    { label: 'نسبة النقر', value: pct(now.ctr), d: vs(now.ctr, was.ctr), lowerIsBetter: false, note: `${qty(now.clicks)} نقرة من ${qty(now.impr)} ظهور`, points: line(b => { const r = per(b.clicks, b.impr); return r == null ? null : 100 * r; }) },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs">
      {cards.map(c => {
        const good = c.d == null || c.lowerIsBetter == null ? null : c.lowerIsBetter ? c.d < 0 : c.d > 0;
        const Icon = c.d != null && c.d < 0 ? TrendingDown : TrendingUp;
        return (
          <Card key={c.label} className="@container/card">
            <CardHeader>
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold whitespace-nowrap tabular-nums @[280px]/card:text-3xl">{c.value}</CardTitle>
              {c.d != null && (
                <CardAction>
                  <Badge variant="outline" className={good == null ? '' : good ? 'text-primary' : 'text-destructive'}>
                    <Icon />
                    <span dir="ltr">{c.d > 0 ? '+' : ''}{c.d.toFixed(1)}%</span>
                  </Badge>
                </CardAction>
              )}
            </CardHeader>
            <CardFooter className="flex-col items-stretch gap-2 text-sm text-muted-foreground">
              <Spark points={c.points} />
              {c.why && <div className="font-medium text-foreground">{c.why}</div>}
              {c.note}
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
