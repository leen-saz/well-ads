// The sidebar shows each place once: no two entries share a label or open the same view.
// Production has four entries (text, design, voice and video, library). Measure keeps its own entries (the performance summary
// and the creatives pages are untouched). What a user cannot open is not shown, and what is off for the company folds into one row.
import { describe, expect, it } from 'vitest';
import { sections, isHere, groupNav, navHtml, boardActive } from '../../public/assets/sidebar.js';
import { MODULES, sectionsOf } from '../../src/modules/registry';
import { need } from '../../src/lib/gate';

type Item = { href: string; text: string; key: string; state: string; also?: string[] };
const L = (ar: string) => ar;
const me = (over: { off?: string[]; role?: string; no?: string[]; dashboards?: string[] } = {}) => ({
  role: over.role ?? 'owner', email: 'o@x', dashboards: over.dashboards ?? ([] as string[]),
  modules: MODULES.map(m => ({ ...m, ok: !(over.no ?? []).includes(m.key), locked: (over.off ?? []).includes(m.key) })),
});
const secs = (m: ReturnType<typeof me>) => sections(m, L) as { key: string; label: string; items: Item[] }[];
const items = (m: ReturnType<typeof me>) => secs(m).flatMap(s => s.items);
// The summary and the creatives exist as Overview pages and as dashboard views; the ads board (/) is its own page next to the Overview summary
const SAME: Record<string, string> = {};

describe('sidebar', () => {
  for (const [name, m] of [['Overview on', me()], ['Overview off', me({ off: ['overview'] })]] as const) {
    it(`has no repeated label or view (${name})`, () => {
      const list = items(m);
      const dup = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
      expect(dup(list.map(i => i.text))).toEqual([]);
      expect(dup(list.map(i => i.href))).toEqual([]);
      // The Overview pages and the dashboard's are the same views at different links
      const view = (h: string) => SAME[h] ?? h;
      expect(dup(list.map(i => view(i.href)))).toEqual([]);
    });
  }
  it('puts overview, platforms and campaigns, departments, creatives and listening in one Measure group, in that order', () => {
    const order = ['نظرة عامة', 'المنصات والحملات', 'الأقسام', 'المواد الإعلانية', 'الرصد'];
    for (const m of [me(), me({ off: ['overview'] })]) expect(secs(m).find(s => s.key === 'measure')!.items.map(i => i.text)).toEqual(order);
    const on = items(me()), off = items(me({ off: ['overview'] }));
    // the old second board entry and the separate creatives page are gone
    expect(on.some(i => i.text === 'لوحة الإعلانات' || i.text === 'ملخص الأداء')).toBe(false);
    expect(on.find(i => i.text === 'نظرة عامة')?.href).toBe('/overview/');
    expect(off.find(i => i.text === 'نظرة عامة')?.href).toBe('/');
    for (const m of [on, off]) {
      expect(m.find(i => i.text === 'المنصات والحملات')?.href).toBe('/?p=channels');
      expect(m.find(i => i.text === 'الأقسام')?.href).toBe('/?p=depts');
      expect(m.find(i => i.text === 'المواد الإعلانية')?.href).toBe('/?view=creative');
    }
  });
  it('offers a Measure item only to a user who can open it (no item that answers 403)', () => {
    const tabs = (d: string[], extra: object = {}) => secs({ ...me({ role: 'member', dashboards: d }), ...extra } as ReturnType<typeof me>).find(s => s.key === 'measure')?.items.map(i => i.text);
    expect(tabs(['ceo', 'creative'])).toEqual(['نظرة عامة', 'المنصات والحملات', 'الأقسام', 'المواد الإعلانية', 'الرصد']);
    expect(tabs(['creative'])).toEqual(['المواد الإعلانية', 'الرصد']);
    expect(tabs(['ceo'])).toEqual(['نظرة عامة', 'المنصات والحملات', 'الأقسام', 'الرصد']);
    expect(tabs([])).toEqual(['الرصد']);
    // a department manager's numbers are theirs: the all-departments summary would answer 403, so the board's overview opens instead
    const dept = secs({ ...me({ role: 'member', dashboards: ['ceo'] }), departments: ['brand'] } as ReturnType<typeof me>).find(s => s.key === 'measure')!.items;
    expect(dept.find(i => i.text === 'نظرة عامة')?.href).toBe('/');
    // the creatives and board views light their own items
    expect(isHere(items(me()).find(i => i.text === 'المواد الإعلانية')!, 'creative')).toBe(true);
    expect(isHere(items(me()).find(i => i.text === 'نظرة عامة')!, 'ceo')).toBe(true);
    expect(isHere(items(me()).find(i => i.text === 'المنصات والحملات')!, 'board:channels')).toBe(true);
  });
  it('knows which board view is open from the address', () => {
    expect(boardActive('/', '')).toBe('ceo');
    expect(boardActive('/', '?p=channels')).toBe('board:channels');
    expect(boardActive('/', '?p=depts&lang=en')).toBe('board:depts');
    expect(boardActive('/', '?view=creative')).toBe('creative');
    expect(boardActive('/creative/', '')).toBe('creative');
  });
  it('highlights an entry on the page it stands for', () => {
    expect(isHere({ key: 'soon:a', also: ['social', 'journeys'] }, 'social')).toBe(true);
    expect(isHere({ key: 'control' }, 'control')).toBe(true);
    expect(isHere({ key: 'control' }, 'social')).toBe(false);
  });
});

describe('sidebar groups', () => {
  it('follows the working order: create, publish, measure, decide, system', () => {
    expect(secs(me()).map(s => s.key)).toEqual(['home', 'produce', 'distribute', 'measure', 'optimize', 'system']);
    expect(secs(me()).map(s => s.label)).toEqual(['أحلم', 'الإنتاج', 'النشر', 'القياس', 'القرارات', 'النظام']);
  });
  it('shows four Production entries: text, design, voice and video, and the library', () => {
    const produce = secs(me()).find(s => s.key === 'produce')!.items.map(i => i.text);
    expect([...produce].sort()).toEqual(['التصميم', 'المكتبة', 'صوت وفيديو', 'نص'].sort());
  });
  it('puts every remaining tab in its group', () => {
    const at = Object.fromEntries(secs(me()).flatMap(s => s.items.map(i => [i.text, s.key])));
    expect(at).toMatchObject({
      'المعرفة': 'system', 'الامتثال': 'system', 'الربط': 'system', 'السجل': 'system', 'المستخدمون': 'system',
      'التصميم': 'produce', 'نص': 'produce', 'صوت وفيديو': 'produce',
      'السوشال': 'distribute', 'الرحلات والرسائل': 'distribute',
      'نظرة عامة': 'measure', 'المواد الإعلانية': 'measure', 'الرصد': 'measure',
      'لوحة القرارات': 'optimize', 'المدير': 'optimize', 'التتبع': 'optimize',
    });
  });
  it('hosts sections: vision in design, transcribe and video in voice, voiceover in voice, copy in content', () => {
    expect(sectionsOf('design')).toEqual(['vision']);
    expect(sectionsOf('voice').sort()).toEqual(['transcribe', 'video', 'voiceover']);
    expect(sectionsOf('content')).toEqual(['copy']);
    // none of the sections has an entry of its own
    for (const k of ['vision', 'transcribe', 'video', 'voiceover', 'copy']) expect(items(me()).some(i => i.key === k), k).toBe(false);
  });
  it('does not show a tab the user cannot open, and not its sections either', () => {
    const m = me({ no: ['social', 'voice', 'voiceover', 'transcribe', 'video'] });
    expect(items(m).some(i => i.key === 'social')).toBe(false);
    expect(items(m).some(i => i.key === 'voice')).toBe(false);
    // Only a section is allowed: the host entry opens that section
    const only = me({ no: ['voice', 'voiceover', 'transcribe'] });
    const host = items(only).find(i => i.key === 'voice');
    expect(host?.href).toBe('/voice/?tab=video');
    expect(host?.state).toBe('ok');
  });
  it('folds what is off for the company into one quiet row, with no locked rows', () => {
    const list = items(me({ off: ['social', 'journeys'] }));
    expect(list.some(i => i.state === 'locked' || i.state === 'noaccess')).toBe(false);
    expect(list.some(i => i.key === 'social')).toBe(false);
    const row = list.filter(i => i.key.startsWith('soon:'));
    expect(row).toHaveLength(1);
    expect(row[0]!.also).toEqual(expect.arrayContaining(['social', 'journeys']));
    expect(row[0]!.href).toMatch(/^\/soon\/\?t=(social|journeys)&why=locked$/);
  });
  it('shows no folded row when nothing is off', () => {
    expect(items(me()).some(i => i.key.startsWith('soon:'))).toBe(false);
  });
  it('shows owner-only Users to the owner only', () => {
    expect(secs(me({ role: 'member' })).flatMap(s => s.items).some(i => i.key === 'admin')).toBe(false);
    expect(items(me()).find(i => i.key === 'admin')?.text).toBe('المستخدمون');
  });
});

describe('old addresses and sections reach the gate', () => {
  it('asks for the section module, not the host, on ?tab=', () => {
    expect(need('/design/', '?tab=vision')).toBe('vision');
    expect(need('/voice/', '?tab=transcribe')).toBe('transcribe');
    expect(need('/voice/', '?tab=video')).toBe('video');
    expect(need('/voice/', '?tab=voiceover')).toBe('voiceover');
    expect(need('/content/', '?tab=copy')).toBe('copy');
    // an unknown section falls back to the host's own access
    expect(need('/voice/', '?tab=nonsense')).toBe('voice');
  });
  it('keeps the old section addresses and the performance addresses working', () => {
    for (const p of ['/vision/', '/transcribe/', '/video/', '/voiceover/', '/copy/']) expect(need(p, ''), p).not.toBeNull();
    // The performance pages are untouched: same addresses, same access
    expect(need('/performance', '')).toBe('any');
    expect(need('/creative/', '')).toBe('creative');
    expect(need('/overview/creative/', '')).toBe('any'); // redirects to /?view=creative
    expect(need('/listening/', '')).toBe('listening');
    expect(need('/', '?view=creative')).toBe('creative');
  });
});

describe('one list of groups', () => {
  it('every module sits in a group of the shared list, and each group has a tab', async () => {
    const { GROUPS } = await import('../../src/modules/registry');
    const keys = GROUPS.map(g => g.key);
    expect(keys).toEqual(['home', 'produce', 'distribute', 'measure', 'optimize', 'system']);
    for (const m of MODULES) expect(keys, m.key).toContain(m.group);
  });
});

describe('sidebar groups with their tools under them', () => {
  type Item2 = { key: string; text: string; href: string; on: boolean };
  type Entry = { key: string; href: string; on: boolean; multi: boolean; items: Item2[] };
  const nav = (m: ReturnType<typeof me>, active: string) => groupNav(secs(m), active) as { cur?: { key: string }; entries: Entry[] };
  const esc = (x: unknown) => String(x);
  const html = (m: ReturnType<typeof me>, active: string) => navHtml(nav(m, active).entries, { item: 'navi', icon: 'i', L, esc });
  it('has one sidebar entry per group, opening the first tool of the group', () => {
    const { entries } = nav(me(), 'today');
    expect(entries.map(e => e.key)).toEqual(['home', 'produce', 'distribute', 'measure', 'optimize', 'system']);
    expect(entries.find(e => e.key === 'measure')!.href).toBe('/overview/');
    expect(entries.find(e => e.key === 'optimize')!.href).toBe('/control/');
  });
  it('lights the group and the open item while one of its tools is open', () => {
    const n = nav(me(), 'board:channels');
    expect(n.cur?.key).toBe('measure');
    expect(n.entries.filter(e => e.on).map(e => e.key)).toEqual(['measure']);
    expect(n.entries.find(e => e.key === 'measure')!.items.map(i => i.text)).toEqual(['نظرة عامة', 'المنصات والحملات', 'الأقسام', 'المواد الإعلانية', 'الرصد']);
    const h = html(me(), 'board:channels');
    expect(h.match(/aria-current="page"/g)).toHaveLength(1);
    expect(h).toMatch(/href="\/\?p=channels"[^>]*aria-current="page"/);
    // the group is open and its head says so
    expect(h).toMatch(/aria-expanded="true" aria-controls="nv-measure"/);
    expect(h).toMatch(/aria-expanded="false" aria-controls="nv-produce"/);
  });
  it('draws a group with several tools as an expanding entry, and a group with one tool as a plain entry', () => {
    const h = html(me({ no: ['journeys'] }), 'today');
    expect(h).toContain('class="navi nv-h"');
    expect(h).toMatch(/class="navi nv-p" href="\/social\/"/);
    expect(h).not.toMatch(/aria-controls="nv-distribute"/);
    // Home has one tool: a plain entry, no group header plus item
    expect(h).toMatch(/class="navi nv-p" href="\/today\/"/);
    expect(nav(me(), 'settings').cur).toBeUndefined();
    expect(h).not.toContain('gtab');
  });
  it('hides a group the user cannot open at all, and a tool the user cannot open', () => {
    const m = me({ role: 'member', no: ['social', 'journeys', 'control', 'maestro', 'debugger'], dashboards: ['today'] });
    const keys = nav(m, 'library').entries.map(e => e.key);
    expect(keys).not.toContain('distribute');
    expect(keys).not.toContain('optimize');
    const content = nav(me({ no: ['design', 'vision'] }), 'content').entries.find(e => e.key === 'produce')!;
    expect(content.items.some(i => i.key === 'design')).toBe(false);
  });
  it('a member with only the overview dashboard sees no Measure item that answers 403', () => {
    const m = me({ role: 'member', dashboards: ['overview'], no: ['listening'] });
    expect(nav(m, 'today').entries.some(e => e.key === 'measure')).toBe(false);
  });
  it('keeps what is off for the company in one quiet row inside System, never a locked row', () => {
    const n = nav(me({ off: ['social', 'journeys', 'compliance'] }), 'knowledge');
    const sys = n.entries.find(e => e.key === 'system')!;
    expect(sys.items.filter(i => i.text === 'أقسام قادمة')).toHaveLength(1);
    expect(html(me({ off: ['social', 'journeys', 'compliance'] }), 'knowledge')).toContain('class="tag"');
    expect(n.entries.some(e => e.key === 'distribute')).toBe(false);
  });
});
