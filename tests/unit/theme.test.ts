// The one token source; content light, menus always dark (docs/PRD.md §4.2, milestone M1; Leen 2026-11-19)
import { describe, expect, it } from 'vitest';
// Vitest returns an empty string for a .css import (even with ?raw), so the stylesheets are read from disk.
// @ts-expect-error node types are not installed in this project; vitest itself runs on node
import { readFileSync } from 'node:fs';

const tokens: string = readFileSync('public/assets/tokens.css', 'utf8');
const app: string = readFileSync('public/assets/app.css', 'utf8');
const ui: string = readFileSync('src/styles/ui.css', 'utf8');
const nav: string = readFileSync('public/assets/nav.js', 'utf8');

const block = (sel: string) => {
  const i = tokens.indexOf(sel); expect(i, sel).toBeGreaterThan(-1);
  const body = tokens.slice(tokens.indexOf('{', i) + 1, tokens.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):([^;]+);/g)].map(m => [m[1], m[2]!.trim()]));
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe('tokens.css', () => {
  const light = block(':root{'), ink = block('.side,.wl-side,.menu');

  it('keeps the light colours the site had (no visual change to content)', () => {
    expect(light['--background']).toBe('#F1EEFA');
    expect(light['--paper']).toBe('#FFFFFF');
    expect(light['--brand-purple']).toBe('#7E57FD');
    expect(light['--brand-indigo']).toBe('#1D1069');
  });

  it('has no theme switch: no dark or system blocks', () => {
    expect(tokens).not.toMatch(/data-theme|prefers-color-scheme/);
  });

  it('the sidebar, the pipeline sidebar and every menu are ink surfaces', () => {
    for (const sel of ['.side', '.wl-side', '.menu', '[data-slot="dropdown-menu-content"]']) expect(tokens).toContain(sel);
    expect(ink['--paper']).toBe('#1D1069');
  });

  it('ink text pairs pass WCAG AA (4.5:1)', () => {
    expect(ratio(ink['--foreground']!, ink['--paper']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink['--on-primary']!, ink['--primary']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink['--primary']!, ink['--paper']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink['--on-inverse']!, ink['--inverse']!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('one source', () => {
  it('app.css has no colour of its own (only black in masks)', () => {
    expect([...app.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map(m => m[0]).filter(c => c !== '#000')).toEqual([]);
    expect(app).not.toMatch(/rgba\((?!76,52,180|20,10,60)/);   // only the two indigo shadows, readable in both themes
  });
  it('ui.css reads its colours from the tokens', () => {
    const root = ui.slice(ui.indexOf(':root {'), ui.indexOf('}', ui.indexOf(':root {')));
    expect(root).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });
  it('the pipeline sidebar (nav.js) reads the tokens', () => {
    const css = nav.slice(nav.indexOf("const css = document.createElement('style');"));
    expect(css).toContain('var(--paper');
    expect(css).not.toMatch(/\.wl-side\{[^}]*rgba\(255,255,255/);
  });
});
