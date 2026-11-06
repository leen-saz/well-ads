// Copywriter skills: the catalogue, inputs and missing questions, the prompt per skill, parsing the answer, and review.
/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SKILLS, SKILL, AD_PLATFORMS, partsOf, cleanInputs, missing, skillPrompt, parseVariants, reviewVariant, catalog } from './skills';
import { styleCard, type Project } from './copy';
import * as A from '../../lib/auth';
import { ROUTES } from '../routes';

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

describe('route /api/copy/skill', () => {
  const E: A.AuthEnv & { OPENAI_API_KEY?: string } = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
  const cfg = A.env(E);
  const editor: A.Profile = { id: '22222222-2222-2222-2222-222222222222', email: 'm@example.com', role: 'member', active: true, access: { copy: 'edit' } };
  const call = async (body: unknown, env = E, who = editor) => ROUTES.copy.skill.POST(new Request('https://well.example/api/copy/skill', {
    method: 'POST', body: JSON.stringify(body),
    headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(who, cfg), cfg.secret))}`, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } }), env);
  const sent: { url: string; body: string }[] = [];
  const answer = JSON.stringify({ variants: [{ subject: 'حياك في Well', preheader: 'أول زيارة', body: 'الأفضل في الرياض', cta: 'احجز', ps: '', angle: 'ترحيب', why: 'قريب' }] });
  const stub = () => {
    sent.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      sent.push({ url, body: String(init.body || '') });
      if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([editor]));
      if (url.includes('copy_projects')) return new Response(JSON.stringify([{ id: 1, ...P({ competitors: [{ id: 'c1', name: 'أكمي', url: '', platform: '', samples: ['وش رايك تجرب؟ احجز'] }] }) }]));
      if (url.includes('/knowledge?')) return new Response(JSON.stringify([{ id: 1, kind: 'voice', title: '', body: 'نتكلم مثل طبيب العائلة', price: null, modules: [], active: true }]));
      if (url.includes('api.openai.com')) return new Response(JSON.stringify({ output_text: answer }));
      return new Response('[]');
    }));
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  it('asks for the missing inputs first, and needs a known skill and project', async () => {
    stub();
    const r = await call({ project_id: 1, skill: 'email', inputs: { type: 'welcome' } });
    expect(await r.json()).toEqual({ ask: [{ key: 'point', ask: 'وش الشي الواحد اللي تبيه يسويه أو يعرفه؟' }] });
    expect(sent.some(s => s.url.includes('openai'))).toBe(false);
    expect((await call({ project_id: 1, skill: 'nope' })).status).toBe(400);
  });
  it('needs edit on the copy tab: a viewer cannot generate', async () => {
    stub();
    const viewer = { ...editor, access: { copy: 'view' } };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/profiles?id=eq.') ? [viewer] : []))));
    const r = await call({ project_id: 1, skill: 'email', inputs: { type: 'welcome', point: 'x' } }, { ...E, OPENAI_API_KEY: 'k' }, viewer);
    expect(r.status).toBe(403);
  });
  it('sends the inputs capped by the skill: an over-long input is cut before the prompt', async () => {
    stub();
    await call({ project_id: 1, skill: 'email', inputs: { type: 'welcome', point: 'ن'.repeat(5000), extra: 'لا توصل' } }, { ...E, OPENAI_API_KEY: 'k' });
    const prompt = (JSON.parse(sent.find(s => s.url.includes('openai'))!.body) as { input: { content: string }[] }).input[1]!.content;
    expect(prompt).toContain('ن'.repeat(200));
    expect(prompt).not.toContain('ن'.repeat(201));
    expect(prompt).not.toContain('لا توصل');
  });
  it('says so without a model instead of writing templates', async () => {
    stub();
    const r = await call({ project_id: 1, skill: 'email', inputs: { type: 'welcome', point: 'يحجز أول زيارة' } });
    expect(r.status).toBe(503);
  });
  it('stream: true sends the text as events, then one result with every variant reviewed', async () => {
    stub();
    const enc = new TextEncoder();
    const f0 = (globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (!url.includes('api.openai.com')) return f0(url, init);
      const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      const half = answer.length >> 1;
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(enc.encode(ev({ type: 'response.output_text.delta', delta: answer.slice(0, half) })));
        c.enqueue(enc.encode(ev({ type: 'response.output_text.delta', delta: answer.slice(half) })));
        c.enqueue(enc.encode(ev({ type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } }))); c.close(); } }));
    }));
    const r = await call({ project_id: 1, skill: 'email', inputs: { type: 'welcome', point: 'يحجز أول زيارة' }, stream: true }, { ...E, OPENAI_API_KEY: 'k' });
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    const events = (await r.text()).split('\n\n').filter(Boolean).map(x => JSON.parse(x.replace(/^data: /, '')) as { type: string; variants?: { compliance: { rule: string }[] }[] });
    expect(events.map(x => x.type)).toEqual(['delta', 'delta', 'result']);
    expect(events[2]!.variants![0]!.compliance.some(h => h.rule === 'superlative')).toBe(true);
  });
  it('writes with the knowledge as system message and the picked style, and reviews every variant', async () => {
    stub();
    const r = await call({ project_id: 1, skill: 'email', inputs: { type: 'welcome', point: 'يحجز أول زيارة' }, count: 9, competitors: ['c1'] }, { ...E, OPENAI_API_KEY: 'k' });
    expect(r.status).toBe(200);
    const j = await r.json() as { variants: { parts: Record<string, string>; compliance: { rule: string }[] }[]; parts: { key: string }[]; used: { competitors: string[]; knowledge: boolean } };
    expect(j.variants[0]!.parts.subject).toBe('حياك في Well');
    expect(j.variants[0]!.compliance.some(h => h.rule === 'superlative')).toBe(true);
    expect(j.parts.map(p => p.key)).toEqual(['subject', 'preheader', 'body', 'cta', 'ps']);
    expect(j.used).toMatchObject({ competitors: ['أكمي'], knowledge: true });
    const req = JSON.parse(sent.find(s => s.url.includes('openai'))!.body) as { input: { role: string; content: string }[] };
    expect(req.input[0]).toMatchObject({ role: 'system' });
    expect(req.input[0]!.content).toContain('طبيب العائلة');
    expect(req.input[1]!.content).toContain('3 نسخ');   // count capped at the skill's max
    expect(req.input[1]!.content).toContain('أكمي');
  });
});
