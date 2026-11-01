// Brand voice: dialect, sentence length, call to action, timing for voice-over, and the compliance rules.
import { describe, expect, it } from 'vitest';
import { GUIDE, analyze, rewritePrompt } from './voice';

describe('voice', () => {
  it('passes clear Saudi copy with a call to action', () => {
    const r = analyze('تعبان من الدوام؟ فريقنا الطبي يجيك البيت الحين. احجز جلستك');
    expect(r.dialect).toBe('saudi');
    expect(r.score).toBe(100);
  });

  it('flags formal Arabic, long sentences, no call to action and risky claims', () => {
    const r = analyze('يسعدنا أن نقدم لكم خدماتنا المتميزة التي تشمل علاجاً نهائياً مضمونة النتائج لجميع عملائنا الكرام في كافة مناطق المملكة العربية السعودية دون استثناء');
    expect(r.dialect).toBe('msa');
    const bad = r.checks.filter(c => !c.ok).map(c => c.title);
    expect(bad).toEqual(expect.arrayContaining(['اللهجة', 'طول الجمل', 'الدعوة للخطوة', 'الامتثال']));
    expect(r.score).toBeLessThan(50);
  });

  it('matches whole words only, and times the voice-over', () => {
    expect(analyze('خطوات بسيطة').dialect).toBe('neutral'); // "بس" inside "بسيطة" is not Saudi slang
    expect(analyze(Array(46).fill('كلمة').join(' ')).seconds).toBe(20);
  });

  it('asks the model for the brand voice within the voice-over length', () => {
    const p = rewritePrompt('نص', 15);
    expect(p).toContain('35 كلمة');
    expect(p).toContain('بدون ضمان نتائج');
    expect(GUIDE.length).toBeGreaterThanOrEqual(5);
  });
});
