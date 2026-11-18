// Cloudflare Cron Triggers use their own day-of-week numbering: 1-7 (1 = Sunday) or SUN-SAT. `0` is rejected at deploy
// ("invalid cron string", code 10100) and leaves the triggers half-updated: the weekly backup cron `17 2 * * 0` did exactly that.
// (GitHub's own `schedule:` accepts 0, so the workflow files are not checked here.) Files are read through Vite (?raw).
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import wrangler from '../../wrangler.jsonc?raw';
import app from '../../src/app.ts?raw';
import restoreTest from '../../.github/workflows/db-restore-test.yml?raw';

const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, '');
const cfg = JSON.parse(strip(wrangler)) as { env?: Record<string, { triggers?: { crons?: string[] } }>; triggers?: { crons?: string[] } };
const crons = [...(cfg.triggers?.crons ?? []), ...Object.values(cfg.env ?? {}).flatMap(e => e.triggers?.crons ?? [])];

const NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// One field: `*`, `*/n`, a value, a range, or a comma list of those. lo/hi are the allowed numbers, names the allowed words.
function field(f: string, lo: number, hi: number, names: string[] = [], nameBase = lo): string | null {
  const val = (v: string): number | null => {
    if (/^\d+$/.test(v)) { const n = Number(v); return n >= lo && n <= hi ? n : null; }
    const i = names.indexOf(v); return i >= 0 ? i + nameBase : null;
  };
  for (const part of f.split(',')) {
    const [range = '', step] = part.split('/');
    if (step !== undefined && !/^\d+$/.test(step)) return `bad step in "${part}"`;
    if (range === '*') continue;
    const [a = '', b, ...rest] = range.split('-');
    if (rest.length || val(a) == null || (b !== undefined && val(b) == null)) return `"${part}" is outside ${lo}-${hi}${names.length ? ' or ' + names[0] + '-' + names[names.length - 1] : ''}`;
  }
  return null;
}
export function cronProblem(c: string): string | null {
  const p = c.trim().split(/\s+/);
  if (p.length !== 5) return 'needs 5 fields';
  return field(p[0] as string, 0, 59) ?? field(p[1] as string, 0, 23) ?? field(p[2] as string, 1, 31)
    ?? field(p[3] as string, 1, 12, MONTHS) ?? field(p[4] as string, 1, 7, NAMES);
}

describe('wrangler.jsonc cron triggers use Cloudflare syntax', () => {
  // Workers Free: 5 cron triggers per account for ALL Workers (code 10072 failed a deploy). Stay well under it.
  it('uses at most 3 triggers, so the account keeps some room', () => { expect(crons.length).toBeGreaterThan(0); expect(crons.length).toBeLessThanOrEqual(3); });
  for (const c of crons) it(`"${c}" is valid`, () => { expect(cronProblem(c)).toBeNull(); });
  it('the checker rejects day-of-week 0 (the bug) and accepts SUN and 1-7', () => {
    expect(cronProblem('17 2 * * 0')).not.toBeNull();
    expect(cronProblem('17 2 * * SUN')).toBeNull();
    expect(cronProblem('17 2 * * 1')).toBeNull();
    expect(cronProblem('17 2 * * 8')).not.toBeNull();
    expect(cronProblem('*/5 * * * *')).toBeNull();
    expect(cronProblem('1 2 3')).not.toBeNull();
  });
  it('every cron string app.ts matches on is one wrangler.jsonc actually registers', () => {
    const used = [...app.matchAll(/_CRON = '([^']+)'/g)].map(m => m[1] as string);
    expect(used.length).toBeGreaterThanOrEqual(2);
    for (const u of used) expect(crons, u).toContain(u);
  });
});

describe('the monthly restore test keeps the order backup → restore', () => {
  // The Worker starts it on the 1st at 03 UTC (hourlyTasks), an hour after a Sunday backup window could have run. The workflow's own `schedule` is the
  // second path: it must not be earlier than that, or on a day when the 1st is a Sunday it tests the previous week's backup.
  it('the schedule fallback is the 1st of the month at hour 03 UTC or later', () => {
    const m = restoreTest.match(/-\s*cron:\s*"(\d+)\s+(\d+)\s+1\s+\*\s+\*"/);
    expect(m, 'a monthly cron on the 1st in db-restore-test.yml').not.toBeNull();
    expect(Number(m![2])).toBeGreaterThanOrEqual(3);
  });
});
