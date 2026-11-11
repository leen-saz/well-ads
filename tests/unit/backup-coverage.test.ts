// Every table a migration creates (and does not drop) is in supabase/backup.py TABLES, or in SKIPPED with a reason there.
// Found missing on 2026-11-11: 12 tables added after the list was written (AI usage, campaigns, library, voiceover…).
// Files are read through Vite (?raw): node:fs breaks typecheck.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import backup from '../../supabase/backup.py?raw';

const found = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sql = Object.keys(found).sort().map(f => (found[f] as string).replace(/--.*$/gm, '')).join('\n');
const created = [...sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(/gi)].map(m => m[1] as string);
const dropped = new Set([...sql.matchAll(/drop table (?:if exists )?(?:public\.)?(\w+)/gi)].map(m => m[1] as string));
const list = (name: string) => [...(backup.match(new RegExp(`${name} = \\(([^)]*)\\)`, 's'))?.[1] ?? '').matchAll(/"(\w+)"/g)].map(m => m[1] as string);

describe('database backup coverage', () => {
  const live = [...new Set(created)].filter(t => !dropped.has(t));
  const backed = new Set(list('TABLES')), skipped = new Set(list('SKIPPED'));
  it('reads the lists', () => { expect(backed.size).toBeGreaterThan(20); expect(live.length).toBeGreaterThan(20); });
  for (const t of live) it(`${t} is backed up or skipped on purpose`, () => { expect(backed.has(t) || skipped.has(t)).toBe(true); });
  it('does not back up a table that no longer exists', () => {
    for (const t of backed) expect(live, t).toContain(t);
  });
});
