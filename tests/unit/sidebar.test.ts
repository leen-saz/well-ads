// The sidebar shows each place once: no two entries share a label or open the same view.
// Production has four entries (text, design, voice and video, library). Measure keeps its own entries (the performance summary
// and the creatives pages are untouched). What a user cannot open is not shown, and what is off for the company folds into one row.
import { describe, expect, it } from 'vitest';
import { sections, isHere } from '../../public/assets/sidebar.js';
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
const SAME: Record<string, string> = { '/overview/': '/', '/overview/creative/': '/?view=creative' };

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
  it('keeps the performance summary, creatives and listening as their own entries under Measure', () => {
    const on = items(me()), off = items(me({ off: ['overview'] }));
    expect(on.find(i => i.text === 'ملخص الأداء')?.href).toBe('/overview/');
    expect(on.find(i => i.text === 'المواد الإعلانية')?.href).toBe('/overview/creative/');
    expect(off.find(i => i.text === 'ملخص الأداء')?.href).toBe('/');
    expect(off.find(i => i.text === 'المواد الإعلانية')?.href).toBe('/?view=creative');
    const measure = secs(me()).find(s => s.key === 'measure')!.items.map(i => i.text);
    expect(measure).toEqual(['ملخص الأداء', 'المواد الإعلانية', 'الرصد']);
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
    expect(secs(me()).map(s => s.label)).toEqual(['الرئيسية', 'الإنتاج', 'النشر', 'القياس', 'القرارات', 'النظام']);
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
      'ملخص الأداء': 'measure', 'المواد الإعلانية': 'measure', 'الرصد': 'measure',
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
    expect(need('/overview/creative/', '')).toBe('overview');
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
