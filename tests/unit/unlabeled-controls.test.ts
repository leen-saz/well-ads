import { describe, expect, it } from 'vitest';

// A form control with no label, no aria-label and no wrapping <label> has no accessible name:
// a placeholder is not a name, and a screen reader announces only "edit text" (WCAG 4.1.2 and 3.3.2).
// This guards the controls that carry a fixed id in static markup. Controls whose id is built
// from a template (`${id}`) get their <label for> next to them in the same template and are skipped.
const sources = import.meta.glob(
  ['../../src/**/*.astro', '../../public/**/*.js'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

describe('form controls have an accessible name', () => {
  it('finds the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });
  it('no static-id control lacks a label or aria-label', () => {
    const bad: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      for (const m of text.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
        const attrs = m[2] ?? '';
        if (/type="(hidden|checkbox|radio|submit|button)"/.test(attrs) || /aria-label(ledby)?=|\btitle=/.test(attrs)) continue;
        const pre = text.slice(Math.max(0, m.index - 250), m.index);
        if (pre.lastIndexOf('<label') > pre.lastIndexOf('</label>')) continue;
        const id = /\bid="([^"$]+)"/.exec(attrs)?.[1];
        if (!id) continue;
        if (text.includes(`for="${id}"`)) continue;
        bad.push(`${file}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
