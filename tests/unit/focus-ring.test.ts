import { describe, expect, it } from 'vitest';
// Vitest returns an empty string for a .css import (even with ?raw), so the stylesheet is read from disk.
// @ts-expect-error node types are not installed in this project; vitest itself runs on node
import { readFileSync } from 'node:fs';

const css: string = readFileSync('public/assets/app.css', 'utf8');

// A focus ring drawn only with box-shadow disappears in forced-colors (Windows High Contrast).
// Every `outline:none` must therefore be replaced by a transparent outline, which the browser
// repaints in a system color when forced-colors is active.
describe('focus ring survives forced-colors mode', () => {
  it('never removes the outline outright', () => {
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/outline:\s*(none|0)\b/);
  });
  it('keeps a transparent outline on the global focus rules', () => {
    expect(css).toMatch(/:focus-visible\{outline:2px solid transparent;/);
    expect(css).toMatch(/select:focus\{outline:2px solid transparent;/);
  });
});
