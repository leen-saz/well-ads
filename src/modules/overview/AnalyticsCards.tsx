// باقي صفحة التحليلات: حصة كل منصة، وتيرة الشهر وتوقعه، تكلفة الليد حسب يوم الأسبوع، والأقسام. الحساب في analytics.ts.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Dash, platformName } from './numbers';
import { depts, heat, pace, share, wins } from './analytics';
import { canCompare } from './numbers';
import { qty, sar } from './format';

interface Props { data: Dash; from: string; to: string }
// Well's colours, one per platform in the dashboard's order
const COLORS = ['#7E57FD', '#221196', '#ACA6E1', '#F86080', '#1D1069', 'color-mix(in srgb, #7E57FD 55%, #FFFFFF)', 'color-mix(in srgb, #221196 55%, #FFFFFF)'];
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const month = (ym: string) => MONTHS[Number(ym.slice(5)) - 1] ?? ym;
const p0 = (v: number) => `${Math.round(v)}%`;
const ch = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(v))}%`);

export function ShareCard({ data, from, to }: Props) {
  const list = share(data, from, to);
  const bar = (k: 'spendShare' | 'resultShare') => (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
      {list.map((s, i) => s[k] > 0 && <span key={s.platform} style={{ width: `${s[k]}%`, background: COLORS[i % COLORS.length] }} title={`${platformName(s.platform)}: ${p0(s[k])}`} />)}
    </div>
  );
  return (
    <Card>
      <CardHeader><CardTitle>حصة كل منصة من الصرف ومن النتايج</CardTitle>
        <CardDescription>لما تكون حصة النتايج أكبر من حصة الصرف، المنصة تجيب أكثر من نصيبها.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {list.length ? (<>
          <div className="grid grid-cols-[4rem_1fr] items-center gap-2 text-sm"><span>الصرف</span>{bar('spendShare')}<span>النتايج</span>{bar('resultShare')}</div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {list.map((s, i) => (
              <li key={s.platform} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                {platformName(s.platform)}: {p0(s.spendShare)} صرف · {p0(s.resultShare)} نتايج
              </li>))}
          </ul></>) : <p className="text-sm text-muted-foreground">ما فيه بيانات.</p>}
      </CardContent>
    </Card>
  );
}

export function PaceCard({ data, from, to }: Props) {
  const p = pace(data, from, to);
  const wait = p.waitDays ? 'يطلع بعد 3 أيام' : '—';
  const items: [string, string, (string | undefined)?][] = [
    [p.partialToday ? 'صرف اليوم الجزئي' : `صرف ${month(p.month)} حتى الآن (${p.done} من ${p.days} يوم)`, sar(p.spend)],
    ['نتايج حتى الآن', p.results == null ? '—' : qty(p.results)],
    ['توقع الصرف لنهاية الشهر', p.forecast ? sar(p.forecast.spend) : wait],
    ['توقع النتايج لنهاية الشهر', p.forecast ? qty(p.forecast.results) : wait],
    [`مقارنة بنفس الأيام من ${month(p.prevMonth)}`, p.vs ? `صرف ${ch(p.vs.spend)} · نتايج ${ch(p.vs.results)}` : '—'],
    [p.prev?.full ? `${month(p.prevMonth)} كامل` : `نفس الأيام من ${month(p.prevMonth)}`, p.prev ? `${qty(p.prev.results)} نتيجة` : '—',
      p.prev ? `${sar(p.prev.spend)} · تكلفة النتيجة ${p.prev.results ? sar(p.prev.spend / p.prev.results) : '—'}` : undefined],
  ];
  return (
    <Card>
      <CardHeader><CardTitle>وتيرة الشهر الحالي وتوقع نهايته</CardTitle>
        <CardDescription>التوقع = المعدل اليومي لهالشهر × عدد أيامه، وما يحسب اليوم الحالي لأنه ناقص.</CardDescription></CardHeader>
      <CardContent><dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map(([k, v, sub]) => (
          <div key={k}><dt className="text-sm text-muted-foreground">{k}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd>{sub && <dd className="text-sm text-muted-foreground">{sub}</dd>}</div>))}
      </dl></CardContent>
    </Card>
  );
}

export function HeatCard({ data, from, to }: Props) {
  const h = heat(data, from, to);
  const shade = (v: number | null) => {
    if (v == null) return {};
    const a = h.hi > h.lo ? (v - h.lo) / (h.hi - h.lo) : 0.5;
    return { background: `color-mix(in srgb, #7E57FD ${Math.round(10 + a * 70)}%, #FFFFFF)`, color: a > 0.55 ? '#FFFFFF' : undefined };
  };
  return (
    <Card>
      <CardHeader><CardTitle>تكلفة الليد حسب يوم الأسبوع</CardTitle><CardDescription>إعلانات الليدز بس. الأغمق = الأغلى.</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto">
        {h.rows.length ? (
          <table className="w-full border-separate border-spacing-1 text-sm">
            <thead><tr><th />{DAYS.map(d => <th key={d} className="px-2 font-medium text-muted-foreground">{d}</th>)}</tr></thead>
            <tbody>{h.rows.map(r => (
              <tr key={r.platform}><th className="whitespace-nowrap pe-2 text-start font-medium">{platformName(r.platform)}</th>
                {r.cpl.map((v, i) => <td key={i} className="rounded-md px-2 py-1.5 text-center tabular-nums" style={shade(v)} title={`${platformName(r.platform)} · ${DAYS[i]}: ${sar(v)}`}>{v == null ? '—' : Math.round(v)}</td>)}
              </tr>))}</tbody>
          </table>) : <p className="text-sm text-muted-foreground">ما فيه ليدز في هالفترة.</p>}
      </CardContent>
    </Card>
  );
}

export function DeptsCard({ data, from, to }: Props) {
  const list = depts(data, from, to);
  const ms = Math.max(1, ...list.map(x => x.spend)), ml = Math.max(1, ...list.map(x => x.leads));
  return (
    <Card>
      <CardHeader><CardTitle>الأقسام</CardTitle><CardDescription>الصرف والليدز وتكلفة الليد لكل قسم. اضغط على القسم لفتح صفحته في التحليلات.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {list.length ? list.map((x, i) => (
          <a key={x.key} href={`/dept/${x.key}/`} data-astro-reload className="grid grid-cols-[minmax(8rem,auto)_1fr] items-center gap-3 rounded-md p-1 hover:bg-muted">
            <span className="text-sm font-medium">{x.name}</span>
            <div className="grid gap-1">
              <div className="h-2.5 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(100 * x.spend) / ms}%`, background: COLORS[i % COLORS.length] }} /></div>
              <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-foreground" style={{ width: `${(100 * x.leads) / ml}%` }} /></div>
              <span className="text-sm tabular-nums text-muted-foreground">{sar(x.spend)} · {qty(x.leads)} ليد · تكلفة الليد {sar(x.cpl)}</span>
            </div>
          </a>)) : <p className="text-sm text-muted-foreground">ما فيه أقسام.</p>}
      </CardContent>
    </Card>
  );
}

export function WinsCard({ data, from, to }: Props) {
  const ok = canCompare(data, from, to);
  const list = wins(data, from, to, ok);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  return (
    <Card>
      <CardHeader><CardTitle>{days === 7 ? 'نجاحات هالأسبوع' : 'نجاحات الفترة'}</CardTitle>
        <CardDescription>{ok ? 'مقارنة بنفس المدة اللي قبلها.' : 'ما فيه فترة سابقة كاملة للمقارنة، فاللي يطلع هنا من الفترة نفسها بس.'}</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {list.length ? list.map(w => (
          <div key={w.title} className="flex items-start gap-3"><span aria-hidden="true" className="text-xl leading-none">{w.icon}</span>
            <div><b>{w.title}</b><div className="text-sm text-muted-foreground">{w.detail}</div></div></div>))
          : <p className="text-sm text-muted-foreground">ما فيه تحسّن واضح في هالفترة مقارنة باللي قبلها.</p>}
      </CardContent>
    </Card>
  );
}
