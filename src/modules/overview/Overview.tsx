// نظرة عامة: كروت الأرقام، والرسم اليومي، وحصة المنصات، ووتيرة الشهر، والأقسام، وتكلفة الليد حسب اليوم، وجدول الإعلانات.
// البيانات من /api/overview/data (نفس /dash.json)، والحساب كله في numbers.ts.
import * as React from 'react';
import { Direction } from 'radix-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { lastDay } from './numbers';
import { PeriodFilter, type Period } from './PeriodFilter';
import { useDash } from './useDash';
import { T, pageLang } from './lang';
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

export default function Overview() {
  const { data, error } = useDash();
  const [period, setPeriod] = React.useState<Period | null>(null);

  if (error) return <p className="ui text-destructive">{error}</p>;
  if (!data) return <OverviewSkeleton />;
  const to = lastDay(data);
  if (!to) return <p className="ui text-muted-foreground">{T('ما فيه أرقام للحين.', 'No numbers yet.')}</p>;
  // Days are the data's own (Riyadh) days: today, the last full day (range.end) and the first day the data has
  const ctx = { today: data.range?.today || to, last: to, min: data.range?.start || to };
  const from = period?.from ?? to;
  const end = period?.to ?? to;

  return (
    // Radix menus, selects and the sheet open in their own layer: tell them the page direction (Arabic RTL, English LTR)
    <Direction.Provider dir={pageLang() === 'en' ? 'ltr' : 'rtl'}>
    {/* min-w-0: a wide table or chart scrolls inside its card instead of widening the page on a phone */}
    <div className="ui grid gap-4 [&>*]:min-w-0 [&>.grid>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{period ? T(`من ${longDay(from)} إلى ${longDay(end)}، مقارنة بنفس المدة اللي قبلها`, `${longDay(from)} to ${longDay(end)}, compared with the same length before`) : ''}</p>
        <PeriodFilter id="overview" def="30" ctx={ctx} onChange={setPeriod} />
      </div>
      {period && <>
      <SectionCards data={data} from={from} to={end} />
      <OutcomeCards data={data} from={from} to={end} />
      <React.Suspense fallback={<Skeleton className="h-[640px] rounded-xl" />}><TrendChart data={data} from={from} to={end} /></React.Suspense>
      <div className="grid gap-4 lg:grid-cols-2">
        <ShareCard data={data} from={from} to={end} />
        <PaceCard data={data} from={from} to={end} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <WinsCard data={data} from={from} to={end} />
        <DeptsCard data={data} from={from} to={end} />
      </div>
      <div className="grid gap-4">
        <HeatCard data={data} from={from} to={end} />
      </div>
      <WhenNear minHeight={1040}><AdsTable data={data} from={from} to={end} /></WhenNear>
      </>}
    </div>
    </Direction.Provider>
  );
}
