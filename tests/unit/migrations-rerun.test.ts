// docs/migrations.md promises every migration is idempotent (re-running it in the SQL Editor is safe).
// This test enforces it per file: a statement that errors on the second run fails here, before it reaches the database.
// Files are read through Vite (?raw): node:fs breaks typecheck.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

const found = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// 000_base predates the rule: its three policies are dropped by 021, and the base schema is applied once
const GRANDFATHERED_POLICY = new Set(['000_base.sql']);
const strip = (s: string) => s.replace(/--.*$/gm, '').replace(/\$\$[\s\S]*?\$\$/g, '$$$$');

/** Statements that raise an error when the object already exists (or is already gone). */
function rerunViolations(file: string, raw: string): string[] {
  const sql = strip(raw);
  const out: string[] = [];
  const check = (re: RegExp, why: string) => { for (const m of sql.matchAll(re)) out.push(`${file}: ${why}: ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`); };
  check(/create\s+(?:unlogged\s+)?table\s+(?!if\s+not\s+exists)[\w.]+/gi, 'create table without if not exists');
  check(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?!if\s+not\s+exists)\w+/gi, 'create index without if not exists');
  check(/add\s+column\s+(?!if\s+not\s+exists)\w+/gi, 'add column without if not exists');
  check(/drop\s+(?:table|index|column|constraint|policy|trigger)\s+(?!if\s+exists)[\w.]+/gi, 'drop without if exists');
  if (!GRANDFATHERED_POLICY.has(file)) {
    for (const m of sql.matchAll(/create\s+policy\s+(\w+)\s+on\s+(?:public\.)?(\w+)/gi)) {
      if (!new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${m[1]}\\s+on\\s+(?:public\\.)?${m[2]}`, 'i').test(sql)) out.push(`${file}: create policy ${m[1]} without a drop policy if exists before it`);
    }
  }
  for (const m of sql.matchAll(/create\s+trigger\s+(\w+)\s+[\s\S]*?\bon\s+(?:public\.)?(\w+)/gi)) {
    if (!new RegExp(`drop\\s+trigger\\s+if\\s+exists\\s+${m[1]}\\s+on\\s+(?:public\\.)?${m[2]}`, 'i').test(sql)) out.push(`${file}: create trigger ${m[1]} without a drop trigger if exists before it`);
  }
  return out;
}

describe('migrations are safe to run twice', () => {
  const files = Object.keys(found).sort();
  it('finds the files', () => expect(files.length).toBeGreaterThan(30));
  for (const f of files) {
    const name = f.split('/').pop()!;
    it(name, () => expect(rerunViolations(name, found[f] as string)).toEqual([]));
  }
  it('the check itself catches the usual mistakes', () => {
    const bad = `create table t (id int);\ncreate index t_i on t (id);\nalter table t add column c int;\ndrop table t;\ncreate policy p on t for select using (true);`;
    expect(rerunViolations('x.sql', bad).length).toBe(5);
    expect(rerunViolations('x.sql', `create table if not exists t (id int);\ncreate index if not exists t_i on t (id);\nalter table t add column if not exists c int;\ndrop table if exists t;\ndrop policy if exists p on t;\ncreate policy p on t for select using (true);`)).toEqual([]);
  });
});
