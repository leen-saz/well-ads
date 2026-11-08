// باقي صفحة التحليلات: حصة كل منصة، وتيرة الشهر وتوقعه، تكلفة الليد حسب يوم الأسبوع، والأقسام. الحساب في analytics.ts.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Dash, platformName } from './numbers';
import { depts, heat, pace, share, wins } from './analytics';
import { canCompare } from './numbers';
import { qty, sar } from './format';
import { T, pageLang } from './lang';

interface Props { data: Dash; from: string; to: string }
// Well's colours, one per platform in the dashboard's order
const COLORS = ['#7E57FD', '#221196', '#ACA6E1', '#F86080', '#1D1069', 'color-mix(in srgb, #7E57FD 55%, #FFFFFF)', 'color-mix(in srgb, #221196 55%, #FFFFFF)'];
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'], DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Weekday and month names in the page language
const days = () => (pageLang() === 'en' ? DAYS_EN : DAYS_AR);
const month = (ym: string) => (pageLang() === 'en' ? MONTHS_EN : MONTHS_AR)[Number(ym.slice(5)) - 1] ?? ym;
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
      <CardHeader><CardTitle>{T('حصة كل منصة من الصرف ومن النتايج', 'Each platform’s share of spend and results')}</CardTitle>
        <CardDescription>{T('لما تكون حصة النتايج أكبر من حصة الصرف، المنصة تجيب أكثر من نصيبها.', 'When a platform’s share of results is bigger than its share of spend, it brings more than its share.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {list.length ? (<>
          <div className="grid grid-cols-[4rem_1fr] items-center gap-2 text-sm"><span>{T('الصرف', 'Spend')}</span>{bar('spendShare')}<span>{T('النتايج', 'Results')}</span>{bar('resultShare')}</div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {list.map((s, i) => (
              <li key={s.platform} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                {platformName(s.platform)}: {T(`${p0(s.spendShare)} صرف · ${p0(s.resultShare)} نتايج`, `${p0(s.spendShare)} spend · ${p0(s.resultShare)} results`)}
              </li>))}
          </ul></>) : <p className="text-sm text-muted-foreground">{T('ما فيه بيانات.', 'No data.')}</p>}
      </CardContent>
    </Card>
  );
}

export function PaceCard({ data, from, to }: Props) {
  const p = pace(data, from, to);
  const wait = p.waitDays ? T('يطلع بعد 3 أيام', 'Shows after 3 days') : '—';
  const items: [string, string, (string | undefined)?][] = [
    [p.partialToday ? T('صرف اليوم الجزئي', 'Spend today (partial)') : T(`صرف ${month(p.month)} حتى الآن (${p.done} من ${p.days} يوم)`, `${month(p.month)} spend so far (${p.done} of ${p.days} days)`), sar(p.spend)],
    [T('نتايج حتى الآن', 'Results so far'), p.results == null ? '—' : qty(p.results)],
    [T('توقع الصرف لنهاية الشهر', 'Spend forecast for the month'), p.forecast ? sar(p.forecast.spend) : wait],
    [T('توقع النتايج لنهاية الشهر', 'Results forecast for the month'), p.forecast ? qty(p.forecast.results) : wait],
    [T(`مقارنة بنفس الأيام من ${month(p.prevMonth)}`, `Against the same days of ${month(p.prevMonth)}`), p.vs ? T(`صرف ${ch(p.vs.spend)} · نتايج ${ch(p.vs.results)}`, `spend ${ch(p.vs.spend)} · results ${ch(p.vs.results)}`) : '—'],
    [p.prev?.full ? T(`${month(p.prevMonth)} كامل`, `All of ${month(p.prevMonth)}`) : T(`نفس الأيام من ${month(p.prevMonth)}`, `The same days of ${month(p.prevMonth)}`), p.prev ? T(`${qty(p.prev.results)} نتيجة`, `${qty(p.prev.results)} results`) : '—',
      p.prev ? T(`${sar(p.prev.spend)} · تكلفة النتيجة ${p.prev.results ? sar(p.prev.spend / p.prev.results) : '—'}`, `${sar(p.prev.spend)} · cost per result ${p.prev.results ? sar(p.prev.spend / p.prev.results) : '—'}`) : undefined],
  ];
  return (
    <Card>
      <CardHeader><CardTitle>{T('وتيرة الشهر الحالي وتوقع نهايته', 'This month’s pace and its forecast')}</CardTitle>
        <CardDescription>{T('التوقع = المعدل اليومي لهالشهر × عدد أيامه، وما يحسب اليوم الحالي لأنه ناقص.', 'Forecast = this month’s daily average × its days; today is left out because it is incomplete.')}</CardDescription></CardHeader>
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
      <CardHeader><CardTitle>{T('تكلفة الليد حسب يوم الأسبوع', 'Cost per lead by weekday')}</CardTitle><CardDescription>{T('إعلانات الليدز بس. الأغمق = الأغلى.', 'Lead ads only. Darker = more expensive.')}</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto">
        {h.rows.length ? (
          <table className="w-full border-separate border-spacing-1 text-sm">
            <thead><tr><th />{days().map(d => <th key={d} className="px-2 font-medium text-muted-foreground">{d}</th>)}</tr></thead>
            <tbody>{h.rows.map(r => (
              <tr key={r.platform}><th className="whitespace-nowrap pe-2 text-start font-medium">{platformName(r.platform)}</th>
                {r.cpl.map((v, i) => <td key={i} className="rounded-md px-2 py-1.5 text-center tabular-nums" style={shade(v)} title={`${platformName(r.platform)} · ${days()[i]}: ${sar(v)}`}>{v == null ? '—' : Math.round(v)}</td>)}
              </tr>))}</tbody>
          </table>) : <p className="text-sm text-muted-foreground">{T('ما فيه ليدز في هالفترة.', 'No leads in this period.')}</p>}
      </CardContent>
    </Card>
  );
}

export function DeptsCard({ data, from, to }: Props) {
  const list = depts(data, from, to);
  const ms = Math.max(1, ...list.map(x => x.spend)), ml = Math.max(1, ...list.map(x => x.leads));
  return (
    <Card>
      <CardHeader><CardTitle>{T('الأقسام', 'Departments')}</CardTitle><CardDescription>{T('الصرف والليدز وتكلفة الليد لكل قسم. اضغط على القسم لفتح صفحته في التحليلات.', 'Spend, leads and cost per lead for each department. Click one to open its page in the analytics.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {list.length ? list.map((x, i) => (
          <a key={x.key} href={`/dept/${x.key}/`} data-astro-reload className="grid grid-cols-[minmax(8rem,auto)_1fr] items-center gap-3 rounded-md p-1 hover:bg-muted">
            <span className="text-sm font-medium">{x.name}</span>
            <div className="grid gap-1">
              <div className="h-2.5 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(100 * x.spend) / ms}%`, background: COLORS[i % COLORS.length] }} /></div>
              <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-foreground" style={{ width: `${(100 * x.leads) / ml}%` }} /></div>
              <span className="text-sm tabular-nums text-muted-foreground">{T(`${sar(x.spend)} · ${qty(x.leads)} ليد · تكلفة الليد ${sar(x.cpl)}`, `${sar(x.spend)} · ${qty(x.leads)} leads · cost per lead ${sar(x.cpl)}`)}</span>
            </div>
          </a>)) : <p className="text-sm text-muted-foreground">{T('ما فيه أقسام.', 'No departments.')}</p>}
      </CardContent>
    </Card>
  );
}

export function WinsCard({ data, from, to }: Props) {
  const ok = canCompare(data, from, to);
  const list = wins(data, from, to, ok);
  const n = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  return (
    <Card>
      <CardHeader><CardTitle>{n === 7 ? T('نجاحات هالأسبوع', 'This week’s wins') : T('نجاحات الفترة', 'Wins in this period')}</CardTitle>
        <CardDescription>{ok ? T('مقارنة بنفس المدة اللي قبلها.', 'Compared with the same length before.') : T('ما فيه فترة سابقة كاملة للمقارنة، فاللي يطلع هنا من الفترة نفسها بس.', 'No complete earlier period to compare, so these come from this period alone.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {list.length ? list.map(w => (
          <div key={w.title} className="flex items-start gap-3"><span aria-hidden="true" className="text-xl leading-none">{w.icon}</span>
            <div><b>{w.title}</b><div className="text-sm text-muted-foreground">{w.name && <><bdi data-user-text>{w.name}</bdi> · </>}{w.detail}</div></div></div>))
          : <p className="text-sm text-muted-foreground">{T('ما فيه تحسّن واضح في هالفترة مقارنة باللي قبلها.', 'No clear improvement in this period compared with the one before.')}</p>}
      </CardContent>
    </Card>
  );
}
