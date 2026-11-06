// PostgREST answers at most 1000 rows per request (a bigger `limit=` is cut silently), and pages taken with Range and
// no ORDER BY can skip or repeat rows when the table is rewritten between requests (ads and ad_metrics are, hourly).
// So every big read goes through here: the caller names a unique order, and every page is read until a short one.
import { sb, type Cfg } from './auth';

export const PAGE = 1000;

export async function readAll<T>(cfg: Cfg, path: string, order: string, max = 20): Promise<{ ok: boolean; rows: T[]; full: boolean }> {
  if (/[?&]order=/.test(path)) throw new Error('readAll sets the order itself');
  const url = `${path}${path.includes('?') ? '&' : '?'}order=${order}`;
  const rows: T[] = [];
  for (let i = 0; i < max; i++) {
    const r = await sb<T[]>(cfg, url, { admin: true, headers: { 'Range-Unit': 'items', Range: `${i * PAGE}-${i * PAGE + PAGE - 1}` } });
    if (!r.ok || !Array.isArray(r.data)) return { ok: i > 0, rows, full: false };
    rows.push(...r.data);
    if (r.data.length < PAGE) return { ok: true, rows, full: true };
  }
  return { ok: true, rows, full: false };   // stopped at `max` pages: the caller can say the list is cut
}
