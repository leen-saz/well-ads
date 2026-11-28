// Every function a migration creates pins its search_path (Supabase lint 0011), either in the create statement
// or with a later alter function. Without it the function resolves names through the caller's session path.
// Files are read through Vite (?raw): node:fs breaks typecheck.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

const found = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const all = Object.keys(found).sort().map(f => found[f]).join('\n').replace(/--.*$/gm, '');
const created = [...new Set([...all.matchAll(/create (?:or replace )?function (?:public\.)?(\w+)\s*\(([^)]*)\)([\s\S]*?)(?=\$\$\s*;|\$\$\s*\n|;)/gi)].map(m => m[1] as string))];

describe('migrations: functions pin search_path', () => {
  it('finds the functions', () => { expect(created.length).toBeGreaterThan(5); expect(created).toContain('ai_spend'); });
  for (const fn of created) {
    it(`${fn}: search_path set`, () => {
      const inCreate = new RegExp(`create (?:or replace )?function (?:public\\.)?${fn}\\s*\\([^)]*\\)[^$]*?set search_path`, 'i').test(all);
      const later = new RegExp(`alter function (?:public\\.)?${fn}\\s*\\([^)]*\\)\\s+set search_path`, 'i').test(all);
      expect(inCreate || later).toBe(true);
    });
  }
});
