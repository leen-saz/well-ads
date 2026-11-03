// نظرة عامة: كروت الأرقام، والرسم اليومي، وحصة المنصات، ووتيرة الشهر، والأقسام، وتكلفة الليد حسب اليوم، وجدول الإعلانات.
// البيانات من /api/overview/data (نفس /dash.json)، والحساب كله في numbers.ts.
import * as React from 'react';
import { Direction } from 'radix-ui';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { type Dash, addDays, lastDay } from './numbers';
import { SectionCards } from './SectionCards';
import { TrendChart } from './TrendChart';
import { AdsTable } from './AdsTable';
import { DeptsCard, HeatCard, PaceCard, ShareCard, WinsCard } from './AnalyticsCards';
import { OutcomeCards } from './OutcomeCards';
import { longDay } from './format';

const RANGES = [['7', '7 أيام'], ['30', '30 يوم'], ['90', '90 يوم']] as const;
type Range = (typeof RANGES)[number][0];

export default function Overview() {
  const [data, setData] = React.useState<Dash | null>(null);
  const [error, setError] = React.useState('');
  const [range, setRange] = React.useState<Range>('30');

  React.useEffect(() => {
    let on = true;
    fetch('/api/overview/data', { credentials: 'same-origin' })
      .then(async r => (r.ok ? (r.json() as Promise<Dash>) : Promise.reject(new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || 'ما قدرت أجيب الأرقام. حاول مرة ثانية'))))
      .then(d => { if (on) setData(d); })
      .catch((e: Error) => { if (on) setError(e.message); });
    return () => { on = false; };
  }, []);

  if (error) return <p className="ui text-destructive">{error}</p>;
  if (!data) {
    return (
      <div className="ui grid gap-4" aria-busy="true">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }
  const to = lastDay(data);
  if (!to) return <p className="ui text-muted-foreground">ما فيه أرقام للحين.</p>;
  const from = addDays(to, -(Number(range) - 1));

  return (
    // Radix menus, selects and the sheet open in their own layer: tell them the page is Arabic
    <Direction.Provider dir="rtl">
    <div className="ui grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">من {longDay(from)} إلى {longDay(to)}، مقارنة بنفس المدة اللي قبلها</p>
        <ToggleGroup type="single" variant="outline" value={range} onValueChange={v => v && setRange(v as Range)} aria-label="الفترة">
          {RANGES.map(([v, t]) => <ToggleGroupItem key={v} value={v} className="px-4">{t}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <SectionCards data={data} from={from} to={to} />
      <OutcomeCards data={data} from={from} to={to} />
      <TrendChart data={data} from={from} to={to} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ShareCard data={data} from={from} to={to} />
        <PaceCard data={data} from={from} to={to} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <WinsCard data={data} from={from} to={to} />
        <DeptsCard data={data} from={from} to={to} />
      </div>
      <div className="grid gap-4">
        <HeatCard data={data} from={from} to={to} />
      </div>
      <AdsTable data={data} from={from} to={to} />
    </div>
    </Direction.Provider>
  );
}
