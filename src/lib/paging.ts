// PostgREST answers at most 1000 rows per request (a bigger `limit=` is cut silently), and pages taken with Range and
// no ORDER BY can skip or repeat rows when the table is rewritten between requests (ads and ad_metrics are, hourly).
// So every big read goes through here: the caller names a unique order, and every page is read until a short one.
import { sb, type Cfg } from './auth';

export const PAGE = 1000;
// Each page gives up after this long. A hanging page would otherwise hold one of the 6 connections a Worker invocation may have
// waiting for headers and stall the whole report. A cut read comes back like an error page: the rows so far, `full: false`.
export const PAGE_TIMEOUT_MS = 15_000;

export async function readAll<T>(cfg: Cfg, path: string, order: string, max = 20): Promise<{ ok: boolean; rows: T[]; full: boolean }> {
  if (/[?&]order=/.test(path)) throw new Error('readAll sets the order itself');
  const url = `${path}${path.includes('?') ? '&' : '?'}order=${order}`;
  const rows: T[] = [];
  for (let i = 0; i < max; i++) {
    let r: Awaited<ReturnType<typeof sb<T[]>>>;
    try { r = await sb<T[]>(cfg, url, { admin: true, timeoutMs: PAGE_TIMEOUT_MS, headers: { 'Range-Unit': 'items', Range: `${i * PAGE}-${i * PAGE + PAGE - 1}` } }); }
    catch { return { ok: i > 0, rows, full: false }; }   // timed out or network error
    if (!r.ok || !Array.isArray(r.data)) return { ok: i > 0, rows, full: false };
    rows.push(...r.data);
    if (r.data.length < PAGE) return { ok: true, rows, full: true };
  }
  return { ok: true, rows, full: false };   // stopped at `max` pages: the caller can say the list is cut
}
