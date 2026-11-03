// الرسم اليومي: الصرف أو النتائج، والأرقام تطلع لما تمرّر على اليوم
import * as React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type Dash, type Day, daily } from './numbers';
import { shortDay } from './format';

const config = {
  spend: { label: 'الصرف (ر.س)', color: 'var(--ui-chart-1)' },
  results: { label: 'النتائج', color: 'var(--ui-chart-2)' },
} satisfies ChartConfig;
type Metric = keyof typeof config;

export function DayChart({ days, metric, height = 250 }: { days: Day[]; metric: Metric; height?: number }) {
  const id = `fill-${metric}`;
  return (
    // Time runs left to right like every chart, even on an Arabic page
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }} dir="ltr">
      <AreaChart data={days}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={`var(--color-${metric})`} stopOpacity={0.8} />
            <stop offset="95%" stopColor={`var(--color-${metric})`} stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={shortDay} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={v => shortDay(String(v))} indicator="dot" />} />
        <Area dataKey={metric} type="monotone" fill={`url(#${id})`} stroke={`var(--color-${metric})`} />
      </AreaChart>
    </ChartContainer>
  );
}

export function TrendChart({ data, from, to }: { data: Dash; from: string; to: string }) {
  const [metric, setMetric] = React.useState<Metric>('spend');
  const days = daily(data, from, to);
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>كل يوم</CardTitle>
        <CardDescription>{metric === 'spend' ? 'الصرف اليومي لكل المنصات' : 'الليدز والمحادثات كل يوم'}</CardDescription>
        <CardAction>
          <ToggleGroup type="single" variant="outline" value={metric} onValueChange={v => v && setMetric(v as Metric)} aria-label="الرقم">
            <ToggleGroupItem value="spend" className="px-4">الصرف</ToggleGroupItem>
            <ToggleGroupItem value="results" className="px-4">النتائج</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <DayChart days={days} metric={metric} />
      </CardContent>
    </Card>
  );
}
