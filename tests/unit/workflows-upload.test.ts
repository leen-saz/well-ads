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

// The health step must run even when a step before it failed: otherwise an early failure hides the check (docs/system-workflow-review.md 1.1)
describe('refresh.yml health step', () => {
  const text = Object.entries(FILES).find(([p]) => p.endsWith('/refresh.yml'))?.[1] ?? '';
  it('runs with if: always()', () => {
    const at = text.indexOf('- name: Data health');
    expect(at).toBeGreaterThan(0);
    expect(text.slice(at, at + 200)).toMatch(/if: always\(\)/);
  });
});
