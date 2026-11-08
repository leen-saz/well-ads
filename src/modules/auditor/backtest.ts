// Part 3: replay the judge over past periods of the stored daily data and count where it would have been wrong or silent.
// Windows of `len` days stepping `hop` days back from the last day; each is judged and audited as if it were the live period.
// COUNTS ONLY: no figure, name or date leaves this function (the repo is public, the logs are not private).
import type { Dash } from '../overview/numbers';
import { type Raw, dayAdd } from './facts';
import { claimFromJudge } from './adapter';
import { audit } from './audit';
import { type AuditConfig, DEFAULT_CONFIG } from './contract';

export interface Backtest {
  windows: number;               // periods replayed
  said: { problem: number; ok: number };
  confirmed: number; weakened: number; contradicted: number;
  silent: number;                // «no problem» while the auditor contradicts it (silence that was wrong)
  wrong: number;                 // a problem named while the auditor contradicts it
  flips: number;                 // consecutive windows where the named step changed
  skipped: number;               // windows with no data
  byCheck: Record<string, number>;
}

export function backtest(d: Dash & Raw, last: string, opt: { len?: number; hop?: number; back?: number } = {}, cfg: AuditConfig = DEFAULT_CONFIG): Backtest {
  const len = opt.len ?? 14, hop = opt.hop ?? 7, back = opt.back ?? 90;
  const start = d.range?.start ?? dayAdd(last, -365);
  const out: Backtest = { windows: 0, said: { problem: 0, ok: 0 }, confirmed: 0, weakened: 0, contradicted: 0, silent: 0, wrong: 0, flips: 0, skipped: 0, byCheck: {} };
  let prev: string | null | undefined;
  // Oldest first, so «flips» reads forward in time. Each window also needs its comparison period inside the data.
  const ends: string[] = [];
  for (let to = last; to >= dayAdd(last, -back) && dayAdd(to, -(2 * len - 1)) >= start; to = dayAdd(to, -hop)) ends.unshift(to);
  for (const to of ends) {
    const from = dayAdd(to, -(len - 1));
    const c = claimFromJudge(d, from, to);
    if (!c.steps.some(s => s.now != null)) { out.skipped++; continue; }
    const r = audit(d, c, cfg);
    out.windows++;
    const problem = c.verdict.level !== 'ok' && c.verdict.step != null;
    out.said[problem ? 'problem' : 'ok']++;
    out[r.status]++;
    if (r.status === 'contradicted') out[problem ? 'wrong' : 'silent']++;
    for (const f of r.verdict.findings) if (f.effect !== 'info') out.byCheck[f.id] = (out.byCheck[f.id] ?? 0) + 1;
    if (prev !== undefined && prev !== c.verdict.step) out.flips++;
    prev = c.verdict.step;
  }
  return out;
}
