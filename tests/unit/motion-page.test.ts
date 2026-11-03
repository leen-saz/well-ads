// The motion video page script reaches its elements by id before the sidebar is drawn: one missing id stopped
// the whole page (the form was looked up as #nf, the page calls it #new). Every id the script uses must be on the page.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import js from '../../public/modules/motion/client.js?raw';
import page from '../../src/modules/design/VideoPage.astro?raw';

describe('motion video page', () => {
  it('has every element its script looks up', () => {
    const ids = [...new Set([...js.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map(m => m[1]!))];
    expect(ids.length).toBeGreaterThan(10);
    expect(ids.filter(id => !page.includes(`id="${id}"`))).toEqual([]);
  });
});
