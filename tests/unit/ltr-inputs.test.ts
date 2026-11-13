import { describe, expect, it } from 'vitest';
// @ts-expect-error node types are not installed in this project; vitest itself runs on node
import { readFileSync } from 'node:fs';

// An email or a link is always written left to right. In a right-to-left page a field without dir="ltr"
// moves the "@" or "." being typed to the wrong end of the text until the next letter arrives.
// Every such field in the shared pages therefore states its own direction in the markup.
const pages = import.meta.glob('../../src/pages/**/*.astro', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('email and link fields are left to right', () => {
  it('finds the pages', () => {
    expect(Object.keys(pages).length).toBeGreaterThan(5);
  });
  it('every email or url input in src/pages has dir="ltr"', () => {
    const missing = Object.entries(pages).flatMap(([file, html]) =>
      (html.match(/<input[^>]*type="(?:email|url)"[^>]*>/g) ?? []).filter(tag => !tag.includes('dir="ltr"')).map(tag => `${file}: ${tag}`));
    expect(missing).toEqual([]);
  });
  it('the campaign launch form marks its link fields too', () => {
    const js: string = readFileSync('public/assets/launch.js', 'utf8');
    expect(js).toContain(`f.type === 'url' ? ' dir="ltr"' : ''`);
  });
});
