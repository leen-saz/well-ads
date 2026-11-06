// The analytics page loads the parts dash.json leaves out (pipeline/dash_split.py) after its first view. Runs the
// "extra parts" block of pipeline/dash/01-base.js with a stand-in fetch: loaded parts are merged back, and a missing
// file (404, an HTML page, broken JSON) leaves its sections saying it could not load, never "loading" forever.
// Files are read through Vite (?raw): node:fs breaks typecheck.
import { describe, expect, it } from 'vitest';
import SRC from '../../pipeline/dash/01-base.js?raw';

const BLOCK = SRC.slice(SRC.indexOf('// ---- extra parts'), SRC.indexOf('// ---- end extra parts'));

type Res = { ok: boolean; json: () => Promise<unknown> };
type Page = { D: Record<string, unknown>; EXTRA: Record<string, string>; loadExtra: (then: () => void) => Promise<void>; extraNote: (p: string) => string };
function page(D: Record<string, unknown>, files: Record<string, Res>): Page {
  const fetch = (u: string) => Promise.resolve(files[u] ?? { ok: false, json: () => Promise.reject(new Error('404')) });
  const ui = (ar: string) => ar;
  const hideOrgFb = () => {};
  return new Function('D', 'fetch', 'ui', 'hideOrgFb', `${BLOCK}; return { D, EXTRA, loadExtra, extraNote };`)(D, fetch, ui, hideOrgFb) as Page;
}
const json = (v: unknown): Res => ({ ok: true, json: () => Promise.resolve(v) });
const html: Res = { ok: true, json: () => Promise.reject(new SyntaxError('Unexpected token <')) };
const split = () => ({ extra: ['aud', 'organic'], ads: { a1: { name: 'x' }, a2: { name: 'y' } } });

describe('extra parts of dash.json', () => {
  it('merges the loaded parts back and draws again', async () => {
    const p = page(split(), { '/dash-aud.json': json({ a1: { gender: [] } }), '/dash-organic.json': json({ facebook: [] }) });
    expect(p.extraNote('aud')).toContain('يحمّل');
    let drawn = 0;
    await p.loadExtra(() => drawn++);
    expect(drawn).toBe(1);
    expect((p.D['ads'] as Record<string, Record<string, unknown>>)['a1']!['aud']).toEqual({ gender: [] });
    expect(p.D['organic']).toEqual({ facebook: [] });
    expect(p.extraNote('aud')).toBe('');
    expect(p.extraNote('organic')).toBe('');
  });
  it('a missing, HTML or broken file says it could not load, not loading forever', async () => {
    for (const bad of [undefined, html, { ok: true, json: () => Promise.resolve(null) }, json([1, 2])]) {
      const files: Record<string, Res> = { '/dash-aud.json': json({}) };
      if (bad) files['/dash-organic.json'] = bad;
      const p = page(split(), files);
      let drawn = 0;
      await p.loadExtra(() => drawn++);
      expect(drawn).toBe(1);
      expect(p.EXTRA).toEqual({ aud: 'ok', organic: 'fail' });
      expect(p.extraNote('organic')).toContain('ما قدرت أحمّل');
      expect(p.extraNote('aud')).toBe('');
    }
  });
  it('inline data (no extra) needs nothing', async () => {
    const p = page({ ads: {}, organic: {} }, {});
    expect(p.EXTRA).toEqual({ aud: 'ok', organic: 'ok' });
    let drawn = 0;
    await p.loadExtra(() => drawn++);
    expect(drawn).toBe(0);
    expect(p.extraNote('organic')).toBe('');
  });
});
