// /api/overview/data (the same /dash.json as the main dashboard), shared by the overview and creative pages
import * as React from 'react';
import type { Dash } from './numbers';

export function useDash(): { data: Dash | null; error: string } {
  const [data, setData] = React.useState<Dash | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let on = true;
    fetch('/api/overview/data', { credentials: 'same-origin' })
      .then(async r => (r.ok ? (r.json() as Promise<Dash>) : Promise.reject(new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || 'ما قدرت أجيب الأرقام. حاول مرة ثانية'))))
      .then(d => { if (on) setData(d); })
      .catch((e: Error) => { if (on) setError(e.message); });
    return () => { on = false; };
  }, []);
  return { data, error };
}
