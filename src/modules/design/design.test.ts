// Design: winners come from lead ads ranked by cost per lead; copy options are parsed safely and checked for compliance.
import { describe, expect, it } from 'vitest';
import { parseVariants, prompt, templates, winners } from './design';

const ads = [
  { ad_key: 'm1', platform: 'meta', name: 'Vit C', format: 'فيديو', goal: 'lead', text: 'فيتامين سي يجيك البيت. احجز الحين' },
  { ad_key: 's1', platform: 'snapchat', name: 'IV', format: 'صورة', goal: 'lead', text: 'علاج نهائي للإرهاق' },
  { ad_key: 't1', platform: 'tiktok', name: 'Few', format: 'فيديو', goal: 'lead', text: 'x' },
  { ad_key: 'g1', platform: 'google', name: 'Brand', format: '', goal: 'other', text: 'y' },
];
const metrics = [
  { ad_key: 'm1', spend: 100, leads: 10, clicks: 50, impressions: 1000 }, { ad_key: 's1', spend: 300, leads: 6 },
  { ad_key: 't1', spend: 50, leads: 2 }, { ad_key: 'g1', spend: 999, leads: 50 },
];

describe('design', () => {
  it('ranks lead ads with 3+ leads by cost per lead and keeps their hooks', () => {
    const r = winners(ads, metrics);
    expect(r.top.map(a => a.ad_key)).toEqual(['m1', 's1']);
    expect(r.top[0]?.cpl).toBe(10);
    expect(r.hooks).toEqual(['فيتامين سي يجيك البيت']); // the cure claim is a winner but not a hook to repeat
    expect(r.formats).toEqual({ فيديو: 1, صورة: 1 });
  });

  it('parses model JSON, trims long fields, and flags risky wording', () => {
    const v = parseVariants('هذي الخيارات: [{"headline":"نتائج مضمونة","sub":"فريقنا يجيك","cta":"احجز"},{"headline":"' + 'ك'.repeat(90) + '","sub":"s","cta":"c"}]', 'o', 'a');
    expect(v).toHaveLength(2);
    expect(v[0]?.flags[0]?.title).toBe('وعد بنتيجة مضمونة');
    expect(v[1]?.headline.length).toBe(60);
  });

  it('falls back to clean templates when the model answer is unusable', () => {
    const v = parseVariants('sorry', 'جلسة فيتامين سي', 'الموظفين');
    expect(v).toHaveLength(3);
    expect(v.every(x => x.flags.length === 0)).toBe(true);
    expect(templates('', '')[0]?.headline).toBe('خدمتنا الطبية في البيت');
  });

  it('tells the model the compliance rules and the hooks that worked', () => {
    const p = prompt({ type: 'story', offer: 'محاليل', audience: 'الرياضيين', dept: '' }, ['فيتامين سي يجيك البيت']);
    expect(p).toContain('ستوري');
    expect(p).toContain('بدون ضمان نتائج');
    expect(p).toContain('فيتامين سي يجيك البيت');
  });
});
