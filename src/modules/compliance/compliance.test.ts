// Compliance rules: one list for every tab. Real failing copy is caught with the exact phrase, its place, the rule
// and its source; clean copy passes; the company's own forbidden words count; nothing ever blocks.
import { describe, expect, it } from 'vitest';
import { check, companyRules, normalize, notice, scan } from './compliance';

const rules = (t: string) => check(t).map(h => h.rule);

describe('cure promises (the 10 texts tried on 2026-11-02; the old checker caught 3)', () => {
  const CASES: [string, string, string][] = [
    ['محلول فيتامين سي يعالج الزكام نهائياً', 'cure', 'يعالج الزكام نهائياً'],
    ['جلسات المحاليل تعالج التعب والإرهاق المزمن', 'disease', 'تعالج التعب والإرهاق'],
    ['تخلّص من الصداع النصفي للأبد مع جلستنا', 'cure', 'تخلّص من الصداع النصفي للأبد'],
    ['علاجنا يشفيك من السكري', 'cure', 'يشفيك'],
    ['ودّع آلام الظهر بدون رجعة', 'cure', 'ودّع آلام الظهر بدون رجعة'],
    ['محلول المناعة يحميك من الإنفلونزا', 'prevent', 'يحميك من الإنفلونزا'],
    ['نعالج تساقط الشعر بشكل نهائي', 'cure', 'نعالج تساقط الشعر بشكل نهائي'],
    ['علاج فعال 100% لآلام المفاصل', 'guarantee', '100%'],
    ['استعد صحتك كاملة بجلسة وحدة', 'cure', 'استعد صحتك كامل'],
    ['شفاء تام من القولون', 'cure', 'شفاء تام'],
  ];
  for (const [text, rule, match] of CASES) {
    it(text, () => {
      const h = check(text).find(x => x.rule === rule);
      expect(h, `${rule} in «${text}»`).toBeDefined();
      expect(h?.match).toBe(match);
      expect(text.slice(h!.start, h!.end)).toBe(h!.match);   // the exact place in the original text, diacritics and all
      expect(h!.source.length).toBeGreaterThan(0);
    });
  }
});

describe('the MOH guide items and the old lists, merged', () => {
  it('superlatives, testimonials, before/after and exaggerations are violations', () => {
    expect(rules('الأفضل في الرياض')).toContain('superlative');
    expect(rules('المركز الوحيد اللي يجيك البيت')).toContain('superlative');
    expect(rules('رقم 1 في المحاليل')).toContain('superlative');
    expect(rules('اقرأ تجارب المرضى معنا')).toContain('testimonial');
    expect(rules('تقول وحده من مرضانا: تغيرت حياتي')).toContain('testimonial');
    expect(rules('شوف قبل وبعد')).toContain('before_after');
    expect(rules('نتائج مثبتة علمياً وعلاج فوري')).toContain('exaggeration');
    expect(rules('شباب دائم')).toContain('exaggeration');
    expect(rules('آمن تماماً وبدون أضرار')).toContain('safety');
    expect(rules('نتائج مضمونة')).toContain('guarantee');
    expect(rules('نزّل 10 كيلو بالشهر')).toContain('weight');
    expect(rules('حبوب بدون وصفة')).toContain('no_rx');
    for (const h of check('الأفضل، تجارب المرضى، قبل وبعد')) expect(h.level).toBe('critical');
  });
  it('the words from the social and campaign lists are all caught', () => {
    for (const w of ['علاج نهائي', 'مضمون', 'شفاء تام', '100%', 'بدون أضرار', 'أفضل طبيب', 'الأرخص', 'الأفضل', 'الوحيد', 'الخبير', 'علاج فوري', 'نتائج مثبتة', 'تجارب المرضى', 'تجربة مريض'])
      expect(check(`عندنا ${w} هنا`).length, w).toBeGreaterThan(0);
  });
  it('prices need the total, offers need their terms and the ministry approval', () => {
    expect(rules('الجلسة بـ 350 ريال')).toContain('price');
    expect(rules('الجلسة بـ 350 ريال شامل الضريبة ورسوم الزيارة')).not.toContain('price');
    expect(check('خصم 30% على المحاليل').find(h => h.rule === 'discount')?.level).toBe('warn');
    expect(check('خصم 30% لين نهاية الشهر').find(h => h.rule === 'discount')?.level).toBe('info');
  });
  it('warns on personal targeting, speed, refunds, overuse and comparisons', () => {
    const ids = rules('هل تعاني من الصداع؟ النتيجة خلال أسبوع وضمان استرجاع المبلغ، وما تحتاج دكتور، مو مثل غيرنا');
    expect(ids).toEqual(expect.arrayContaining(['personal', 'speed', 'refund', 'overuse', 'better']));
  });
});

describe('precision', () => {
  it('passes clean copy', () => {
    for (const t of ['فريقنا الطبي المرخّص يجيك البيت، احجز موعدك', 'جلسات محاليل بإشراف طبي في الرياض، بعد تقييم الطبيب', 'نتمنى لك الشفاء العاجل'])
      expect(check(t), t).toEqual([]);
  });
  it('folds spelling and keeps positions on the original text', () => {
    expect(normalize('علاجاً نهائياً').t).toBe('علاجا نهائيا');
    expect(normalize('إأآى').t).toBe('اااي');
    const t = 'خدماتنا تشمل علاجاً نهائياً للصداع';
    const h = check(t)[0]!;
    expect(t.slice(h.start, h.end)).toBe('علاجاً نهائياً');
  });
  it('worst first, then by place; every hit has a fix and a line of text with its source', () => {
    const hs = check('خصم 20%، الأفضل في الرياض');
    expect(hs[0]?.rule).toBe('superlative');
    expect(notice(hs[0]!)).toContain('«الأفضل»');
    expect(notice(hs[0]!)).toContain('المرفق 10');
  });
  it("adds the company's forbidden words", () => {
    const extra = companyRules(['الأرخص', 'دكتور عالمي', ' ', 'ا']);
    expect(extra).toHaveLength(2);
    const h = check('عندنا دكتور عالمي', extra);
    expect(h[0]).toMatchObject({ level: 'critical', match: 'دكتور عالمي', title: 'كلمة ممنوعة عند الشركة' });
  });
  it('matches a company word as a whole word, with the Arabic prefixes joined to it', () => {
    const extra = companyRules(['سر']);
    const hit = (t: string) => check(t, extra).filter(h => h.rule.startsWith('company_')).map(h => h.match);
    // never inside another word
    expect(hit('توصيل سريع للبيت')).toEqual([]);
    expect(hit('سرير طبي وأسرة')).toEqual([]);
    expect(hit('السرير جاهز')).toEqual([]);
    // on its own, at the edges and next to punctuation
    expect(hit('سر')).toEqual(['سر']);
    expect(hit('هذا سر الجمال')).toEqual(['سر']);
    expect(hit('اعرف السر!')).toEqual(['سر']);
    expect(hit('«سر»، وبس')).toEqual(['سر']);
    expect(hit('سر.')).toEqual(['سر']);
    // joined prefixes (و ف ب ل ك ال): the word is still there, and the hit starts at it
    expect(hit('بالسر نقولك')).toEqual(['سر']);
    expect(hit('والسر في الخلطة')).toEqual(['سر']);
    expect(hit('فالسر بسيط')).toEqual(['سر']);
    // a suffix makes another word: not matched (see companyRules)
    expect(hit('سرها بسيط')).toEqual([]);
  });
  it('keeps the position of a prefixed hit on the phrase itself', () => {
    const [h] = check('عرض بالأرخص اليوم', companyRules(['الأرخص'])).filter(x => x.rule.startsWith('company_'));
    expect(h).toMatchObject({ match: 'الأرخص' });
    expect('عرض بالأرخص اليوم'.slice(h!.start, h!.end)).toBe('الأرخص');
  });
  it('matches Latin words whole too', () => {
    const extra = companyRules(['best']);
    expect(check('the best care', extra).some(h => h.rule.startsWith('company_'))).toBe(true);
    expect(check('bestseller', extra).some(h => h.rule.startsWith('company_'))).toBe(false);
  });
});

describe('scan', () => {
  it('scans stored ads once per copy, worst first, and skips ads without text', () => {
    const r = scan([
      { ad_key: 'm1', platform: 'meta', name: 'A', live: true, text: 'خصم 20% لين نهاية الشهر' },
      { ad_key: 'm2', platform: 'meta', name: 'B', live: true, text: 'خصم 20% لين نهاية الشهر' },
      { ad_key: 's1', platform: 'snapchat', name: 'C', live: false, text: 'علاج نهائي' },
      { ad_key: 't1', platform: 'tiktok', name: 'D', live: true, text: '' },
    ]);
    expect(r.checked).toBe(3);
    expect(r.ads.map(a => a.ad_key)).toEqual(['s1', 'm1']);
    expect(r.summary).toMatchObject({ critical: 1, info: 1 });
  });
});
