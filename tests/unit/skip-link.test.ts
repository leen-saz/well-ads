import { describe, expect, it } from 'vitest';
// @ts-expect-error node types are not installed in this project; vitest itself runs on node
import { readFileSync } from 'node:fs';

// WCAG 2.4.1 Bypass Blocks: a keyboard user reaches the main content without tabbing through the whole sidebar.
// router.js runs on every Astro page, so it adds the first link of the page; app.css shows it only while focused.
const router: string = readFileSync('public/assets/router.js', 'utf8');
const css: string = readFileSync('public/assets/app.css', 'utf8');
const pages = import.meta.glob('../../src/{pages,modules}/**/*.astro', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('skip link', () => {
  it('router adds it in front of the page, pointing at #content', () => {
    expect(router).toContain(`a.href = '#content'`);
    expect(router).toContain('document.body.prepend(a)');
    expect(router).toMatch(/skipLink\(\);\s*const name/);
  });
  it('is hidden until focused and sits above the sidebar', () => {
    expect(css).toMatch(/\.skip-link\{[^}]*transform:translateY\(-200%\)/);
    expect(css).toMatch(/\.skip-link:focus\{transform:none\}/);
  });
  it('every Astro page with a sidebar and a main region names it content (sign-in pages have no sidebar)', () => {
    const bad = Object.entries(pages).filter(([f, h]) => !/\/(login|reset|welcome)\//.test(f) && /<main\b/.test(h) && !/<main[^>]*id="content"/.test(h)).map(([f]) => f);
    expect(bad).toEqual([]);
  });
});
