// The period bar for React pages: the shared one in public/assets/period.js (the same code the Listening and Manager pages
// use), mounted into a div. The choice is kept in the address and in this browser, so a reload or a shared link keeps it.
import * as React from 'react';
import { mountPeriod } from '../../../public/assets/period.js';
import { pageLang } from './lang';

export interface Period { key: string; from: string; to: string }
export interface PeriodCtx { today: string; last: string; min: string }

export function PeriodFilter({ id, def, ctx, onChange }: { id: string; def: string; ctx: PeriodCtx; onChange: (p: Period) => void }) {
  const host = React.useRef<HTMLDivElement>(null);
  const api = React.useRef<ReturnType<typeof mountPeriod> | null>(null);
  const cb = React.useRef(onChange);
  cb.current = onChange;
  React.useEffect(() => {
    if (!host.current) return;
    api.current = mountPeriod(host.current, { id, def, ctx, lang: pageLang(), onChange: (p: Period) => cb.current(p) });
    return () => { api.current?.destroy(); api.current = null; };
    // mounted once; new bounds go through update() below
  }, []);
  React.useEffect(() => { api.current?.update(ctx); }, [ctx.today, ctx.last, ctx.min]);
  return <div ref={host} />;
}
