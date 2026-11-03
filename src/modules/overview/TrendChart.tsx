// الاتجاه: الصرف أو النتائج أو الليدز، يومي أو أسبوعي أو شهري (تلقائي حسب طول الفترة مثل التحليلات)، وتكلفة الليد لكل منصة
import * as React from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type Dash, type Day, platformName } from './numbers';
import { type Gran, buckets, granOf, order } from './analytics';
import { shortDay } from './format';

const config = {
  spend: { label: 'الصرف (ر.س)', color: 'var(--ui-chart-1)' },
  results: { label: 'النتائج', color: 'var(--ui-chart-2)' },
  leads: { label: 'الليدز', color: 'var(--ui-chart-2)' },
} satisfies ChartConfig;
type Metric = keyof typeof config;
const COLORS = ['#7E57FD', '#221196', '#ACA6E1', '#F86080', '#1D1069', '#B49CFE', '#5B4FB0'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const tickOf = (g: string) => (k: string) => (g === 'month' ? `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}` : shortDay(k));
const labelOf = (g: string) => (k: string) => (g === 'week' ? `أسبوع ${shortDay(k)}` : tickOf(g)(k));

export function DayChart({ days, metric, height = 250, gran = 'day' }: { days: (Day & { leads?: number })[]; metric: Metric; height?: number; gran?: string }) {
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
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={tickOf(gran)} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={v => labelOf(gran)(String(v))} indicator="dot" />} />
        <Area dataKey={metric} type="monotone" fill={`url(#${id})`} stroke={`var(--color-${metric})`} />
      </AreaChart>
    </ChartContainer>
  );
}

export function TrendChart({ data, from, to }: { data: Dash; from: string; to: string }) {
  const [metric, setMetric] = React.useState<Metric>('spend');
  const [gran, setGran] = React.useState<Gran>('auto');
  const g = granOf(from, to, gran);
  const all = buckets(data, from, to, gran);
  const plats = order(data).filter(p => all.some(b => b.cpl[p] != null));
  const cplRows = all.map(b => ({ day: b.day, ...Object.fromEntries(plats.map(p => [p, b.cpl[p] ?? null])) }));
  const cplConfig = Object.fromEntries(plats.map((p, i) => [p, { label: platformName(p), color: COLORS[i % COLORS.length]! }])) satisfies ChartConfig;
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>الاتجاه</CardTitle>
        <CardDescription>{metric === 'spend' ? 'الصرف لكل المنصات' : metric === 'results' ? 'الليدز والمحادثات' : 'الليدز بس'} · {g === 'day' ? 'يومي' : g === 'week' ? 'أسبوعي (من الأحد)' : 'شهري'}</CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          <ToggleGroup type="single" variant="outline" value={metric} onValueChange={v => v && setMetric(v as Metric)} aria-label="الرقم">
            <ToggleGroupItem value="spend" className="px-3">الصرف</ToggleGroupItem>
            <ToggleGroupItem value="results" className="px-3">النتائج</ToggleGroupItem>
            <ToggleGroupItem value="leads" className="px-3">الليدز</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" variant="outline" value={gran} onValueChange={v => v && setGran(v as Gran)} aria-label="التجميع">
            <ToggleGroupItem value="auto" className="px-3">تلقائي</ToggleGroupItem>
            <ToggleGroupItem value="day" className="px-3">يومي</ToggleGroupItem>
            <ToggleGroupItem value="week" className="px-3">أسبوعي</ToggleGroupItem>
            <ToggleGroupItem value="month" className="px-3">شهري</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6 px-2 pt-4 sm:px-6 sm:pt-6">
        <DayChart days={all} metric={metric} gran={g} />
        <div>
          <p className="mb-2 text-sm text-muted-foreground">تكلفة الليد حسب المنصة (ر.س، إعلانات الليدز)</p>
          {plats.length ? (
            <ChartContainer config={cplConfig} className="aspect-auto w-full" style={{ height: 200 }} dir="ltr">
              <LineChart data={cplRows}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={tickOf(g)} />
                <YAxis orientation="right" tickLine={false} axisLine={false} width={40} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={v => labelOf(g)(String(v))} indicator="dot" />} />
                {plats.map(p => <Line key={p} dataKey={p} type="monotone" stroke={`var(--color-${p})`} strokeWidth={2} dot={false} connectNulls={false} />)}
              </LineChart>
            </ChartContainer>) : <p className="text-sm text-muted-foreground">ما فيه ليدز في هالفترة.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
