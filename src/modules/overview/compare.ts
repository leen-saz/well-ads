// The comparison window of the overview page: the same calendar days one month back (31 Dec is compared with 30 Nov),
// and nothing at all when that window is not fully inside the data. Pure functions; the cards only draw them.
import { type Dash, addDays, holes, summarize } from './numbers';

export const NO_PREV = 'لا توجد فترة سابقة كاملة للمقارنة';
export const NO_PREV_EN = 'No complete earlier period to compare with';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const daysIn = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const span = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;

// One calendar month back; a day the earlier month does not have becomes its last day (31 Mar → 28 Feb, 31 Dec → 30 Nov)
export function monthBack(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, daysIn(py, pm))).padStart(2, '0')}`;
}

// The window to compare [from, to] with: both ends move one month back, so a period that ends on the last day of its month
// compares with the whole earlier month, which can be a day shorter or longer (31 Dec vs 30 Nov). When the start itself had
// to be clamped (29–31 Mar → 28 Feb) the window keeps the period's own length instead of collapsing to a day or two.
export function monthWindow(from: string, to: string): [string, string] | null {
  if (!DAY.test(from) || !DAY.test(to) || from > to) return null;
  const pf = monthBack(from);
  let pt = monthBack(to);
  if (pf.slice(8) !== from.slice(8)) pt = addDays(pf, span(from, to) - 1);   // the start was clamped
  return pt < pf ? null : [pf, pt];
}

export interface Compare { from: string; to: string }

// null = no valid comparison: the window starts before the data does, a platform has a gap in either window, or the earlier
// window holds no spend and no results at all (nothing to compare with, never a percentage against zero)
export function compareWindow(d: Dash, from: string, to: string): Compare | null {
  const w = monthWindow(from, to);
  if (!w) return null;
  const [pf, pt] = w;
  const start = d.range?.start;
  if (!start || pf < start) return null;
  if (holes(d, to).length || holes(d, pt).length) return null;
  const was = summarize(d, pf, pt);
  if (!(was.spend > 0) && !(was.results > 0)) return null;
  return { from: pf, to: pt };
}
