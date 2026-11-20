import { describe, expect, it } from 'vitest';

// A button whose only content is a symbol (a bar icon, a cross, a grid) is read out as the symbol's
// Unicode name by a screen reader, and `title` does not replace content in the accessible name.
// Every such button states its own name with aria-label (WCAG 4.1.2 Name, Role, Value).
const sources = import.meta.glob(
  ['../../src/**/*.astro', '../../src/**/*.tsx', '../../public/**/*.js'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const hasWord = /[A-Za-z0-9؀-ۿ]/;

describe('symbol-only buttons have an aria-label', () => {
  it('finds the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });
  it('no button holds only a symbol without aria-label', () => {
    const bad = Object.entries(sources).flatMap(([file, text]) =>
      [...text.matchAll(/<button\b([^>]*)>([^<]{1,3})<\/button>/g)]
        .map(m => ({ attrs: m[1] ?? '', label: m[2] ?? '' }))
        .filter(b => b.label.trim() && !hasWord.test(b.label) && !b.attrs.includes('aria-label'))
        .map(b => `${file}: <button${b.attrs}>${b.label}`));
    expect(bad).toEqual([]);
  });
});
