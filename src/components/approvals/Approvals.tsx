// The approvals center (docs/PRD.md §3.1, milestone M3): one list of what waits for this user's approval, by kind.
// Data: /api/approvals/list (src/lib/approvals.ts). Every decision calls the item's OWN route, so the original checks
// stay in force: social posts (the named approvers), lessons (the tab's approve level). Ad actions change spend: they
// are rejected here, but approved only on the decisions board, which holds the dry run and the second confirmation.
// Keys: J/K move, A approve, R reject (each opens the confirmation; nothing is decided by a key alone).
import * as React from 'react';
import { Direction } from 'radix-ui';
import { Check, ExternalLink, Inbox, RefreshCw, X } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { T, pageLang } from '@/modules/overview/lang';

type Kind = 'social' | 'ads' | 'lessons';
interface Item { kind: Kind; id: string; title: string; detail: string; at: string; by: string | null; href: string; money: boolean; meta: Record<string, unknown> }
type Counts = Record<Kind, number> & { total: number };
interface Data { items: Item[]; counts: Counts; can: Record<Kind, boolean> }

const KIND_NAME: Record<Kind, [string, string]> = { social: ['النشر', 'Publishing'], ads: ['الإعلانات', 'Ads'], lessons: ['الدروس', 'Lessons'] };

async function call(path: string, method: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return r.ok ? { ok: true } : { ok: false, error: j.error || T('صار خطأ، جرّب مرة ثانية', 'Something went wrong, try again') };
  } catch { return { ok: false, error: T('ما قدرنا نوصل. جرّب مرة ثانية', 'Could not connect. Try again') }; }
}

// The route each kind is decided on (unchanged endpoints)
function decide(it: Item, yes: boolean) {
  if (it.kind === 'social') return call('/api/social/posts', 'PATCH', { id: Number(it.id), action: yes ? 'approve' : 'cancel' });
  if (it.kind === 'lessons') return call('/api/lessons/list', 'PATCH', { id: Number(it.id), module: it.meta.module, action: yes ? 'approve' : 'ignore' });
  // ads: reject only (approval needs the board's dry run and second confirmation)
  return call('/api/buyer/decide', 'POST', { id: it.id, decision: 'reject' });
}

const when = (iso: string) => {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat(pageLang() === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(t);
};

export default function Approvals() {
  const [data, setData] = React.useState<Data | null>(null);
  const [err, setErr] = React.useState('');
  const [tab, setTab] = React.useState<'all' | Kind>('all');
  const [cur, setCur] = React.useState(0);
  const [ask, setAsk] = React.useState<{ it: Item; yes: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const dir = pageLang() === 'en' ? 'ltr' : 'rtl';

  const load = React.useCallback(async () => {
    setErr('');
    try {
      const r = await fetch('/api/approvals/list', { credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch { setErr(T('ما قدرنا نجيب القائمة. جرّب مرة ثانية', 'Could not load the list. Try again')); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const items = React.useMemo(() => (data?.items ?? []).filter(i => tab === 'all' || i.kind === tab), [data, tab]);
  React.useEffect(() => { setCur(c => Math.min(c, Math.max(0, items.length - 1))); }, [items.length]);

  const open = React.useCallback((it: Item, yes: boolean) => {
    if (yes && it.kind === 'ads') { window.location.href = it.href; return; }
    setAsk({ it, yes });
  }, []);

  // J/K/A/R, never while typing or while a dialog is open
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ask || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable=true]'))) return;
      const k = e.key.toLowerCase();
      if (k === 'j') { e.preventDefault(); setCur(c => Math.min(c + 1, items.length - 1)); }
      else if (k === 'k') { e.preventDefault(); setCur(c => Math.max(c - 1, 0)); }
      else if ((k === 'a' || k === 'r') && items[cur]) { e.preventDefault(); open(items[cur]!, k === 'a'); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ask, items, cur, open]);
  React.useEffect(() => { document.querySelector<HTMLElement>(`[data-ap-i="${cur}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cur]);

  async function confirm() {
    if (!ask) return;
    setBusy(true);
    const r = await decide(ask.it, ask.yes);
    setBusy(false); setAsk(null);
    if (r.ok) { toast.success(ask.yes ? T('تم الاعتماد', 'Approved') : T('تم الرفض', 'Rejected')); void load(); }
    else toast.error(r.error);
  }

  const counts = data?.counts;
  const tabs: ('all' | Kind)[] = ['all', 'social', 'ads', 'lessons'];

  return (
    <Direction.Provider dir={dir}>
      <div className="ui grid w-full min-w-0 gap-4" dir={dir}>
        <Tabs className="min-w-0" value={tab} onValueChange={v => { setTab(v as typeof tab); setCur(0); }}>
          <TabsList className="max-w-full justify-start overflow-x-auto" aria-label={T('نوع الاعتماد', 'Approval type')}>
            {tabs.map(k => (
              <TabsTrigger key={k} value={k} data-k={k} className="flex-none">
                {k === 'all' ? T('الكل', 'All') : T(...KIND_NAME[k])}
                {counts ? <Badge variant="secondary" className="ms-1 tabular-nums">{k === 'all' ? counts.total : counts[k]}</Badge> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {err ? (
          <div className="card pad" role="alert">
            <p>{err}</p>
            <Button variant="outline" className="mt-3 min-h-11" onClick={() => void load()}><RefreshCw />{T('جرّب مرة ثانية', 'Try again')}</Button>
          </div>
        ) : !data ? (
          <div className="grid gap-3" aria-busy="true">{[0, 1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : !items.length ? (
          <div className="card pad flex flex-col items-center gap-2 py-10 text-center" data-empty>
            <Inbox className="size-8 text-muted-foreground" aria-hidden />
            <p>{T('ما فيه شي ينتظرك. كل شي معتمد.', 'Nothing is waiting for you. Everything is approved.')}</p>
          </div>
        ) : (
          <ul className="grid gap-3" role="list" aria-label={T('ينتظر اعتمادك', 'Waiting for your approval')}>
            {items.map((it, i) => (
              <li key={`${it.kind}:${it.id}`} data-ap-i={i} data-kind={it.kind} aria-current={i === cur ? 'true' : undefined}
                className={'card pad grid min-w-0 gap-2 ' + (i === cur ? 'ring-2 ring-ring' : '')} onClick={() => setCur(i)}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{T(...KIND_NAME[it.kind])}</Badge>
                  {it.money ? <Badge variant="destructive">{T('يغيّر الصرف', 'Changes spend')}</Badge> : null}
                  <span className="text-xs text-muted-foreground tabular-nums">{when(it.at)}</span>
                </div>
                <p className="font-medium break-words" dir="auto">{it.title}</p>
                {it.detail ? <p className="text-sm text-muted-foreground" dir="auto">{it.detail}</p> : null}
                {it.by ? <p className="text-xs text-muted-foreground">{T('من', 'By')}: <span dir="ltr">{it.by}</span></p> : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  {it.kind === 'ads' ? (
                    <Button asChild className="min-h-11"><a href={it.href}><ExternalLink />{T('افتح للاعتماد', 'Open to approve')}</a></Button>
                  ) : (
                    <Button className="min-h-11" onClick={() => open(it, true)}><Check />{T('اعتمد', 'Approve')}</Button>
                  )}
                  <Button variant="outline" className="min-h-11" onClick={() => open(it, false)}><X />{it.kind === 'lessons' ? T('تجاهل', 'Ignore') : T('ارفض', 'Reject')}</Button>
                  {it.kind !== 'ads' ? <Button asChild variant="ghost" className="min-h-11 text-primary"><a href={it.href}>{T('التفاصيل', 'Details')}</a></Button> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {T('اختصارات', 'Shortcuts')}: <kbd>J</kbd> <kbd>K</kbd> {T('للتنقل', 'move')}، <kbd>A</kbd> {T('اعتماد', 'approve')}، <kbd>R</kbd> {T('رفض', 'reject')}
        </p>
      </div>

      <AlertDialog open={!!ask} onOpenChange={o => { if (!o && !busy) setAsk(null); }}>
        <AlertDialogContent dir={dir}>
          <AlertDialogHeader>
            <AlertDialogTitle>{ask?.yes ? T('تعتمد هذا؟', 'Approve this?') : ask?.it.kind === 'lessons' ? T('تتجاهل هذا الدرس؟', 'Ignore this lesson?') : T('ترفض هذا؟', 'Reject this?')}</AlertDialogTitle>
            <AlertDialogDescription dir="auto">
              {ask?.it.title}
              {ask?.it.kind === 'social' && !ask.yes ? ' — ' + T('المنشور ينلغي وما ينتشر.', 'The post is cancelled and not published.') : ''}
              {ask?.it.kind === 'social' && ask.yes ? ' — ' + T('ينتشر في وقته.', 'It goes out at its time.') : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={busy}>{T('رجوع', 'Back')}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" disabled={busy} onClick={e => { e.preventDefault(); void confirm(); }}>
              {ask?.yes ? T('اعتمد', 'Approve') : ask?.it.kind === 'lessons' ? T('تجاهل', 'Ignore') : T('ارفض', 'Reject')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Toaster />
    </Direction.Provider>
  );
}
