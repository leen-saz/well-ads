// The motion video page script reaches its elements by id before the sidebar is drawn: one missing id stopped
// the whole page (the form was looked up as #nf, the page calls it #new). Every id the script uses must be on the page.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('motion video page', () => {
  it('has every element its script looks up', () => {
    const js = readFileSync('public/modules/motion/client.js', 'utf8'), page = readFileSync('src/modules/maestro/VideoPage.astro', 'utf8');
    const ids = [...new Set([...js.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map(m => m[1]!))];
    expect(ids.length).toBeGreaterThan(10);
    expect(ids.filter(id => !page.includes(`id="${id}"`))).toEqual([]);
  });
});
