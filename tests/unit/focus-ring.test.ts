import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A focus ring drawn only with box-shadow disappears in forced-colors (Windows High Contrast).
// Every `outline:none` must therefore be replaced by a transparent outline, which the browser
// repaints in a system color when forced-colors is active.
describe('focus ring survives forced-colors mode', () => {
  const css = readFileSync('public/assets/app.css', 'utf8');
  it('never removes the outline outright', () => {
    expect(css).not.toMatch(/outline:\s*(none|0)\b/);
  });
  it('keeps a transparent outline on the global focus rules', () => {
    expect(css).toMatch(/:focus-visible\{outline:2px solid transparent;/);
    expect(css).toMatch(/select:focus\{outline:2px solid transparent;/);
  });
});
