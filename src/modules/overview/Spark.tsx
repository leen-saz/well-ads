// The small line in each number card. Its own file so Recharts loads after the cards are drawn (SectionCards.tsx).
import { Area, AreaChart } from 'recharts';
import { type ChartConfig, ChartContainer } from '@/components/ui/chart';

const spark = { v: { label: '', color: 'var(--ui-chart-1)' } } satisfies ChartConfig;
// The card's number for each day (week or month on long periods); a day with nothing to divide is a gap, not a zero
export default function Spark({ points }: { points: (number | null)[] }) {
  return (
    <ChartContainer config={spark} className="aspect-auto h-10 w-full" dir="ltr" aria-hidden="true">
      <AreaChart data={points.map(v => ({ v }))} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <Area dataKey="v" type="monotone" stroke="var(--color-v)" fill="var(--color-v)" fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
      </AreaChart>
    </ChartContainer>
  );
}
