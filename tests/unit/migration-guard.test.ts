// The production deploy guard (scripts/check-migrations.mjs, milestone M2)
import { describe, expect, it } from 'vitest';
// @ts-expect-error node types are not installed in this project; vitest itself runs on node
import { readFileSync } from 'node:fs';
import { parseList, missingMigrations } from '../../scripts/check-migrations.mjs';
import { MIGRATIONS, TRACKED_AFTER } from '../../src/lib/migrations-list';

const src: string = readFileSync('src/lib/migrations-list.ts', 'utf8');
const wf: string = readFileSync('.github/workflows/deploy.yml', 'utf8');

describe('migration deploy guard', () => {
  it('reads the same list the app uses', () => {
    const l = parseList(src);
    expect(l.files).toEqual([...MIGRATIONS]);
    expect(l.after).toBe(TRACKED_AFTER);
  });
  it('lists only tracked files that have no row', () => {
    const l = { files: ['031_a.sql', '032_b.sql', '033_c.sql', '034_d.sql', '035_e.sql'], after: '032_b.sql' };
    expect(missingMigrations(l, ['033_c.sql', '035_e.sql'])).toEqual(['034_d.sql']);
    expect(missingMigrations(l, ['033_c.sql', '034_d.sql', '035_e.sql'])).toEqual([]);
    expect(missingMigrations(l, [])).toEqual(['033_c.sql', '034_d.sql', '035_e.sql']);
  });
  it('runs in deploy.yml before the production build', () => {
    const guard = wf.indexOf('node scripts/check-migrations.mjs'), build = wf.indexOf('- name: Build for');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(build);
    expect(wf).toContain("if: env.TARGET == 'production'");
  });
});
