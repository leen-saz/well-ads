// نظرة عامة: كروت الأرقام، والرسم اليومي، وحصة المنصات، ووتيرة الشهر، والأقسام، وتكلفة الليد حسب اليوم، وجدول الإعلانات.
// البيانات من /api/overview/data (نفس /dash.json)، والحساب كله في numbers.ts.
import * as React from 'react';
import { Direction } from 'radix-ui';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { addDays, lastDay } from './numbers';
import { useDash } from './useDash';
import { SectionCards } from './SectionCards';
import { OverviewSkeleton } from './Skeletons';
import { DeptsCard, HeatCard, PaceCard, ShareCard, WinsCard } from './AnalyticsCards';
import { OutcomeCards } from './OutcomeCards';
import { longDay } from './format';

// The chart (Recharts) and the ads table (TanStack Table, menus, the sheet) are separate files: the numbers above them
// draw first. The chart starts loading at once; the table only when it is about to scroll into view.
const TrendChart = React.lazy(() => import('./TrendChart').then(m => ({ default: m.TrendChart })));
const AdsTable = React.lazy(() => import('./AdsTable').then(m => ({ default: m.AdsTable })));

// Renders its children once the placeholder comes within a screen of the viewport
function WhenNear({ minHeight, children }: { minHeight: number; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [near, setNear] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setNear(true); }, { rootMargin: '100% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const box = <Skeleton className="rounded-xl" style={{ minHeight }} />;
  return near ? <React.Suspense fallback={box}>{children}</React.Suspense> : <div ref={ref}>{box}</div>;
}

const RANGES = [['7', '7 أيام'], ['30', '30 يوم'], ['90', '90 يوم']] as const;
type Range = (typeof RANGES)[number][0];

export default function Overview() {
  const { data, error } = useDash();
  const [range, setRange] = React.useState<Range>('30');

  if (error) return <p className="ui text-destructive">{error}</p>;
  if (!data) return <OverviewSkeleton />;
  const to = lastDay(data);
  if (!to) return <p className="ui text-muted-foreground">ما فيه أرقام للحين.</p>;
  const from = addDays(to, -(Number(range) - 1));

  return (
    // Radix menus, selects and the sheet open in their own layer: tell them the page is Arabic
    <Direction.Provider dir="rtl">
    {/* min-w-0: a wide table or chart scrolls inside its card instead of widening the page on a phone */}
    <div className="ui grid gap-4 [&>*]:min-w-0 [&>.grid>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">من {longDay(from)} إلى {longDay(to)}، مقارنة بنفس المدة اللي قبلها</p>
        <ToggleGroup type="single" variant="outline" value={range} onValueChange={v => v && setRange(v as Range)} aria-label="الفترة">
          {RANGES.map(([v, t]) => <ToggleGroupItem key={v} value={v} className="px-4">{t}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <SectionCards data={data} from={from} to={to} />
      <OutcomeCards data={data} from={from} to={to} />
      <React.Suspense fallback={<Skeleton className="h-[640px] rounded-xl" />}><TrendChart data={data} from={from} to={to} /></React.Suspense>
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
      <WhenNear minHeight={1040}><AdsTable data={data} from={from} to={to} /></WhenNear>
    </div>
    </Direction.Provider>
  );
}
