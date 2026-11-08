// A change figure always says what it compares against; nothing at all when there is no valid comparison.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Delta, VS } from './Delta';

const html = (now: number | null, was: number | null, lowerIsBetter: boolean | null) => renderToStaticMarkup(createElement(Delta, { now, was, lowerIsBetter }));
const text = (s: string) => s.replace(/<[^>]+>/g, '');

describe('overview: change figures', () => {
  it('says «عن الفترة السابقة», with the direction and the size', () => {
    expect(text(html(58.6, 100, false))).toBe(`▼ 41.4% ${VS}`);
    expect(text(html(298.7, 100, null))).toBe(`▲ 198.7% ${VS}`);
  });
  it('colours a cost drop as good news', () => {
    expect(html(40, 50, true)).toContain('text-primary');
  });
  it('shows nothing without an earlier value', () => {
    expect(html(40, null, true)).toBe('');
  });
});
