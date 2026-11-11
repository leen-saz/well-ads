// Every table a migration creates has RLS on and is closed to the public (anon) and signed-in (authenticated) keys:
// the code reaches Supabase with the service role only. Read from the SQL files, in apply order.
// Files are read through Vite (?raw): node:fs breaks typecheck.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import doc from '../../docs/data-dictionary.md?raw';

const found = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sql = Object.keys(found).sort().map(f => `-- FILE ${f}\n${found[f]}`).join('\n');
const strip = (s: string) => s.replace(/--.*$/gm, '');
const all = strip(sql);
const tables = [...all.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(/gi)].map(m => m[1] as string);

describe('migrations: closed to anon and authenticated', () => {
  it('finds the tables', () => { expect(tables.length).toBeGreaterThan(20); expect(tables).toContain('crm_leads'); });

  for (const t of tables) {
    it(`${t}: RLS enabled`, () => {
      expect(all).toMatch(new RegExp(`alter table (?:public\\.)?${t}\\s+enable row level security`, 'i'));
    });
    it(`${t}: revoked from anon and authenticated`, () => {
      const own = new RegExp(`revoke all on (?:table )?(?:public\\.)?${t} from anon, authenticated`, 'i').test(all);
      const everything = /revoke all on all tables in schema public from anon, authenticated/i.test(all);
      expect(own || everything).toBe(true);
    });
  }

  it('no policy or grant opens a table to anon or authenticated that a later statement does not close', () => {
    // 000_base opened three tables; 021 must drop those policies and revoke after the last grant
    const lastGrant = all.toLowerCase().lastIndexOf('grant select on public.');
    const lastRevokeAll = all.toLowerCase().lastIndexOf('revoke all on all tables in schema public from anon, authenticated');
    expect(lastRevokeAll).toBeGreaterThan(lastGrant);
    for (const m of all.matchAll(/create policy (\w+) on (?:public\.)?(\w+)[^;]*?to\s+[^;]*\b(?:anon|authenticated)\b/gi)) {
      expect(all).toMatch(new RegExp(`drop policy if exists ${m[1]} on (?:public\\.)?${m[2]}`, 'i'));
    }
    // dropped means the drop comes after the create
    expect(all.indexOf('drop policy if exists ads_read', all.indexOf('create policy ads_read'))).toBeGreaterThan(-1);
  });

  it('a table that holds a company\'s rows says which company', () => {
    // Tables that are one global row set on purpose; everything else must carry company_id
    const global = new Set(['ad_metrics', 'dashboard_state', 'suggestions', 'control_settings', 'platform_activity', 'outcomes', 'crm_sync_state', 'companies', 'web_vitals', 'schema_migrations', 'site_requests' /* 027, dropped in 028: the Apipeline site moved to its own repo */]);
    for (const t of tables.filter(x => !global.has(x))) {
      const body = all.match(new RegExp(`create table (?:if not exists )?(?:public\\.)?${t}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'))?.[1] || '';
      const added = new RegExp(`alter table (?:public\\.)?${t}\\s+add column if not exists company_id`, 'i').test(all);
      expect(/\bcompany_id\b/.test(body) || added, t).toBe(true);
    }
  });

  it('the data dictionary documents every table', () => {
    for (const t of tables) expect(doc, t).toContain('`' + t + '`');
  });
});
