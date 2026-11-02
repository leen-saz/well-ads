// جدول الإعلانات: ترتيب بالضغط على العمود، بحث، فلتر منصة، إخفاء أعمدة، صفحات.
// الضغط على إعلان يفتح لوحة جانبية فيها أرقامه اليومية.
import * as React from 'react';
import {
  type ColumnDef, type SortingState, type VisibilityState,
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
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
import { type AdRow, type Dash, GOAL, adDaily, byAd, platformName } from './numbers';
import { DayChart } from './TrendChart';
import { pct, qty, sar } from './format';

const sortable = (label: string) => function Head({ column }: { column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | 'asc' | 'desc' } }) {
  return (
    <Button variant="ghost" size="sm" className="-ms-3" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
      {label}<ArrowUpDown className="size-3.5" />
    </Button>
  );
};

const columns: ColumnDef<AdRow>[] = [
  {
    accessorKey: 'name', header: 'الإعلان', enableHiding: false,
    cell: ({ row }) => (
      <div className="max-w-80">
        <div className="truncate font-medium" title={row.original.name}>{row.original.name}</div>
        <div className="truncate text-xs text-muted-foreground" title={row.original.campaign}>{row.original.campaign}</div>
      </div>
    ),
  },
  { accessorKey: 'platform', header: 'المنصة', cell: ({ row }) => platformName(row.original.platform), filterFn: 'equals' },
  { accessorKey: 'goal', header: 'الهدف', cell: ({ row }) => GOAL[row.original.goal] ?? '—' },
  {
    accessorKey: 'live', header: 'الحالة',
    cell: ({ row }) => <Badge variant={row.original.live ? 'default' : 'outline'}>{row.original.live ? 'شغّال' : 'متوقف'}</Badge>,
  },
  { accessorKey: 'spend', header: sortable('الصرف'), cell: ({ row }) => <span className="tabular-nums">{sar(row.original.spend)}</span> },
  { accessorKey: 'results', header: sortable('النتائج'), cell: ({ row }) => <span className="tabular-nums">{qty(row.original.results)}</span> },
  {
    accessorKey: 'cpr', header: sortable('تكلفة النتيجة'), sortUndefined: 'last',
    cell: ({ row }) => <span className="tabular-nums">{sar(row.original.cpr)}</span>,
  },
  { accessorKey: 'ctr', header: sortable('نسبة النقر'), sortUndefined: 'last', cell: ({ row }) => <span className="tabular-nums">{pct(row.original.ctr)}</span> },
];

export function AdsTable({ data, from, to }: { data: Dash; from: string; to: string }) {
  const rows = React.useMemo(() => byAd(data, from, to), [data, from, to]);
  const platforms = React.useMemo(() => [...new Set(rows.map(r => r.platform))].sort(), [rows]);
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'spend', desc: true }]);
  const [visibility, setVisibility] = React.useState<VisibilityState>({});
  const [search, setSearch] = React.useState('');
  const [platform, setPlatform] = React.useState('all');
  const [open, setOpen] = React.useState<AdRow | null>(null);

  const table = useReactTable({
    data: rows, columns,
    state: { sorting, columnVisibility: visibility, globalFilter: search, columnFilters: platform === 'all' ? [] : [{ id: 'platform', value: platform }] },
    onSortingChange: setSorting, onColumnVisibilityChange: setVisibility, onGlobalFilterChange: setSearch,
    globalFilterFn: (row, _id, q: string) => `${row.original.name} ${row.original.campaign}`.toLowerCase().includes(q.trim().toLowerCase()),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>الإعلانات</CardTitle>
        <CardDescription>{qty(table.getFilteredRowModel().rows.length)} إعلان صرف أو جاب نتيجة في الفترة. اضغط على أي إعلان تشوف أرقامه كل يوم.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث باسم الإعلان أو الحملة" className="h-9 max-w-72" aria-label="بحث" />
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger size="sm" className="w-44" aria-label="المنصة"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المنصات</SelectItem>
              {platforms.map(p => <SelectItem key={p} value={p}>{platformName(p)}</SelectItem>)}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="ms-auto"><Columns3 />الأعمدة</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table.getAllColumns().filter(c => c.getCanHide()).map(c => (
                <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={v => c.toggleVisibility(!!v)}>
                  {{ platform: 'المنصة', goal: 'الهدف', live: 'الحالة', spend: 'الصرف', results: 'النتائج', cpr: 'تكلفة النتيجة', ctr: 'نسبة النقر' }[c.id] ?? c.id}
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
                <TableRow><TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">ما فيه إعلان يطابق البحث.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>صفحة {table.getState().pagination.pageIndex + 1} من {Math.max(table.getPageCount(), 1)}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="size-8" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="الصفحة اللي قبل"><ChevronRight /></Button>
            <Button variant="outline" size="icon" className="size-8" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="الصفحة اللي بعد"><ChevronLeft /></Button>
          </div>
        </div>
      </CardContent>
      <Sheet open={!!open} onOpenChange={v => !v && setOpen(null)}>
        <SheetContent side="left" className="ui w-full gap-0 sm:max-w-lg" dir="rtl">
          {open && (
            <>
              <SheetHeader className="pe-10">
                <SheetTitle className="leading-snug">{open.name}</SheetTitle>
                <SheetDescription>{open.campaign} · {platformName(open.platform)}</SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 overflow-y-auto px-4 pb-6">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[['الصرف', sar(open.spend)], ['النتائج', qty(open.results)], ['تكلفة النتيجة', sar(open.cpr)], ['نسبة النقر', pct(open.ctr)]].map(([l, v]) => (
                    <div key={l} className="rounded-lg border p-3"><div className="text-muted-foreground">{l}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>
                  ))}
                </div>
                <div><div className="mb-1 text-sm font-medium">الصرف كل يوم</div><DayChart days={adDaily(data, open.key, from, to)} metric="spend" height={180} /></div>
                <div><div className="mb-1 text-sm font-medium">النتائج كل يوم</div><DayChart days={adDaily(data, open.key, from, to)} metric="results" height={180} /></div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
