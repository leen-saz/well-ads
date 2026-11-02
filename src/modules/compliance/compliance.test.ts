// Compliance rules: risky health-ad wording is caught with the matching words; clean copy passes.
import { describe, expect, it } from 'vitest';
import { check, scan } from './compliance';

describe('compliance', () => {
  it('catches guaranteed results, cures, before/after and weight promises as critical', () => {
    const ids = (t: string) => check(t).map(h => h.rule);
    expect(ids('نتائج مضمونة 100% من أول جلسة')).toContain('guarantee');
    expect(ids('علاج نهائي لتساقط الشعر')).toContain('cure');
    expect(ids('خدمات تشمل علاجاً نهائياً')).toContain('cure'); // tanween and diacritics
    expect(ids('شوف قبل وبعد')).toContain('before_after');
    expect(ids('نزّل 10 كيلو بالشهر')).toContain('weight');
    expect(check('Guaranteed results')[0]?.level).toBe('critical');
  });

  it('warns on superlatives, personal health targeting, speed and refunds', () => {
    const ids = check('الأفضل في المملكة، هل تعاني من الصداع؟ النتيجة خلال أسبوع وضمان استرجاع المبلغ').map(h => h.rule);
    expect(ids).toEqual(expect.arrayContaining(['superlative', 'personal', 'speed', 'refund']));
  });

  it('asks for offer terms only when they are missing', () => {
    expect(check('خصم 30% على المحاليل').some(h => h.rule === 'discount')).toBe(true);
    expect(check('خصم 30% لين نهاية الشهر').some(h => h.rule === 'discount')).toBe(false);
  });

  it('passes clean copy and returns the matched words', () => {
    expect(check('فريقنا الطبي المرخّص يجيك البيت، احجز موعدك')).toEqual([]);
    expect(check('نتائج مضمونة')[0]?.match).toBe('مضمونة');
  });

  it('scans stored ads once per copy, worst first, and skips ads without text', () => {
    const r = scan([
      { ad_key: 'm1', platform: 'meta', name: 'A', live: true, text: 'خصم 20%' },
      { ad_key: 'm2', platform: 'meta', name: 'B', live: true, text: 'خصم 20%' },
      { ad_key: 's1', platform: 'snapchat', name: 'C', live: false, text: 'علاج نهائي' },
      { ad_key: 't1', platform: 'tiktok', name: 'D', live: true, text: '' },
    ]);
    expect(r.checked).toBe(3);
    expect(r.ads.map(a => a.ad_key)).toEqual(['s1', 'm1']);
    expect(r.summary).toMatchObject({ critical: 1, info: 1 });
  });
});
