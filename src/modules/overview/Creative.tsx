// المواد الإعلانية بالتفصيل (تاب تحت الأداء): كل فكرة بمعاينتها ونصها وأرقامها، وفلاتر المنصة والقسم والهدف والصيغة والفترة.
// الضغط على فكرة يفتح لوحة فيها نسخها جنب بعض والإعلانات المربوطة فيها. الحساب كله في creatives.ts.
import * as React from 'react';
import { Direction } from 'radix-ui';
import { ExternalLink, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type Dash, DEP_AR, DEP_EN, goalName as goalOf, countsAsLead, isWhatsappDest, lastDay, platformName } from './numbers';
import { ALL, type CreativeAd, type Dir, type Filters, type Idea, type Metrics, type Sort, best, cplDiffers, ideas, media, options, sortIdeas } from './creatives';
import { useDash } from './useDash';
import { PeriodFilter, type Period } from './PeriodFilter';
import { CreativeSkeleton } from './Skeletons';
import { longDay, pct, qty, sar } from './format';
import { T, pageLang } from './lang';

const SORTS: [Sort, string, string][] = [['spend', 'الأعلى صرف', 'Highest spend'], ['results', 'الأكثر نتائج', 'Most results'], ['cpl', 'الأرخص تكلفة ليد', 'Cheapest cost per lead'], ['ctr', 'الأعلى نسبة نقر', 'Highest click rate'], ['hook', 'الأعلى وقفوا يشوفون', 'Most stopped to watch']];
const PAGE = 24;

const goalName = (g: string) => goalOf(g, 'غيرها');
function deptName(d: Dash, k: string): string {
  const names = (d as { departments?: { departments?: Record<string, { ar?: string }> } }).departments?.departments ?? {};
  if (pageLang() === 'en') return DEP_EN[k] ?? k;
  return names[k]?.ar || DEP_AR[k] || k;
}
// The format filter's values stay as the data has them; only their names change with the language
const FORMAT_EN: Record<string, string> = { 'فيديو': 'Video', 'صورة': 'Image', 'كاروسيل': 'Carousel', 'غير محدد': 'Not set' };
const formatName = (v: string) => (pageLang() === 'en' ? FORMAT_EN[v] ?? v : v);

export default function Creative() {
  const { data, error } = useDash();
  const [period, setPeriod] = React.useState<Period | null>(null);
  const [f, setF] = React.useState<Filters>(ALL);
  const [sort, setSort] = React.useState<Sort>('spend');
  const [shown, setShown] = React.useState(PAGE);
  const [open, setOpen] = React.useState<Idea | null>(null);

  // The shared period bar; days are the data's own (Riyadh) days: today, the last full day and the first day with data
  const last = data ? lastDay(data) : null;
  const ctx = last ? { today: data?.range?.today || last, last, min: data?.range?.start || last } : null;
  const to = last && period ? period.to : null;
  const from = !last || !period ? '' : period.from;
  const list = React.useMemo(() => (data && to ? sortIdeas(ideas(data, from, to, f), sort) : []), [data, from, to, f, sort]);
  const opts = React.useMemo(() => (data ? options(data) : null), [data]);
  React.useEffect(() => setShown(PAGE), [from, f, sort]);

  if (error) return <p className="ui text-destructive">{error}</p>;
  if (!data || !opts) return <CreativeSkeleton />;
  if (!last) return <p className="ui text-muted-foreground">{T('ما فيه أرقام للحين.', 'No numbers yet.')}</p>;
  const set = (k: keyof Filters) => (v: string) => setF(o => ({ ...o, [k]: v }));
  const pick = (k: keyof Filters, label: string, all: string, values: string[], name: (v: string) => string) => (
    <Select value={f[k]} onValueChange={set(k)}>
      <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{all}</SelectItem>
        {values.map(v => <SelectItem key={v} value={v}>{name(v)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  const ads = list.reduce((n, x) => n + x.ads.length, 0);

  return (
    <Direction.Provider dir={pageLang() === 'en' ? 'ltr' : 'rtl'}>
    <div className="ui grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{to ? T(`من ${longDay(from)} إلى ${longDay(to)}`, `${longDay(from)} to ${longDay(to)}`) : ''}</p>
        {ctx && <PeriodFilter id="creative" def="30" ctx={ctx} onChange={setPeriod} />}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Input value={f.q} onChange={e => set('q')(e.target.value)} placeholder={T('ابحث بالاسم أو الحملة أو النص', 'Search by name, campaign or text')} className="col-span-2 h-9 sm:max-w-72" aria-label={T('بحث', 'Search')} />
        {pick('platform', T('المنصة', 'Platform'), T('كل المنصات', 'All platforms'), opts.platforms, platformName)}
        {pick('dept', T('القسم', 'Department'), T('كل الأقسام', 'All departments'), opts.depts, k => deptName(data, k))}
        {pick('goal', T('الهدف', 'Goal'), T('كل الأهداف', 'All goals'), opts.goals, goalName)}
        {pick('format', T('الصيغة', 'Format'), T('كل الصيغ', 'All formats'), opts.formats, formatName)}
        <Select value={sort} onValueChange={v => setSort(v as Sort)}>
          <SelectTrigger size="sm" className="col-span-2 w-full sm:ms-auto sm:w-48" aria-label={T('الترتيب', 'Sort')}><SelectValue /></SelectTrigger>
          <SelectContent>{SORTS.map(([v, ar, en]) => <SelectItem key={v} value={v}>{T(ar, en)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <p className="text-sm text-muted-foreground">
        {T(`${qty(list.length)} فكرة في ${qty(ads)} إعلان. الفكرة الوحدة = نفس المادة الإعلانية في أكثر من مجموعة أو منصة أو نسخة. اضغط على أي فكرة تشوف نسخها جنب بعض.`,
          `${qty(list.length)} ideas in ${qty(ads)} ads. One idea = the same creative in more than one ad set, platform or version. Click any idea to see its versions side by side.`)}
      </p>
      {!to ? null : list.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.slice(0, shown).map(x => <IdeaCard key={x.key} idea={x} onOpen={() => setOpen(x)} />)}
        </div>
      ) : (
        <Card><CardContent className="py-10 text-center text-muted-foreground">{T('ما فيه مادة إعلانية تطابق الفلاتر في هالفترة. جرّب تغيّر الفلتر أو تكبّر الفترة.', 'No creative matches the filters in this period. Try another filter or a longer period.')}</CardContent></Card>
      )}
      {list.length > shown && (
        <Button variant="outline" className="justify-self-center" onClick={() => setShown(n => n + PAGE)}>{T(`اعرض أكثر (${qty(list.length - shown)} باقي)`, `Show more (${qty(list.length - shown)} left)`)}</Button>
      )}
      <Sheet open={!!open} onOpenChange={v => !v && setOpen(null)}>
        <SheetContent side={pageLang() === 'en' ? 'right' : 'left'} className="ui w-full gap-0 sm:max-w-3xl" dir={pageLang() === 'en' ? 'ltr' : 'rtl'}>
          {open && <IdeaDetail data={data} idea={open} />}
        </SheetContent>
      </Sheet>
    </div>
    </Direction.Provider>
  );
}

function Preview({ ad, play = false, className = '' }: { ad: CreativeAd; play?: boolean; className?: string }) {
  const m = media(ad);
  if (play && m.video) return <video controls playsInline poster={m.img || undefined} src={m.video} className={`w-full rounded-lg bg-black ${className}`} />;
  return (
    <div className={`relative overflow-hidden rounded-lg bg-muted ${className}`}>
      {m.img
        ? <img src={m.img} alt={ad.text || ad.name} loading="lazy" className="size-full object-cover" />
        : <div className="flex size-full items-center justify-center p-4 text-center text-xs text-muted-foreground">{T('ما فيه معاينة لهالإعلان', 'No preview for this ad')}</div>}
      {m.video && <span className="absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-black/55 text-white" aria-hidden="true"><Play className="size-4" /></span>}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="min-w-0 rounded-lg border p-2">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="truncate font-semibold tabular-nums">{value}</div>
      {note && <div className="truncate text-[11px] text-muted-foreground" title={note}>{note}</div>}
    </div>
  );
}

const cplNote = (m: Metrics) => (cplDiffers(m) ? T(`${sar(m.leadSpend)} ÷ ${qty(m.leadN)} ليد`, `${sar(m.leadSpend)} ÷ ${qty(m.leadN)} leads`) : undefined);
const hookValue = (m: Metrics) => (m.hook == null ? T('صورة أو بدون بيانات', 'Image or no data') : pct(m.hook));

function IdeaCard({ idea, onOpen }: { idea: Idea; onOpen: () => void }) {
  return (
    <Card role="button" tabIndex={0} aria-label={T(`تفاصيل ${idea.name}`, `Details of ${idea.name}`)} onClick={onOpen} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      className="cursor-pointer gap-3 py-4 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <div className="px-4"><Preview ad={idea.ad} className="aspect-[4/3]" /></div>
      <div className="grid gap-2 px-4">
        <div className="flex flex-wrap gap-1">
          {idea.platforms.map(p => <Badge key={p} variant="secondary">{platformName(p)}</Badge>)}
          <Badge variant="outline">{qty(idea.versions.length)} {idea.versions.length === 1 ? T('نسخة', 'version') : T('نسخ', 'versions')}</Badge>
          <Badge variant={idea.live ? 'default' : 'outline'}>{idea.live ? T('شغّال', 'Running') : T('متوقف', 'Paused')}</Badge>
        </div>
        <div className="line-clamp-2 font-medium leading-snug" title={idea.name}>{idea.name}</div>
        {idea.ad.text && <p className="line-clamp-2 text-sm text-muted-foreground">{idea.ad.text}</p>}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Stat label={T('الصرف', 'Spend')} value={sar(idea.spend)} />
          <Stat label={T('النتائج', 'Results')} value={qty(idea.results)} note={idea.conv ? T(`${qty(idea.leads)} ليد · ${qty(idea.conv)} محادثة`, `${qty(idea.leads)} leads · ${qty(idea.conv)} conversations`) : undefined} />
          <Stat label={T('تكلفة الليد', 'Cost per lead')} value={sar(idea.cpl)} note={cplNote(idea)} />
          <Stat label={T('نسبة النقر', 'Click rate')} value={pct(idea.ctr)} />
          <Stat label={T('وقفوا يشوفون', 'Stopped to watch')} value={idea.hook == null ? '—' : pct(idea.hook)} />
          <Stat label={T('الظهور', 'Impressions')} value={qty(idea.impr)} />
        </div>
      </div>
    </Card>
  );
}

// Rows of the side-by-side comparison: [label, value, direction (1 higher is better, -1 lower is better, 0 neither), shown as]
// The label is [Arabic, English]
const ROWS: [[string, string], (m: Metrics) => number | null, Dir, (v: number | null) => string][] = [
  [['الصرف', 'Spend'], m => m.spend, 0, sar],
  [['النتائج', 'Results'], m => m.results, 1, v => (v == null ? '—' : qty(v))],
  [['الليدز', 'Leads'], m => m.leads, 1, v => (v == null ? '—' : qty(v))],
  [['تكلفة الليد', 'Cost per lead'], m => m.cpl, -1, sar],
  [['نسبة النقر', 'Click rate'], m => m.ctr, 1, pct],
  [['وقفوا يشوفون', 'Stopped to watch'], m => m.hook, 1, pct],
  [['كمّلوا للنهاية', 'Watched to the end'], m => m.hold, 1, pct],
  [['الظهور', 'Impressions'], m => m.impr, 0, v => (v == null ? '—' : qty(v))],
];

function IdeaDetail({ data, idea }: { data: Dash; idea: Idea }) {
  const m = media(idea.ad);
  const tops = ROWS.map(([, get, dir]) => best(idea.versions.map(get), dir));
  return (
    <>
      <SheetHeader className="pe-10">
        <SheetTitle className="leading-snug">{idea.name}</SheetTitle>
        <SheetDescription>
          {T(`${qty(idea.versions.length)} ${idea.versions.length === 1 ? 'نسخة' : 'نسخ'} في ${qty(idea.ads.length)} إعلان`, `${qty(idea.versions.length)} ${idea.versions.length === 1 ? 'version' : 'versions'} in ${qty(idea.ads.length)} ads`)} · {idea.platforms.map(platformName).join(T('، ', ', '))} · {idea.depts.map(k => deptName(data, k)).join(T('، ', ', '))}
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-5 overflow-y-auto px-4 pb-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr]">
          <Preview ad={idea.ad} play className="max-h-96 sm:aspect-square" />
          <div className="grid content-start gap-3">
            {idea.ad.text && <p className="text-sm leading-relaxed whitespace-pre-line">{idea.ad.text}</p>}
            {m.open && <Button asChild variant="outline" size="sm" className="justify-self-start"><a href={m.open} target="_blank" rel="noopener"><ExternalLink />{T('افتح المادة الإعلانية', 'Open the creative')}</a></Button>}
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <Stat label={T('الصرف', 'Spend')} value={sar(idea.spend)} />
              <Stat label={T('النتائج', 'Results')} value={qty(idea.results)} note={T(`${qty(idea.leads)} ليد · ${qty(idea.conv)} محادثة`, `${qty(idea.leads)} leads · ${qty(idea.conv)} conversations`)} />
              <Stat label={T('تكلفة الليد', 'Cost per lead')} value={sar(idea.cpl)} note={cplNote(idea) ?? T('إعلانات الليدز بس', 'Lead ads only')} />
              <Stat label={T('نسبة النقر', 'Click rate')} value={pct(idea.ctr)} note={T(`${qty(idea.clicks)} نقرة`, `${qty(idea.clicks)} clicks`)} />
              <Stat label={T('وقفوا يشوفون', 'Stopped to watch')} value={hookValue(idea)} note={T('مدى الحياة', 'Lifetime')} />
              <Stat label={T('كمّلوا للنهاية', 'Watched to the end')} value={idea.hold == null ? '—' : pct(idea.hold)} note={T('من اللي وقفوا', 'Of those who stopped')} />
            </div>
          </div>
        </div>

        {idea.versions.length > 1 && (
          <section className="grid gap-2" aria-label={T('مقارنة النسخ', 'Compare versions')}>
            <h3 className="font-medium">{T('النسخ جنب بعض', 'Versions side by side')}</h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="sticky start-0 bg-muted p-2 text-start font-medium" scope="col"><span className="sr-only">{T('المقياس', 'Metric')}</span></th>
                    {idea.versions.map(v => (
                      <th key={v.id} scope="col" className="w-40 p-2 align-top font-normal">
                        <Preview ad={v.ad} className="mb-1 aspect-square w-32" />
                        <div className="line-clamp-2 w-32 text-start text-xs font-medium" title={v.ad.name}>{v.ad.name}</div>
                        <div className="w-32 text-start text-xs text-muted-foreground">{v.platforms.map(platformName).join(T('، ', ', '))} · {goalName(v.ad.goal || '')}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(([[ar, en], get, , show], i) => (
                    <tr key={en} className="border-t">
                      <th scope="row" className="sticky start-0 bg-background p-2 text-start font-normal whitespace-nowrap text-muted-foreground">{T(ar, en)}</th>
                      {idea.versions.map(v => {
                        const x = get(v), top = tops[i] != null && x === tops[i];
                        return <td key={v.id} className={`p-2 tabular-nums ${top ? 'font-semibold text-primary' : ''}`}>{show(x)}{top && <span className="sr-only">{T(' (الأفضل)', ' (best)')}</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">{T('الأفضل في كل سطر ملوّن. الأرقام للفترة المختارة، ومقاييس الفيديو مدى الحياة.', 'The best in each row is coloured. Numbers are for the chosen period; video measures are lifetime.')}</p>
          </section>
        )}

        <section className="grid gap-2" aria-label={T('الإعلانات المربوطة', 'Linked ads')}>
          <h3 className="font-medium">{T('الإعلانات المربوطة بهالمادة الإعلانية', 'Ads using this creative')}</h3>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead>{T('الإعلان', 'Ad')}</TableHead><TableHead>{T('المنصة', 'Platform')}</TableHead><TableHead>{T('الحالة', 'Status')}</TableHead>
                  <TableHead>{T('الصرف', 'Spend')}</TableHead><TableHead>{T('النتائج', 'Results')}</TableHead><TableHead>{T('تكلفة الليد', 'Cost per lead')}</TableHead><TableHead>{T('نسبة النقر', 'Click rate')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {idea.ads.map(x => (
                  <TableRow key={x.key}>
                    <TableCell>
                      <div className="max-w-64 truncate font-medium" title={x.ad.name}>{x.ad.name}</div>
                      <div className="max-w-64 truncate text-xs text-muted-foreground" title={`${x.ad.campaign}${x.ad.group ? ' · ' + x.ad.group : ''}`}>{x.ad.campaign}{x.ad.group ? ` · ${x.ad.group}` : ''}</div>
                    </TableCell>
                    <TableCell>{platformName(x.ad.platform)}<div className="text-xs text-muted-foreground">{goalName(x.ad.goal || '')}</div></TableCell>
                    <TableCell><Badge variant={x.ad.live ? 'default' : 'outline'}>{x.ad.live ? T('شغّال', 'Running') : T('متوقف', 'Paused')}</Badge></TableCell>
                    <TableCell className="tabular-nums">{sar(x.spend)}</TableCell>
                    <TableCell className="tabular-nums">{qty(x.results)}</TableCell>
                    <TableCell className="tabular-nums">{countsAsLead(x.ad) ? (x.ad.dest === 'unknown' ? <>{sar(x.cpl)}<div className="text-xs text-muted-foreground">{T('وجهة غير معروفة', 'Destination unknown')}</div></> : sar(x.cpl)) : isWhatsappDest(x.ad) ? <span className="text-xs text-muted-foreground">{T('واتساب، الليدز ما تنقاس من المنصة', 'WhatsApp, leads are not measured by the platform')}</span> : '—'}</TableCell>
                    <TableCell className="tabular-nums">{pct(x.ctr)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </>
  );
}
