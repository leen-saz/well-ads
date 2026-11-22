// «تلقائي» (docs/PRD.md §3.6, milestone M13): which agents act on their own, the spend cap, and the campaigns they must leave alone.
// Leen, 2026-11-22: the agent works on every campaign; one button switches it on (real execution included).
// Data: /api/automation/settings and /api/automation/excluded (src/api/routes/automation.ts). Everyone with approve on the
// decisions board sees it; only the owner changes it. Off by default; the emergency stop turns every agent back to approval.
import * as React from 'react';
import { Direction } from 'radix-ui';
import { Bot, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { T, pageLang } from '@/modules/overview/lang';

interface Excluded { platform: 'meta' | 'snapchat'; entity_id: string; name: string | null }
interface Data { auto: { on: Record<string, boolean>; spendCap: number }; agents: string[]; limits: { maxPct: number; spendCapMax: number }; excluded: Excluded[]; missing: boolean; kill: boolean; live: Record<string, boolean>; keys: Record<string, boolean>; owner: boolean }

const AGENT: Record<string, [string, string]> = { buyer: ['الميديا باير', 'Media buyer'] };
const PLAT: Record<string, [string, string]> = { meta: ['ميتا', 'Meta'], snapchat: ['سناب شات', 'Snapchat'] };
const name = (m: Record<string, [string, string]>, k: string) => (m[k] ? T(m[k][0], m[k][1]) : k);

async function send(path: string, method: string, body: unknown): Promise<string | null> {
  try {
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    if (r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return j.error || T('صار خطأ، جرّب مرة ثانية', 'Something went wrong, try again');
  } catch { return T('ما قدرنا نوصل. جرّب مرة ثانية', 'Could not connect. Try again'); }
}

export default function Automation() {
  const dir = pageLang() === 'en' ? 'ltr' : 'rtl';
  const [d, setD] = React.useState<Data | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [cap, setCap] = React.useState('');
  const [add, setAdd] = React.useState<{ platform: 'meta' | 'snapchat'; entity_id: string; name: string }>({ platform: 'meta', entity_id: '', name: '' });
  const load = React.useCallback(async () => {
    try {
      const r = await fetch('/api/automation/settings', { credentials: 'same-origin' });
      const j = (await r.json()) as Data & { error?: string };
      if (!r.ok) { setErr(j.error || T('ما قدرنا نقرأ الإعدادات', 'Could not read the settings')); return; }
      setD(j); setCap(String(j.auto.spendCap)); setErr(null);
    } catch { setErr(T('ما قدرنا نوصل. جرّب مرة ثانية', 'Could not connect. Try again')); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const act = async (path: string, method: string, body: unknown, ok: string) => {
    const e = await send(path, method, body);
    if (e) toast.error(e); else { toast.success(ok); await load(); }
  };

  if (err) return <div className="ui card pad" role="alert" dir={dir}>{err}</div>;
  if (!d) return <div className="ui grid gap-3" aria-busy="true" dir={dir}>{[0, 1].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div>;
  const can = d.owner;
  return (
    <Direction.Provider dir={dir}>
      <div className="ui grid w-full min-w-0 gap-4" dir={dir}>
        <section className="card pad grid gap-2">
          <h2 className="text-lg font-semibold">{T('«تلقائي» يعني إيش', 'What «Auto» means')}</h2>
          <p className="text-muted-foreground">{T(`الإيجنت يشتغل على كل الحملات وينفّذ اقتراحه بنفسه، بتغيير ميزانية ما يتعدى ${d.limits.maxPct}%، وبدون ما يتعدى صرف اليوم المتوقع السقف. أي شي برّا هذا يصير طلب اعتماد زي العادة.`,
            `The agent works on every campaign and applies its own proposal, with a budget change of at most ${d.limits.maxPct}%, and without the day's expected spend passing the cap. Anything else becomes an approval request as usual.`)}</p>
          {d.kill ? <p className="flex items-center gap-2 font-semibold text-destructive" data-kill><ShieldAlert className="size-4" aria-hidden />{T('زر الطوارئ شغّال: كل الإيجنتس «بموافقتي» لين ينطفي', 'The emergency stop is on: every agent waits for approval until it is off')}</p> : null}
          {!d.keys.meta && !d.keys.snapchat ? <p className="text-muted-foreground" data-nokeys>{T('مفاتيح الكتابة لميتا وسناب ما انضافت للنظام، فما يقدر ينفّذ شي للحين.', 'The Meta and Snapchat write keys are not set yet, so nothing can be applied yet.')}</p> : null}
          {d.missing ? <p className="text-muted-foreground" data-missing>{T('الأتمتة تحتاج تجهيز القاعدة. بلّغ الإدارة.', 'Automation needs the database setup. Tell the admin.')}</p> : null}
        </section>

        <section className="card pad grid gap-3" aria-labelledby="autoAgents">
          <h2 id="autoAgents" className="text-lg font-semibold">{T('الإيجنتس', 'Agents')}</h2>
          {d.agents.map(a => (
            <div key={a} className="flex flex-wrap items-center gap-3" data-agent={a}>
              <Bot className="size-5" aria-hidden />
              <span className="font-medium">{name(AGENT, a)}</span>
              <Badge variant={d.auto.on[a] ? 'default' : 'secondary'} data-state={d.auto.on[a] ? 'auto' : 'approve'}>{d.auto.on[a] ? T('تلقائي', 'Auto') : T('بموافقتي', 'With my approval')}</Badge>
              {can ? <Button variant={d.auto.on[a] ? 'outline' : 'default'} className="min-h-11" disabled={d.missing && !d.auto.on[a]}
                onClick={() => void act('/api/automation/settings', 'POST', { agent: a, on: !d.auto.on[a] }, d.auto.on[a] ? T('رجع «بموافقتي»', 'Back to approval') : T('صار «تلقائي»', 'Now on Auto'))}>
                {d.auto.on[a] ? T('رجّعه «بموافقتي»', 'Back to approval') : T('خلّه «تلقائي»', 'Switch to Auto')}</Button> : null}
            </div>
          ))}
          <p className="text-sm text-muted-foreground">{T('الزر يشغّل التنفيذ الحقيقي معه للمنصات اللي مفاتيحها موجودة. لو طلعت نتيجة إجراء تلقائي أسوأ بعد 7 أيام، يرجع الإيجنت «بموافقتي» بنفسه ونبلغك.', 'The button turns real execution on too, for the platforms whose keys are set. If an automatic action turns out worse after 7 days, the agent goes back to approval by itself and you are told.')}</p>
        </section>

        <section className="card pad grid gap-3" aria-labelledby="autoCap">
          <h2 id="autoCap" className="text-lg font-semibold">{T('سقف الصرف اليومي', 'Daily spend cap')}</h2>
          <p className="text-muted-foreground">{T(`بالريال. الحد الأعلى ${d.limits.spendCapMax.toLocaleString('en')}، وتقدر تنزّله بس.`, `In SAR. At most ${d.limits.spendCapMax.toLocaleString('en')}; it can only be lowered.`)}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1"><span className="text-sm">{T('السقف', 'Cap')}</span>
              <Input inputMode="numeric" className="min-h-11 w-40" value={cap} disabled={!can} onChange={e => setCap(e.target.value.replace(/[^\d]/g, ''))} aria-describedby="capNote" /></label>
            {can ? <Button className="min-h-11" onClick={() => void act('/api/automation/settings', 'POST', { spendCap: Number(cap) }, T('انحفظ السقف', 'Cap saved'))}>{T('احفظ', 'Save')}</Button> : null}
          </div>
          <span id="capNote" className="text-sm text-muted-foreground">{T('صرف اليوم المتوقع = صرف أمس الفعلي في كل المنصات + الزيادة المقترحة.', 'Expected spend today = yesterday’s actual spend on every platform + the proposed increase.')}</span>
        </section>

        <section className="card pad grid gap-3" aria-labelledby="autoExcluded">
          <h2 id="autoExcluded" className="text-lg font-semibold">{T('حملات يتركها', 'Campaigns it leaves alone')}</h2>
          <p className="text-muted-foreground">{T('يشتغل على كل الحملات. أضف هنا بس اللي ما تبيه يلمسها.', 'It works on every campaign. Add here only the ones it must not touch.')}</p>
          {d.excluded.length ? (
            <ul className="grid gap-2" role="list">
              {d.excluded.map(m => (
                <li key={m.platform + m.entity_id} className="flex flex-wrap items-center gap-2" data-excluded={m.entity_id}>
                  <Badge variant="secondary">{name(PLAT, m.platform)}</Badge>
                  <span className="font-medium">{m.name || m.entity_id}</span>
                  <span className="text-sm text-muted-foreground tabular-nums" dir="ltr">{m.entity_id}</span>
                  {can ? <Button variant="ghost" className="min-h-11" aria-label={T('رجّعها للتلقائي', 'Back in scope')}
                    onClick={() => void act('/api/automation/excluded', 'DELETE', { platform: m.platform, entity_id: m.entity_id }, T('رجعت', 'Back in scope'))}><Trash2 /></Button> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-muted-foreground" data-empty>{T('ما فيه استثناءات: يشتغل على كل الحملات.', 'No exceptions: it works on every campaign.')}</p>}
          {can && !d.missing ? (
            <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void act('/api/automation/excluded', 'POST', add, T('انضافت للاستثناءات', 'Excluded')).then(() => setAdd(a => ({ ...a, entity_id: '', name: '' }))); }}>
              <label className="grid gap-1"><span className="text-sm">{T('المنصة', 'Platform')}</span>
                <select className="min-h-11 rounded-md border bg-background px-2" value={add.platform} onChange={e => setAdd(a => ({ ...a, platform: e.target.value as 'meta' | 'snapchat' }))}>
                  <option value="meta">{name(PLAT, 'meta')}</option><option value="snapchat">{name(PLAT, 'snapchat')}</option></select></label>
              <label className="grid gap-1"><span className="text-sm">{T('رقم الحملة', 'Campaign ID')}</span>
                <Input className="min-h-11 w-48" dir="ltr" required value={add.entity_id} onChange={e => setAdd(a => ({ ...a, entity_id: e.target.value.trim() }))} /></label>
              <label className="grid gap-1"><span className="text-sm">{T('الاسم (اختياري)', 'Name (optional)')}</span>
                <Input className="min-h-11 w-48" value={add.name} onChange={e => setAdd(a => ({ ...a, name: e.target.value }))} /></label>
              <Button type="submit" className="min-h-11"><Plus />{T('استثنِ', 'Exclude')}</Button>
            </form>
          ) : null}
        </section>
        <Toaster />
      </div>
    </Direction.Provider>
  );
}
