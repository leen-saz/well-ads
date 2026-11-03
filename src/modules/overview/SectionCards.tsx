// كروت الأرقام: كل رقم مع نسبة تغيّره عن نفس المدة اللي قبلها، وخط صغير لمشيه خلال الفترة
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Area, AreaChart } from 'recharts';
import { type ChartConfig, ChartContainer } from '@/components/ui/chart';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { type Dash, canCompare, change, previous, summarize } from './numbers';
import { type Bucket, buckets } from './analytics';
import { pct, qty, sar } from './format';

interface Props { data: Dash; from: string; to: string }

const spark = { v: { label: '', color: 'var(--ui-chart-1)' } } satisfies ChartConfig;
// The card's number for each day (week or month on long periods); a day with nothing to divide is a gap, not a zero
function Spark({ points }: { points: (number | null)[] }) {
  if (points.filter(v => v != null).length < 2) return null;
  return (
    <ChartContainer config={spark} className="aspect-auto h-10 w-full" dir="ltr" aria-hidden="true">
      <AreaChart data={points.map(v => ({ v }))} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <Area dataKey="v" type="monotone" stroke="var(--color-v)" fill="var(--color-v)" fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
      </AreaChart>
    </ChartContainer>
  );
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
  const bk = buckets(data, from, to);
  const line = (f: (b: Bucket) => number | null) => bk.map(f);
  const cards: { label: string; value: string; d: number | null; lowerIsBetter: boolean | null; note: string; points: (number | null)[] }[] = [
    { label: 'الصرف', value: sar(now.spend), d: vs(now.spend, was.spend), lowerIsBetter: null, note: ok ? `قبلها ${sar(was.spend)}` : 'ما فيه مقارنة: الفترة اللي قبلها ناقصة', points: line(b => b.spend) },
    { label: 'النتائج', value: qty(now.results), d: vs(now.results, was.results), lowerIsBetter: false, note: 'الليدز والمحادثات', points: line(b => b.results) },
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
              {c.note}
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
