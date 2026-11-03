// The sidebar shows each place once: no two entries share a label or open the same view.
// The performance summary and the creatives open the Overview pages only when Overview is on, else the dashboard.
import { describe, expect, it } from 'vitest';
import { sections } from '../../public/assets/sidebar.js';
import { MODULES } from '../../src/modules/registry';

type Item = { href: string; text: string; key: string; state: string };
const L = (ar: string) => ar;
const me = (over: { off?: string[]; role?: string } = {}) => ({
  role: over.role ?? 'owner', email: 'o@x', dashboards: [] as string[],
  modules: MODULES.map(m => ({ ...m, ok: true, locked: (over.off ?? []).includes(m.key) })),
});
const items = (m: ReturnType<typeof me>) => (sections(m, L) as { items: Item[] }[]).flatMap(s => s.items);

describe('sidebar', () => {
  for (const [name, m] of [['Overview on', me()], ['Overview off', me({ off: ['overview'] })]] as const) {
    it(`has no repeated label or view (${name})`, () => {
      const list = items(m);
      const dup = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
      expect(dup(list.map(i => i.text))).toEqual([]);
      expect(dup(list.map(i => i.href))).toEqual([]);
    });
  }
  it('opens the Overview pages when Overview is on, the dashboard when it is off', () => {
    const on = items(me()), off = items(me({ off: ['overview'] }));
    expect(on.find(i => i.text === 'ملخص الأداء')?.href).toBe('/overview/');
    expect(on.find(i => i.text === 'المواد الإعلانية')?.href).toBe('/overview/creative/');
    expect(off.find(i => i.text === 'ملخص الأداء')?.href).toBe('/');
    expect(off.find(i => i.text === 'المواد الإعلانية')?.href).toBe('/?view=creative');
    expect(off.some(i => i.href.startsWith('/overview'))).toBe(false);
  });
});
