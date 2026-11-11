// Every workflow that uploads dash.json to R2 also uploads the parts it leaves out (pipeline/dash_split.py), and
// uploads them first, so a new dash.json never points at files that are not there (production: refresh.yml).
// Files are read through Vite (?raw): node:fs breaks typecheck.
import { describe, expect, it } from 'vitest';

const FILES = import.meta.glob<string>('../../.github/workflows/*.{yml,yaml}', { query: '?raw', import: 'default', eager: true });
const PARTS = ['dash-aud.json', 'dash-organic.json'];
const putLine = (lines: string[], name: string) => lines.findIndex(l => new RegExp(`^\\s*put ${name.replace('.', '\\.')}\\s`).test(l));

describe('dash.json uploads', () => {
  const flows = Object.entries(FILES).map(([path, text]) => ({ f: path.slice(path.lastIndexOf('/') + 1), lines: text.split('\n') }));
  const uploading = flows.filter(w => putLine(w.lines, 'dash.json') >= 0);
  it('finds the workflows that upload it (staging and production)', () => {
    expect(uploading.map(w => w.f).sort()).toEqual(['pipeline.yml', 'refresh.yml']);
  });
  for (const w of uploading) it(`${w.f} uploads ${PARTS.join(' and ')} before dash.json`, () => {
    const main = putLine(w.lines, 'dash.json');
    for (const p of PARTS) {
      const at = putLine(w.lines, p);
      expect(at, `${w.f} never uploads ${p}`).toBeGreaterThanOrEqual(0);
      expect(at, `${w.f} uploads ${p} after dash.json`).toBeLessThan(main);
    }
  });
});

// The backup holds emails and business data on a public repo: it must never be an Actions artifact, and it must stay encrypted
describe('backup workflows', () => {
  const get = (n: string) => Object.entries(FILES).find(([p]) => p.endsWith(`/${n}`))?.[1] ?? '';
  it('db-backup is scheduled, encrypted, verified before upload, and never an artifact', () => {
    const t = get('db-backup.yml');
    expect(t).toMatch(/schedule:/);
    expect(t).toMatch(/workflow_dispatch:/);
    expect(t).not.toMatch(/upload-artifact/);
    expect(t.indexOf('openssl enc -aes-256-cbc')).toBeGreaterThan(0);
    expect(t.indexOf('backup_check.py')).toBeGreaterThan(t.indexOf('openssl enc -aes-256-cbc'));
    expect(t.indexOf('r2 object put')).toBeGreaterThan(t.indexOf('backup_check.py'));
    expect(t).toMatch(/refusing to write an unencrypted dump/);
  });
  it('db-restore-test runs monthly and checks a decrypted copy of the latest backup', () => {
    const t = get('db-restore-test.yml');
    expect(t).toMatch(/cron: "\d+ \d+ 1 \* \*"/);
    expect(t).toMatch(/r2 object get .*latest\.enc/);
    expect(t).toMatch(/backup_check\.py/);
    expect(t).not.toMatch(/upload-artifact/);
  });
});
