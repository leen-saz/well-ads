// Copywriter skills: the catalogue, inputs and missing questions, the prompt per skill, parsing the answer, and review.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { SKILLS, SKILL, AD_PLATFORMS, partsOf, cleanInputs, missing, skillPrompt, parseVariants, reviewVariant, catalog } from './skills';
import { styleCard, type Project } from './copy';

// The spec files, read through Vite (the typecheck has no Node types)
const DOCS = Object.keys(import.meta.glob('../../../docs/copywriter-skills/*.md')).map(f => f.split('/').pop());
const P = (x: Partial<Project> = {}): Project => ({ name: 'محاليل في البيت', service: 'محاليل وريدية', audience: 'الرياض', offer: '', cta: 'احجز', voice: 'دافي وواثق', banned: ['رخيص'], competitors: [], ...x });

describe('catalogue', () => {
  it('has every request type, each with its spec file, inputs, steps, checks and output fields', () => {
    expect(SKILLS.map(k => k.key)).toEqual(['ad', 'hooks', 'video', 'landing', 'whatsapp', 'sms', 'email', 'caption', 'offer', 'naming', 'service', 'seo', 'rewrite', 'localize', 'claims']);
    for (const k of SKILLS) {
      expect(DOCS, k.doc).toContain(k.doc);
      expect(k.steps.length).toBeGreaterThan(2);
      expect(k.checks.length).toBeGreaterThan(0);
      expect(partsOf(k, {}).length).toBeGreaterThan(0);
      expect(k.count[0]).toBeLessThanOrEqual(k.count[1]);
    }
    expect(JSON.stringify(catalog())).not.toContain('function');
  });
  it('ad fields follow the platform: Google gets 15 headlines of 30 and 4 descriptions of 90', () => {
    const g = partsOf(SKILL.ad!, { platform: 'google' });
    expect(g.find(p => p.key === 'headlines')).toMatchObject({ max: 30, many: 15 });
    expect(g.find(p => p.key === 'descriptions')).toMatchObject({ max: 90, many: 4 });
    expect(partsOf(SKILL.ad!, { platform: 'nope' })).toBe(AD_PLATFORMS.meta!.parts);
  });
});

describe('inputs', () => {
  it('keeps the skill\'s fields only, trims, and checks the select options', () => {
    const i = cleanInputs(SKILL.ad!, { platform: 'snap', goal: 'bogus', angle: '  الوقت  ', hack: 'x' });
    expect(i).toEqual({ platform: 'snap', goal: 'lead', awareness: 'problem', angle: 'الوقت' });
  });
  it('asks for what is required and missing', () => {
    expect(missing(SKILL.offer!, cleanInputs(SKILL.offer!, { deal: 'خصم 20%' })).map(m => m.key)).toEqual(['until', 'approval']);
    expect(missing(SKILL.offer!, cleanInputs(SKILL.offer!, { deal: 'خصم 20%', until: 'نهاية الشهر', approval: 'pending' }))).toEqual([]);
    expect(missing(SKILL.rewrite!, {})[0]!.ask).toContain('الصق');
  });
});

describe('prompt', () => {
  it('carries the project, the request, the steps, the style references without copying, our hooks and the MOH bans', () => {
    const card = styleCard(['وش رايك تجرب جلسة؟ احجز'])!;
    const t = skillPrompt(SKILL.ad!, cleanInputs(SKILL.ad!, { platform: 'google', keyword: 'محاليل في البيت' }), P(), 2, [{ name: 'أكمي', card }], ['جلسة في بيتك']);
    expect(t).toContain('2 نسخ');
    expect(t).toContain('قوقل (بحث)');
    expect(t).toContain('محاليل في البيت');
    expect(t).toContain('أكمي');
    expect(t).toContain('لا تنسخ جملهم ولا ادعاءاتهم');
    expect(t).toContain('«جلسة في بيتك»');
    expect(t).toContain('«الأفضل»');
    expect(t).toContain('شهادات مرضى');
    expect(t).toContain('رخيص');
    expect(t).toContain('قائمة لين 15 (كل وحدة أقل من 30 حرف)');
    expect(t).toContain('"headlines":["…"]');
    expect(t).toContain('صيغة المذكر');
  });
  it('every skill builds a prompt with its own fields and JSON shape', () => {
    for (const k of SKILLS) {
      const t = skillPrompt(k, cleanInputs(k, {}), P(), k.count[0]);
      for (const p of partsOf(k, {})) expect(t).toContain(`"${p.key}"`);
      expect(t).toContain('{"variants":[{');
      expect(t).toContain(k.steps[0]!);
    }
  });
});

describe('parsing', () => {
  const parts = SKILL.email!.parts as never;
  it('reads {"variants":[…]} with text and code fences around it', () => {
    const raw = 'تفضل:\n```json\n{"variants":[{"subject":"موعدك جاهز","preheader":"نجيك البيت","body":"هلا","cta":"احجز","ps":"","angle":"الراحة","why":"قريب"}]}\n```';
    expect(parseVariants(raw, parts, 3)).toEqual([{ angle: 'الراحة', why: 'قريب', parts: { subject: 'موعدك جاهز', preheader: 'نجيك البيت', body: 'هلا', cta: 'احجز', ps: '' } }]);
  });
  it('reads a bare array, turns lines into lists, drops empty variants and unknown fields, keeps the count', () => {
    const g = partsOf(SKILL.ad!, { platform: 'google' });
    const raw = JSON.stringify([{ headlines: 'عنوان 1\nعنوان 2', descriptions: ['وصف'], path: ['محاليل', ''], extra: 'x' }, {}, { headlines: ['ثاني'] }, { headlines: ['ثالث'] }]);
    const v = parseVariants(raw, g, 2);
    expect(v.length).toBe(2);
    expect(v[0]!.parts).toEqual({ headlines: ['عنوان 1', 'عنوان 2'], descriptions: ['وصف'], path: ['محاليل'] });
    expect(v[1]!.parts.headlines).toEqual(['ثاني']);
  });
  it('returns nothing for an answer without JSON or with broken JSON', () => {
    expect(parseVariants('ما قدرت', parts, 3)).toEqual([]);
    expect(parseVariants('{"variants":[{"subject":', parts, 3)).toEqual([]);
  });
});

describe('review', () => {
  it('flags lengths per field and per list item, compliance and banned words, without blocking', () => {
    const g = partsOf(SKILL.ad!, { platform: 'google' });
    const r = reviewVariant({ angle: '', why: '', parts: { headlines: ['قصير', 'عنوان طويل جداً لإعلان قوقل يتعدى الثلاثين حرف'], descriptions: ['علاج نهائي ومضمون بسعر رخيص'], path: [] } }, g, P());
    expect(r.over).toEqual([{ field: 'العناوين', len: 46, max: 30, n: 2 }]);
    expect(r.compliance.length).toBeGreaterThan(0);
    expect(r.banned).toEqual(['رخيص']);
    expect(r.text).toContain('قصير');
  });
});
