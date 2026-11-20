// Deploy guard (docs/PRD.md §3.10, milestone M2): a production deploy stops when a tracked migration file is not applied
// to the database yet, so code that needs a new table never goes live before its SQL. Run by .github/workflows/deploy.yml
// before the build. Reads src/lib/migrations-list.ts (the list a unit test keeps equal to supabase/migrations) and the
// public.schema_migrations table (docs/migrations.md). Prints file names only; never a key, URL or row content.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** File names in migrations-list.ts, and the last file that is NOT tracked (applied before schema_migrations existed). */
export function parseList(src) {
  const body = src.slice(src.indexOf('MIGRATIONS'), src.indexOf('];'));
  const files = [...body.matchAll(/'(\d{3}_[a-z0-9_]+\.sql)'/g)].map(m => m[1]);
  const after = /TRACKED_AFTER\s*=\s*'([^']+)'/.exec(src)?.[1];
  if (!files.length || !after || !files.includes(after)) throw new Error('migrations-list.ts could not be read');
  return { files, after };
}

/** The tracked files with no row in schema_migrations. */
export function missingMigrations({ files, after }, appliedNames) {
  const have = new Set(appliedNames);
  return files.slice(files.indexOf(after) + 1).filter(f => !have.has(f));
}

async function main() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    console.log('::error title=migrations::SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set for this environment, so the migrations cannot be checked');
    process.exit(1);
  }
  const list = parseList(readFileSync(new URL('../src/lib/migrations-list.ts', import.meta.url), 'utf8'));
  const r = await fetch(`${url}/rest/v1/schema_migrations?select=name&limit=1000`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  if (r.status === 404) {
    console.log('::error title=migrations::033_schema_migrations.sql is not applied. Run it, then every later file, in the Supabase SQL editor (docs/migrations.md)');
    process.exit(1);
  }
  if (!r.ok) {
    console.log(`::error title=migrations::could not read schema_migrations (HTTP ${r.status}); not deploying blind`);
    process.exit(1);
  }
  const rows = await r.json();
  const missing = missingMigrations(list, Array.isArray(rows) ? rows.map(x => String(x?.name)) : []);
  if (missing.length) {
    console.log(`::error title=migrations::not applied yet: ${missing.join(', ')}. Run them in order in the Supabase SQL editor, then deploy again (docs/migrations.md)`);
    process.exit(1);
  }
  console.log(`migrations: every tracked file is applied (${list.files.length} files in the list)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
