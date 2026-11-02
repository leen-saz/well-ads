// كروت الأرقام: كل رقم مع نسبة تغيّره عن نفس المدة اللي قبلها
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { type Dash, change, previous, summarize } from './numbers';
import { pct, qty, sar } from './format';

interface Props { data: Dash; from: string; to: string }

export function SectionCards({ data, from, to }: Props) {
  const now = summarize(data, from, to);
  const [pf, pt] = previous(from, to);
  const was = summarize(data, pf, pt);
  // lowerIsBetter: a drop in cost per result is good news; spend is neither good nor bad (null)
  const cards: { label: string; value: string; d: number | null; lowerIsBetter: boolean | null; note: string }[] = [
    { label: 'الصرف', value: sar(now.spend), d: change(now.spend, was.spend), lowerIsBetter: null, note: `قبلها ${sar(was.spend)}` },
    { label: 'النتائج', value: qty(now.results), d: change(now.results, was.results), lowerIsBetter: false, note: 'ليدز ومحادثات حسب هدف كل حملة' },
    { label: 'تكلفة النتيجة', value: sar(now.cpr), d: change(now.cpr, was.cpr), lowerIsBetter: true, note: `قبلها ${sar(was.cpr)}` },
    { label: 'نسبة النقر', value: pct(now.ctr), d: change(now.ctr, was.ctr), lowerIsBetter: false, note: `${qty(now.clicks)} نقرة من ${qty(now.impr)} ظهور` },
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
            <CardFooter className="text-sm text-muted-foreground">{c.note}</CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
