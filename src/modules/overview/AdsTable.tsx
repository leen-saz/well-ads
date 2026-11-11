// جدول الإعلانات: ترتيب بالضغط على العمود، بحث، فلتر منصة، إخفاء أعمدة، صفحات.
// الضغط على إعلان يفتح لوحة جانبية فيها أرقامه اليومية.
import * as React from 'react';
import {
  type ColumnDef, type ColumnVisibilityState, type PaginationState, type SortingState,
  columnFilteringFeature, columnVisibilityFeature, createFilteredRowModel, createPaginatedRowModel, createSortedRowModel,
  filterFn_equals, flexRender, globalFilteringFeature, rowPaginationFeature, rowSortingFeature, sortFn_basic,
  tableFeatures, useTable,
} from '@tanstack/react-table';
import { ArrowUpDown, ChevronLeft, ChevronRight, Columns3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type AdRow, type Dash, adDaily, byAd, goalName, platformName } from './numbers';
import { DayChart } from './TrendChart';
import { pct, qty, sar } from './format';
import { T, pageLang } from './lang';

// v9: every feature the table uses is declared once, up front; unused ones stay out of the bundle
const features = tableFeatures({
  rowSortingFeature, columnFilteringFeature, globalFilteringFeature, columnVisibilityFeature, rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { basic: sortFn_basic },
  filterFns: { equals: filterFn_equals },
});
type Feats = typeof features;

// Labels are read when the table draws, so they follow the page language
const sortable = (ar: string, en: string) => function Head({ column }: { column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | 'asc' | 'desc' } }) {
  return (
    <Button variant="ghost" size="sm" className="-ms-3" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
      {T(ar, en)}<ArrowUpDown className="size-3.5" />
    </Button>
  );
};

const columns: ColumnDef<Feats, AdRow>[] = [
  {
    accessorKey: 'name', header: () => T('الإعلان', 'Ad'), enableHiding: false,
    cell: ({ row }) => (
      <div className="max-w-80">
        <div className="truncate font-medium" title={row.original.name}>{row.original.name}</div>
        <div className="truncate text-xs text-muted-foreground" title={row.original.campaign}>{row.original.campaign}</div>
      </div>
    ),
  },
  { accessorKey: 'platform', header: () => T('المنصة', 'Platform'), cell: ({ row }) => platformName(row.original.platform), filterFn: 'equals' },
  { accessorKey: 'goal', header: () => T('الهدف', 'Goal'), cell: ({ row }) => goalName(row.original.goal) },
  {
    accessorKey: 'live', header: () => T('الحالة', 'Status'),
    cell: ({ row }) => <Badge variant={row.original.live ? 'default' : 'outline'}>{row.original.live ? T('شغّال', 'Running') : T('متوقف', 'Paused')}</Badge>,
  },
  { accessorKey: 'spend', header: sortable('الصرف', 'Spend'), cell: ({ row }) => <span className="tabular-nums">{sar(row.original.spend)}</span> },
  { accessorKey: 'results', header: sortable('النتائج', 'Results'), cell: ({ row }) => <span className="tabular-nums">{qty(row.original.results)}</span> },
  {
    accessorKey: 'cpr', header: sortable('تكلفة النتيجة', 'Cost per result'), sortUndefined: 'last',
    cell: ({ row }) => <span className="tabular-nums">{sar(row.original.cpr)}</span>,
  },
  { accessorKey: 'ctr', header: sortable('نسبة النقر', 'Click rate'), sortUndefined: 'last', cell: ({ row }) => <span className="tabular-nums">{pct(row.original.ctr)}</span> },
];

const searchAdsAndCampaigns = (row: { original: AdRow }, _id: string, q: string) =>
  `${row.original.name} ${row.original.campaign}`.toLowerCase().includes(q.trim().toLowerCase());

export function AdsTable({ data, from, to }: { data: Dash; from: string; to: string }) {
  const rows = React.useMemo(() => byAd(data, from, to), [data, from, to]);
  const platforms = React.useMemo(() => [...new Set(rows.map(r => r.platform))].sort(), [rows]);
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'spend', desc: true }]);
  const [visibility, setVisibility] = React.useState<ColumnVisibilityState>({});
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [search, setSearch] = React.useState('');
  const [platform, setPlatform] = React.useState('all');
  const [open, setOpen] = React.useState<AdRow | null>(null);

  // Stable references: v9 rebuilds its row models when an option or state value changes identity, which would send the table back to page 1
  const columnFilters = React.useMemo(() => (platform === 'all' ? [] : [{ id: 'platform', value: platform }]), [platform]);
  const table = useTable({
    features, data: rows, columns,
    state: { sorting, columnVisibility: visibility, globalFilter: search, pagination, columnFilters },
    onSortingChange: setSorting, onPaginationChange: setPagination, onColumnVisibilityChange: setVisibility, onGlobalFilterChange: setSearch,
    globalFilterFn: searchAdsAndCampaigns,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{T('الإعلانات', 'Ads')}</CardTitle>
        <CardDescription>{T(`${qty(table.getFilteredRowModel().rows.length)} إعلان صرف أو جاب نتيجة في الفترة. اضغط على أي إعلان تشوف أرقامه كل يوم.`, `${qty(table.getFilteredRowModel().rows.length)} ads spent or brought a result in the period. Click any ad to see its daily numbers.`)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={T('ابحث باسم الإعلان أو الحملة', 'Search by ad or campaign name')} className="h-9 max-w-72" aria-label={T('بحث', 'Search')} />
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger size="sm" className="w-44" aria-label={T('المنصة', 'Platform')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{T('كل المنصات', 'All platforms')}</SelectItem>
              {platforms.map(p => <SelectItem key={p} value={p}>{platformName(p)}</SelectItem>)}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="ms-auto"><Columns3 />{T('الأعمدة', 'Columns')}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table.getAllColumns().filter(c => c.getCanHide()).map(c => (
                <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={v => c.toggleVisibility(!!v)}>
                  {(pageLang() === 'en' ? { platform: 'Platform', goal: 'Goal', live: 'Status', spend: 'Spend', results: 'Results', cpr: 'Cost per result', ctr: 'Click rate' } as Record<string, string>
                    : { platform: 'المنصة', goal: 'الهدف', live: 'الحالة', spend: 'الصرف', results: 'النتائج', cpr: 'تكلفة النتيجة', ctr: 'نسبة النقر' } as Record<string, string>)[c.id] ?? c.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              {table.getHeaderGroups().map(g => (
                <TableRow key={g.id}>
                  {g.headers.map(h => <TableHead key={h.id}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}</TableHead>)}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? table.getRowModel().rows.map(r => (
                <TableRow key={r.id} className="cursor-pointer" tabIndex={0} onClick={() => setOpen(r.original)} onKeyDown={e => e.key === 'Enter' && setOpen(r.original)}>
                  {r.getVisibleCells().map(c => <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>)}
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">{T('ما فيه إعلان يطابق البحث.', 'No ad matches the search.')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{T(`صفحة ${pagination.pageIndex + 1} من ${Math.max(table.getPageCount(), 1)}`, `Page ${pagination.pageIndex + 1} of ${Math.max(table.getPageCount(), 1)}`)}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="size-8" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label={T('الصفحة اللي قبل', 'Previous page')}>{pageLang() === 'en' ? <ChevronLeft /> : <ChevronRight />}</Button>
            <Button variant="outline" size="icon" className="size-8" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label={T('الصفحة اللي بعد', 'Next page')}>{pageLang() === 'en' ? <ChevronRight /> : <ChevronLeft />}</Button>
          </div>
        </div>
      </CardContent>
      <Sheet open={!!open} onOpenChange={v => !v && setOpen(null)}>
        <SheetContent side={pageLang() === 'en' ? 'right' : 'left'} className="ui w-full gap-0 sm:max-w-lg" dir={pageLang() === 'en' ? 'ltr' : 'rtl'}>
          {open && (
            <>
              <SheetHeader className="pe-10">
                <SheetTitle className="leading-snug">{open.name}</SheetTitle>
                <SheetDescription>{open.campaign} · {platformName(open.platform)}</SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 overflow-y-auto px-4 pb-6">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[[T('الصرف', 'Spend'), sar(open.spend)], [T('النتائج', 'Results'), qty(open.results)], [T('تكلفة النتيجة', 'Cost per result'), sar(open.cpr)], [T('نسبة النقر', 'Click rate'), pct(open.ctr)]].map(([l, v]) => (
                    <div key={l} className="rounded-lg border p-3"><div className="text-muted-foreground">{l}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>
                  ))}
                </div>
                <div><div className="mb-1 text-sm font-medium">{T('الصرف كل يوم', 'Spend per day')}</div><DayChart days={adDaily(data, open.key, from, to)} metric="spend" height={180} /></div>
                <div><div className="mb-1 text-sm font-medium">{T('النتائج كل يوم', 'Results per day')}</div><DayChart days={adDaily(data, open.key, from, to)} metric="results" height={180} /></div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
