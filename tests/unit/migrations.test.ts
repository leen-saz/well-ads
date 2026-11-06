// Migration numbers: sequential, and no new duplicates (011, 013 and 014 were written in parallel and are grandfathered;
// docs/migrations.md explains why their order does not matter).
import { describe, expect, it } from 'vitest';

const files = Object.keys(import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw' })).map(p => p.split('/').pop()!).sort();
const GRANDFATHERED = new Set(['011', '013', '014']);

describe('supabase/migrations', () => {
  it('every file is NNN_name.sql', () => {
    expect(files.filter(f => !/^\d{3}_[a-z0-9_]+\.sql$/.test(f))).toEqual([]);
  });
  it('has no new duplicate number', () => {
    const count = new Map<string, string[]>();
    for (const f of files) count.set(f.slice(0, 3), [...(count.get(f.slice(0, 3)) ?? []), f]);
    const dup = [...count].filter(([n, l]) => l.length > 1 && !GRANDFATHERED.has(n)).map(([n, l]) => `${n}: ${l.join(', ')}`);
    expect(dup, 'two migrations share a number; take the next free one').toEqual([]);
    for (const n of GRANDFATHERED) expect(count.get(n)?.length, `${n} is a grandfathered pair, not a triple`).toBeLessThanOrEqual(2);
  });
  it('numbers have no gap', () => {
    const nums = [...new Set(files.map(f => Number(f.slice(0, 3))))];
    expect(nums).toEqual(nums.map((_, i) => i));
  });
});
