// النتيجة ورحلة العميل: الإقفالات والمدفوع والعائد وتكلفة العميل من نظام العملاء، وبعدها مراحل الرحلة بنسبة كل انتقال. الحساب في analytics.ts.
import * as React from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type Dash, canCompare, change, previous } from './numbers';
import { type CrmBy, type Outcome, outcome } from './analytics';
import { qty, sar } from './format';

interface Props { data: Dash; from: string; to: string }
const p2 = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`);
const x2 = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}×`);

// The change against the same length before; lowerIsBetter colours a drop in cost as good news, null = neither
function Delta({ now, was, lowerIsBetter }: { now: number | null; was: number | null; lowerIsBetter: boolean | null }) {
  const d = change(now, was);
  if (d == null) return null;
  const good = lowerIsBetter == null ? null : lowerIsBetter ? d < 0 : d > 0;
  return <span dir="ltr" className={`text-xs tabular-nums ${good == null ? 'text-muted-foreground' : good ? 'text-primary' : 'text-destructive'}`}>{d > 0 ? '+' : ''}{d.toFixed(1)}%</span>;
}

function Stat({ label, value, now, was, lowerIsBetter, big }: { label: string; value: string; now: number | null; was: number | null; lowerIsBetter: boolean | null; big?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`${big ? 'text-2xl' : 'text-lg'} font-semibold tabular-nums`}>{value}</span>
      <Delta now={now} was={was} lowerIsBetter={lowerIsBetter} />
    </div>
  );
}

export function OutcomeCards({ data, from, to }: Props) {
  const [by, setBy] = React.useState<CrmBy>('lead');
  const a = outcome(data, from, to, by);
  const [pf, pt] = previous(from, to);
  // Same rule as the main dashboard: no comparison when the earlier period is incomplete
  const b: Partial<Outcome> = canCompare(data, from, to) ? outcome(data, pf, pt, by) : {};
  const v = (k: keyof Outcome) => (b[k] as number | null | undefined) ?? null;
  const stages = [
    { n: 'الوعي', hint: 'كم شخص شاف الإعلان', main: ['الظهور', qty(a.impr), a.impr, v('impr'), false], sub: [['تكلفة الألف ظهور', sar(a.cpm), a.cpm, v('cpm'), true]] },
    { n: 'الاهتمام', hint: 'كم واحد ضغط', rate: ['نسبة النقر', p2(a.ctr), a.ctr, v('ctr')], main: ['نقرات الرابط والسوايب', qty(a.clicks), a.clicks, v('clicks'), false], sub: [['تكلفة النقرة', sar(a.cpc), a.cpc, v('cpc'), true]] },
    { n: 'التحويل', hint: 'كم واحد ترك بياناته أو راسلنا', rate: ['من نقرة إلى ليد أو محادثة', p2(a.clickToResult), a.clickToResult, v('clickToResult')], main: ['الليدز', qty(a.leads), a.leads, v('leads'), false],
      sub: [['تكلفة الليد', sar(a.cpl), a.cpl, v('cpl'), true], ['محادثات واتساب وماسنجر', qty(a.conv), a.conv, v('conv'), false]] },
    ...(a.crm ? [{ n: 'البيع', hint: 'كم واحد دفع', rate: ['من ليد إلى إقفالة', p2(a.closeRate), a.closeRate, v('closeRate')], main: ['إقفالات مدفوعة', qty(a.closings), a.closings, v('closings'), false],
      sub: [['إقفالات من الإعلانات', qty(a.booked), a.booked, v('booked'), false], ['العائد من الإعلانات', x2(a.roas), a.roas, v('roas'), false]] }] : []),
  ] as { n: string; hint: string; rate?: [string, string, number | null, number | null]; main: [string, string, number, number | null, boolean]; sub: [string, string, number | null, number | null, boolean][] }[];

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>النتيجة</CardTitle>
          <CardDescription>{a.crm ? 'الإقفالات والمدفوع من كل المصادر في نظام العملاء. العائد على الصرف = المدفوع ÷ الصرف. تكلفة العميل = الصرف ÷ الإقفالات.' : 'نظام العملاء مو مربوط، فما فيه إقفالات.'}</CardDescription>
          {a.crm && (
            <CardAction>
              <ToggleGroup type="single" variant="outline" value={by} onValueChange={x => x && setBy(x as CrmBy)} aria-label="الإقفالات حسب">
                <ToggleGroupItem value="lead" className="px-3">يوم الليد</ToggleGroupItem>
                <ToggleGroupItem value="paid" className="px-3">يوم الدفع</ToggleGroupItem>
              </ToggleGroup>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <Stat big label="الصرف" value={sar(a.spend)} now={a.spend} was={v('spend')} lowerIsBetter={null} />
          {a.crm && <>
            <Stat big label="الإقفالات" value={qty(a.closings)} now={a.closings} was={v('closings')} lowerIsBetter={false} />
            <Stat big label="المدفوع" value={sar(a.paid)} now={a.paid} was={v('paid')} lowerIsBetter={false} />
            <Stat big label="العائد على الصرف" value={x2(a.mer)} now={a.mer} was={v('mer')} lowerIsBetter={false} />
            <Stat big label="تكلفة العميل" value={sar(a.cac)} now={a.cac} was={v('cac')} lowerIsBetter />
          </>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>رحلة العميل</CardTitle><CardDescription>كل مرحلة بعددها وتكلفتها، والنسبة اللي تنقل الناس للمرحلة اللي بعدها.</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          {stages.map((s, i) => (
            <React.Fragment key={s.n}>
              {s.rate && <p className="text-sm text-muted-foreground">↓ {s.rate[0]}: <b className="tabular-nums text-foreground">{s.rate[1]}</b> <Delta now={s.rate[2]} was={s.rate[3]} lowerIsBetter={false} /></p>}
              <div className="grid items-center gap-3 rounded-lg border p-3 sm:grid-cols-[10rem_1fr_minmax(12rem,auto)]" style={{ marginInline: `${i * 4}%` }}>
                <div><b>{i + 1}. {s.n}</b><div className="text-xs text-muted-foreground">{s.hint}</div></div>
                <Stat big label={s.main[0]} value={s.main[1]} now={s.main[2]} was={s.main[3]} lowerIsBetter={s.main[4]} />
                <div className="grid gap-2">{s.sub.map(x => <Stat key={x[0]} label={x[0]} value={x[1]} now={x[2]} was={x[3]} lowerIsBetter={x[4]} />)}</div>
              </div>
            </React.Fragment>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
