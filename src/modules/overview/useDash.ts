// /api/overview/data (the same /dash.json as the main dashboard), shared by the overview and creative pages
import * as React from 'react';
import type { Dash } from './numbers';

// dash.json sends the rows column-wise (pipeline/dash_split.py): back to [key, day, spend, impr, clicks, leads, conv]
type RowsCols = { k: string[]; d: string[]; c: number[][] };
export function withRows(d: Dash & { rows_cols?: RowsCols }): Dash {
  const rc = d.rows_cols;
  if (!rc) return d;
  const { k, d: days, c } = rc;
  const rows: unknown[][] = new Array(c[0]?.length ?? 0);
  for (let i = 0; i < rows.length; i++) rows[i] = [k[c[0]![i]!], days[c[1]![i]!], c[2]![i], c[3]![i], c[4]![i], c[5]![i], c[6]![i]];
  const rest: Dash & { rows_cols?: RowsCols } = { ...d, rows };
  delete rest.rows_cols;
  return rest;
}

export function useDash(): { data: Dash | null; error: string } {
  const [data, setData] = React.useState<Dash | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let on = true;
    fetch('/api/overview/data', { credentials: 'same-origin' })
      .then(async r => (r.ok ? (r.json() as Promise<Dash>) : Promise.reject(new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || 'ما قدرت أجيب الأرقام. حاول مرة ثانية'))))
      .then(d => { if (on) setData(withRows(d)); })
      .catch((e: Error) => { if (on) setError(e.message); });
    return () => { on = false; };
  }, []);
  return { data, error };
}
