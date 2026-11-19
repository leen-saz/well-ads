// The one token source and the theme switch (docs/PRD.md §4.2-4.3, milestone M1)
import { describe, expect, it } from 'vitest';
// Vitest returns an empty string for a .css import (even with ?raw), so the stylesheets are read from disk.
// @ts-expect-error node types are not installed in this project; vitest itself runs on node
import { readFileSync } from 'node:fs';
import { themeOf } from '../../src/lib/theme';

const tokens: string = readFileSync('public/assets/tokens.css', 'utf8');
const app: string = readFileSync('public/assets/app.css', 'utf8');
const ui: string = readFileSync('src/styles/ui.css', 'utf8');

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

describe('theme cookie', () => {
  it('reads light, dark and system, and falls back to light for anything else', () => {
    expect(themeOf(null)).toBe('light');
    expect(themeOf('a=1; well-theme=dark')).toBe('dark');
    expect(themeOf('well-theme=system')).toBe('system');
    expect(themeOf('well-theme=<script>')).toBe('light');
    expect(themeOf('xwell-theme=dark')).toBe('light');
  });
});

describe('tokens.css', () => {
  const light = block(':root{'), dark = block(':root[data-theme="dark"]'), system = block(':root[data-theme="system"]');

  it('keeps the light colours the site had (no visual change)', () => {
    expect(light['--background']).toBe('#F1EEFA');
    expect(light['--paper']).toBe('#FFFFFF');
    expect(light['--brand-purple']).toBe('#7E57FD');
    expect(light['--brand-indigo']).toBe('#1D1069');
  });

  it('«match device» dark is exactly the chosen dark', () => {
    expect(system).toEqual(dark);
  });

  it('dark text pairs pass WCAG AA (4.5:1)', () => {
    expect(ratio(dark['--foreground']!, dark['--background']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark['--foreground']!, dark['--paper']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark['--on-primary']!, dark['--primary']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark['--primary']!, dark['--paper']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark['--on-inverse']!, dark['--inverse']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark['--warn-fg']!, dark['--warn-bg']!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('one source', () => {
  it('app.css has no colour of its own (only black in masks)', () => {
    expect([...app.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map(m => m[0]).filter(c => c !== '#000')).toEqual([]);
    expect(app).not.toMatch(/rgba\(255,\s*255,\s*255/);
  });
  it('ui.css reads its colours from the tokens', () => {
    const root = ui.slice(ui.indexOf(':root {'), ui.indexOf('}', ui.indexOf(':root {')));
    expect(root).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });
});
