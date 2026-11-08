// الاتجاه: الصرف أو النتائج أو الليدز، يومي أو أسبوعي أو شهري (تلقائي حسب طول الفترة مثل التحليلات)، مجموع أو أعمدة حسب المنصة، وتكلفة الليد لكل منصة
import * as React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type Dash, type Day, platformName } from './numbers';
import { type Bucket, type Gran, buckets, granOf, order } from './analytics';
import { shortDay } from './format';
import { T, pageLang } from './lang';

// The labels are read when the chart draws, so they follow the page language
const config = {
  spend: { get label() { return T('الصرف (ر.س)', 'Spend (SAR)'); }, color: 'var(--ui-chart-1)' },
  results: { get label() { return T('النتائج', 'Results'); }, color: 'var(--ui-chart-2)' },
  leads: { get label() { return T('الليدز', 'Leads'); }, color: 'var(--ui-chart-2)' },
} satisfies ChartConfig;
type Metric = keyof typeof config;
const COLORS = ['#7E57FD', '#221196', '#ACA6E1', '#F86080', '#1D1069', '#B49CFE', '#5B4FB0'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const tickOf = (g: string) => (k: string) => (g === 'month' ? `${(pageLang() === 'en' ? MONTHS_EN : MONTHS)[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}` : shortDay(k));
const labelOf = (g: string) => (k: string) => (g === 'week' ? T(`أسبوع ${shortDay(k)}`, `Week of ${shortDay(k)}`) : tickOf(g)(k));

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

// Each platform's part of every bar, stacked like the main dashboard's daily charts (template.html stacked())
function PlatBars({ all, plats, metric, gran, config: cfg }: { all: Bucket[]; plats: string[]; metric: Metric; gran: string; config: ChartConfig }) {
  const rows = all.map(b => ({ day: b.day, ...Object.fromEntries(plats.map(p => [p, b.plat[p]?.[metric] ?? 0])) }));
  return (
    <ChartContainer config={cfg} className="aspect-auto w-full" style={{ height: 250 }} dir="ltr">
      <BarChart data={rows}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={tickOf(gran)} />
        <YAxis orientation="right" tickLine={false} axisLine={false} width={48} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={v => labelOf(gran)(String(v))} indicator="dot" />} />
        <ChartLegend content={<ChartLegendContent />} />
        {plats.map((p, i) => <Bar key={p} dataKey={p} stackId="a" fill={`var(--color-${p})`} radius={i === plats.length - 1 ? [3, 3, 0, 0] : 0} />)}
      </BarChart>
    </ChartContainer>
  );
}

export function TrendChart({ data, from, to }: { data: Dash; from: string; to: string }) {
  const [metric, setMetric] = React.useState<Metric>('spend');
  const [gran, setGran] = React.useState<Gran>('auto');
  const [split, setSplit] = React.useState<'total' | 'plat'>('total');
  const g = granOf(from, to, gran);
  const all = buckets(data, from, to, gran);
  const plats = order(data).filter(p => all.some(b => b.cpl[p] != null));
  const cplRows = all.map(b => ({ day: b.day, ...Object.fromEntries(plats.map(p => [p, b.cpl[p] ?? null])) }));
  // One colour per platform, from its place in the dashboard order, so it is the same in both charts
  const platOrder = order(data), colorOf = (p: string) => COLORS[Math.max(0, platOrder.indexOf(p)) % COLORS.length]!;
  const cplConfig = Object.fromEntries(plats.map(p => [p, { label: platformName(p), color: colorOf(p) }])) satisfies ChartConfig;
  const shown = platOrder.filter(p => all.some(b => (b.plat[p]?.spend ?? 0) > 0 || (b.plat[p]?.results ?? 0) > 0));
  const platConfig = Object.fromEntries(shown.map(p => [p, { label: platformName(p), color: colorOf(p) }])) satisfies ChartConfig;
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{T('الاتجاه', 'Trend')}</CardTitle>
        <CardDescription>{metric === 'spend' ? T('الصرف لكل المنصات', 'Spend on all platforms') : metric === 'results' ? T('الليدز والمحادثات', 'Leads and conversations') : T('الليدز بس', 'Leads only')} · {g === 'day' ? T('يومي', 'Daily') : g === 'week' ? T('أسبوعي (من الأحد)', 'Weekly (from Sunday)') : T('شهري', 'Monthly')}</CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          <ToggleGroup type="single" variant="outline" value={metric} onValueChange={v => v && setMetric(v as Metric)} aria-label={T('الرقم', 'Metric')}>
            <ToggleGroupItem value="spend" className="px-3">{T('الصرف', 'Spend')}</ToggleGroupItem>
            <ToggleGroupItem value="results" className="px-3">{T('النتائج', 'Results')}</ToggleGroupItem>
            <ToggleGroupItem value="leads" className="px-3">{T('الليدز', 'Leads')}</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" variant="outline" value={split} onValueChange={v => v && setSplit(v as 'total' | 'plat')} aria-label={T('العرض', 'View')}>
            <ToggleGroupItem value="total" className="px-3">{T('المجموع', 'Total')}</ToggleGroupItem>
            <ToggleGroupItem value="plat" className="px-3">{T('حسب المنصة', 'By platform')}</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" variant="outline" value={gran} onValueChange={v => v && setGran(v as Gran)} aria-label={T('التجميع', 'Grouping')}>
            <ToggleGroupItem value="auto" className="px-3">{T('تلقائي', 'Auto')}</ToggleGroupItem>
            <ToggleGroupItem value="day" className="px-3">{T('يومي', 'Daily')}</ToggleGroupItem>
            <ToggleGroupItem value="week" className="px-3">{T('أسبوعي', 'Weekly')}</ToggleGroupItem>
            <ToggleGroupItem value="month" className="px-3">{T('شهري', 'Monthly')}</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6 px-2 pt-4 sm:px-6 sm:pt-6">
        {split === 'plat' && shown.length
          ? <PlatBars all={all} plats={shown} metric={metric} gran={g} config={platConfig} />
          : <DayChart days={all} metric={metric} gran={g} />}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">{T('تكلفة الليد حسب المنصة (ر.س، إعلانات الليدز)', 'Cost per lead by platform (SAR, lead ads)')}</p>
          {plats.length ? (
            <ChartContainer config={cplConfig} className="aspect-auto w-full" style={{ height: 200 }} dir="ltr">
              <LineChart data={cplRows}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={tickOf(g)} />
                <YAxis orientation="right" tickLine={false} axisLine={false} width={40} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={v => labelOf(g)(String(v))} indicator="dot" />} />
                {plats.map(p => <Line key={p} dataKey={p} type="monotone" stroke={`var(--color-${p})`} strokeWidth={2} dot={false} connectNulls={false} />)}
              </LineChart>
            </ChartContainer>) : <p className="text-sm text-muted-foreground">{T('ما فيه ليدز في هالفترة.', 'No leads in this period.')}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
