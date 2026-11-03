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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type Dash, GOAL, addDays, lastDay, platformName } from './numbers';
import { ALL, type CreativeAd, type Dir, type Filters, type Idea, type Metrics, type Sort, best, cplDiffers, ideas, media, options, sortIdeas } from './creatives';
import { useDash } from './useDash';
import { CreativeSkeleton } from './Skeletons';
import { longDay, pct, qty, sar } from './format';

const RANGES = [['7', '7 أيام'], ['30', '30 يوم'], ['90', '90 يوم'], ['all', 'كل البيانات']] as const;
type Range = (typeof RANGES)[number][0];
const SORTS: [Sort, string][] = [['spend', 'الأعلى صرف'], ['results', 'الأكثر نتائج'], ['cpl', 'الأرخص تكلفة ليد'], ['ctr', 'الأعلى نسبة نقر'], ['hook', 'الأعلى وقفوا يشوفون']];
const PAGE = 24;

const goalName = (g: string) => GOAL[g] ?? 'غيرها';
function deptName(d: Dash, k: string): string {
  const names = (d as { departments?: { departments?: Record<string, { ar?: string }> } }).departments?.departments ?? {};
  return names[k]?.ar || (k === 'brand' ? 'العلامة التجارية' : k);
}

export default function Creative() {
  const { data, error } = useDash();
  const [range, setRange] = React.useState<Range>('30');
  const [f, setF] = React.useState<Filters>(ALL);
  const [sort, setSort] = React.useState<Sort>('spend');
  const [shown, setShown] = React.useState(PAGE);
  const [open, setOpen] = React.useState<Idea | null>(null);

  const to = data ? lastDay(data) : null;
  const from = !data || !to ? '' : range === 'all' ? data.range?.start || '0000-00-00' : addDays(to, -(Number(range) - 1));
  const list = React.useMemo(() => (data && to ? sortIdeas(ideas(data, from, to, f), sort) : []), [data, from, to, f, sort]);
  const opts = React.useMemo(() => (data ? options(data) : null), [data]);
  React.useEffect(() => setShown(PAGE), [from, f, sort]);

  if (error) return <p className="ui text-destructive">{error}</p>;
  if (!data || !opts) return <CreativeSkeleton />;
  if (!to) return <p className="ui text-muted-foreground">ما فيه أرقام للحين.</p>;
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
    <Direction.Provider dir="rtl">
    <div className="ui grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">من {longDay(from)} إلى {longDay(to)}</p>
        <ToggleGroup type="single" variant="outline" value={range} onValueChange={v => v && setRange(v as Range)} aria-label="الفترة" className="w-full sm:w-auto">
          {RANGES.map(([v, t]) => <ToggleGroupItem key={v} value={v} className="flex-1 px-2 whitespace-nowrap sm:flex-none sm:px-4">{t}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Input value={f.q} onChange={e => set('q')(e.target.value)} placeholder="ابحث بالاسم أو الحملة أو النص" className="col-span-2 h-9 sm:max-w-72" aria-label="بحث" />
        {pick('platform', 'المنصة', 'كل المنصات', opts.platforms, platformName)}
        {pick('dept', 'القسم', 'كل الأقسام', opts.depts, k => deptName(data, k))}
        {pick('goal', 'الهدف', 'كل الأهداف', opts.goals, goalName)}
        {pick('format', 'الصيغة', 'كل الصيغ', opts.formats, v => v)}
        <Select value={sort} onValueChange={v => setSort(v as Sort)}>
          <SelectTrigger size="sm" className="col-span-2 w-full sm:ms-auto sm:w-48" aria-label="الترتيب"><SelectValue /></SelectTrigger>
          <SelectContent>{SORTS.map(([v, t]) => <SelectItem key={v} value={v}>{t}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <p className="text-sm text-muted-foreground">
        {qty(list.length)} فكرة في {qty(ads)} إعلان. الفكرة الوحدة = نفس المادة الإعلانية في أكثر من مجموعة أو منصة أو نسخة. اضغط على أي فكرة تشوف نسخها جنب بعض.
      </p>
      {list.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.slice(0, shown).map(x => <IdeaCard key={x.key} idea={x} onOpen={() => setOpen(x)} />)}
        </div>
      ) : (
        <Card><CardContent className="py-10 text-center text-muted-foreground">ما فيه مادة إعلانية تطابق الفلاتر في هالفترة. جرّب تغيّر الفلتر أو تكبّر الفترة.</CardContent></Card>
      )}
      {list.length > shown && (
        <Button variant="outline" className="justify-self-center" onClick={() => setShown(n => n + PAGE)}>اعرض أكثر ({qty(list.length - shown)} باقي)</Button>
      )}
      <Sheet open={!!open} onOpenChange={v => !v && setOpen(null)}>
        <SheetContent side="left" className="ui w-full gap-0 sm:max-w-3xl" dir="rtl">
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
        : <div className="flex size-full items-center justify-center p-4 text-center text-xs text-muted-foreground">ما فيه معاينة لهالإعلان</div>}
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

const cplNote = (m: Metrics) => (cplDiffers(m) ? `${sar(m.leadSpend)} ÷ ${qty(m.leadN)} ليد` : undefined);
const hookValue = (m: Metrics) => (m.hook == null ? 'صورة أو بدون بيانات' : pct(m.hook));

function IdeaCard({ idea, onOpen }: { idea: Idea; onOpen: () => void }) {
  return (
    <Card role="button" tabIndex={0} aria-label={`تفاصيل ${idea.name}`} onClick={onOpen} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      className="cursor-pointer gap-3 py-4 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <div className="px-4"><Preview ad={idea.ad} className="aspect-[4/3]" /></div>
      <div className="grid gap-2 px-4">
        <div className="flex flex-wrap gap-1">
          {idea.platforms.map(p => <Badge key={p} variant="secondary">{platformName(p)}</Badge>)}
          <Badge variant="outline">{qty(idea.versions.length)} {idea.versions.length === 1 ? 'نسخة' : 'نسخ'}</Badge>
          <Badge variant={idea.live ? 'default' : 'outline'}>{idea.live ? 'شغّال' : 'متوقف'}</Badge>
        </div>
        <div className="line-clamp-2 font-medium leading-snug" title={idea.name}>{idea.name}</div>
        {idea.ad.text && <p className="line-clamp-2 text-sm text-muted-foreground">{idea.ad.text}</p>}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Stat label="الصرف" value={sar(idea.spend)} />
          <Stat label="النتائج" value={qty(idea.results)} note={idea.conv ? `${qty(idea.leads)} ليد · ${qty(idea.conv)} محادثة` : undefined} />
          <Stat label="تكلفة الليد" value={sar(idea.cpl)} note={cplNote(idea)} />
          <Stat label="نسبة النقر" value={pct(idea.ctr)} />
          <Stat label="وقفوا يشوفون" value={idea.hook == null ? '—' : pct(idea.hook)} />
          <Stat label="الظهور" value={qty(idea.impr)} />
        </div>
      </div>
    </Card>
  );
}

// Rows of the side-by-side comparison: [label, value, direction (1 higher is better, -1 lower is better, 0 neither), shown as]
const ROWS: [string, (m: Metrics) => number | null, Dir, (v: number | null) => string][] = [
  ['الصرف', m => m.spend, 0, sar],
  ['النتائج', m => m.results, 1, v => (v == null ? '—' : qty(v))],
  ['الليدز', m => m.leads, 1, v => (v == null ? '—' : qty(v))],
  ['تكلفة الليد', m => m.cpl, -1, sar],
  ['نسبة النقر', m => m.ctr, 1, pct],
  ['وقفوا يشوفون', m => m.hook, 1, pct],
  ['كمّلوا للنهاية', m => m.hold, 1, pct],
  ['الظهور', m => m.impr, 0, v => (v == null ? '—' : qty(v))],
];

function IdeaDetail({ data, idea }: { data: Dash; idea: Idea }) {
  const m = media(idea.ad);
  const tops = ROWS.map(([, get, dir]) => best(idea.versions.map(get), dir));
  return (
    <>
      <SheetHeader className="pe-10">
        <SheetTitle className="leading-snug">{idea.name}</SheetTitle>
        <SheetDescription>
          {qty(idea.versions.length)} {idea.versions.length === 1 ? 'نسخة' : 'نسخ'} في {qty(idea.ads.length)} إعلان · {idea.platforms.map(platformName).join('، ')} · {idea.depts.map(k => deptName(data, k)).join('، ')}
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-5 overflow-y-auto px-4 pb-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr]">
          <Preview ad={idea.ad} play className="max-h-96 sm:aspect-square" />
          <div className="grid content-start gap-3">
            {idea.ad.text && <p className="text-sm leading-relaxed whitespace-pre-line">{idea.ad.text}</p>}
            {m.open && <Button asChild variant="outline" size="sm" className="justify-self-start"><a href={m.open} target="_blank" rel="noopener"><ExternalLink />افتح المادة الإعلانية</a></Button>}
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <Stat label="الصرف" value={sar(idea.spend)} />
              <Stat label="النتائج" value={qty(idea.results)} note={`${qty(idea.leads)} ليد · ${qty(idea.conv)} محادثة`} />
              <Stat label="تكلفة الليد" value={sar(idea.cpl)} note={cplNote(idea) ?? 'إعلانات الليدز بس'} />
              <Stat label="نسبة النقر" value={pct(idea.ctr)} note={`${qty(idea.clicks)} نقرة`} />
              <Stat label="وقفوا يشوفون" value={hookValue(idea)} note="مدى الحياة" />
              <Stat label="كمّلوا للنهاية" value={idea.hold == null ? '—' : pct(idea.hold)} note="من اللي وقفوا" />
            </div>
          </div>
        </div>

        {idea.versions.length > 1 && (
          <section className="grid gap-2" aria-label="مقارنة النسخ">
            <h3 className="font-medium">النسخ جنب بعض</h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="sticky start-0 bg-muted p-2 text-start font-medium" scope="col"><span className="sr-only">المقياس</span></th>
                    {idea.versions.map(v => (
                      <th key={v.id} scope="col" className="w-40 p-2 align-top font-normal">
                        <Preview ad={v.ad} className="mb-1 aspect-square w-32" />
                        <div className="line-clamp-2 w-32 text-start text-xs font-medium" title={v.ad.name}>{v.ad.name}</div>
                        <div className="w-32 text-start text-xs text-muted-foreground">{v.platforms.map(platformName).join('، ')} · {goalName(v.ad.goal || '')}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(([label, get, , show], i) => (
                    <tr key={label} className="border-t">
                      <th scope="row" className="sticky start-0 bg-background p-2 text-start font-normal whitespace-nowrap text-muted-foreground">{label}</th>
                      {idea.versions.map(v => {
                        const x = get(v), top = tops[i] != null && x === tops[i];
                        return <td key={v.id} className={`p-2 tabular-nums ${top ? 'font-semibold text-primary' : ''}`}>{show(x)}{top && <span className="sr-only"> (الأفضل)</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">الأفضل في كل سطر ملوّن. الأرقام للفترة المختارة، ومقاييس الفيديو مدى الحياة.</p>
          </section>
        )}

        <section className="grid gap-2" aria-label="الإعلانات المربوطة">
          <h3 className="font-medium">الإعلانات المربوطة بهالمادة الإعلانية</h3>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead>الإعلان</TableHead><TableHead>المنصة</TableHead><TableHead>الحالة</TableHead>
                  <TableHead>الصرف</TableHead><TableHead>النتائج</TableHead><TableHead>تكلفة الليد</TableHead><TableHead>نسبة النقر</TableHead>
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
                    <TableCell><Badge variant={x.ad.live ? 'default' : 'outline'}>{x.ad.live ? 'شغّال' : 'متوقف'}</Badge></TableCell>
                    <TableCell className="tabular-nums">{sar(x.spend)}</TableCell>
                    <TableCell className="tabular-nums">{qty(x.results)}</TableCell>
                    <TableCell className="tabular-nums">{x.ad.goal === 'lead' ? sar(x.cpl) : '—'}</TableCell>
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
