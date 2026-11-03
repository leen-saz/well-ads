// Copywriter: setup cleaning, competitor links, style card counts, prompt rules, parsing, review, and routes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanProject, cleanCompetitor, platformOf, styleCard, writePrompt, parseDrafts, fallbackDrafts, review, type Project } from './copy';
import * as A from '../../lib/auth';
import { ROUTES } from '../routes';
import { WELL_COMPANY } from '../../lib/tenant';

afterEach(() => { vi.unstubAllGlobals(); });

const P = (x: Partial<Project> = {}): Project => ({ name: 'محاليل في البيت', service: 'محاليل وريدية', audience: 'الرياض', offer: '', cta: 'احجز', voice: '', banned: ['رخيص'], competitors: [], ...x });

describe('setup', () => {
  it('needs a name, trims everything, dedupes banned words, keeps 10 competitors', () => {
    expect(cleanProject({})).toEqual({ error: 'اكتب اسم المشروع' });
    const p = cleanProject({ name: '  مشروع  ', banned: ['رخيص', 'رخيص', ''], competitors: Array.from({ length: 12 }, (_, i) => ({ name: 'م' + i })) });
    expect('error' in p).toBe(false);
    if ('error' in p) return;
    expect(p.name).toBe('مشروع');
    expect(p.banned).toEqual(['رخيص']);
    expect(p.competitors.length).toBe(10);
  });
  it('keeps the previous values on a partial update', () => {
    const p = cleanProject({ offer: 'خصم الخريف' }, P());
    expect(p).toMatchObject({ name: 'محاليل في البيت', offer: 'خصم الخريف', banned: ['رخيص'] });
  });
  it('competitor: https public links only, platform from the host, short texts dropped', () => {
    expect(platformOf('https://www.instagram.com/acme')).toBe('instagram');
    expect(platformOf('https://x.com/acme')).toBe('x');
    expect(platformOf('https://acme.sa')).toBe('web');
    expect(cleanCompetitor({ url: 'javascript:alert(1)' }, 'c1')).toBeNull();
    expect(cleanCompetitor({ name: 'أكمي', url: 'http://acme.sa', samples: ['قصير', 'نص إعلان كامل يكفي'] }, 'c1'))
      .toEqual({ id: 'c1', name: 'أكمي', url: '', platform: '', samples: ['نص إعلان كامل يكفي'] });
  });
});

describe('style card', () => {
  it('counts length, questions, dialect, CTAs and openers from the texts', () => {
    const c = styleCard(['وش رايك تجرب جلسة في بيتك؟ احجز الحين 🙂', 'وش رايك نجيك لين البيت. تواصل معنا بخصم 20%', 'عرض الخريف لأول 50 حجز'])!;
    expect(c.samples).toBe(3);
    expect(c.questions).toBe(33);
    expect(c.numbers).toBe(67);
    expect(c.openers[0]).toEqual({ text: 'وش رايك تجرب', n: 1 });
    expect(c.dialect.map(d => d.word)).toEqual(expect.arrayContaining(['وش', 'الحين']));
    expect(c.ctas.map(d => d.word)).toEqual(expect.arrayContaining(['احجز', 'تواصل']));
    expect(styleCard([])).toBeNull();
  });
});

describe('writing', () => {
  it('the prompt carries the setup, the pattern, our hooks and the bans, and says not to copy', () => {
    const card = styleCard(['وش رايك تجرب جلسة؟ احجز'])!;
    const t = writePrompt(P(), 'tiktok', 3, [{ name: 'أكمي', card }], ['جلسة في بيتك']);
    expect(t).toContain('3 نسخ');
    expect(t).toContain('أكمي');
    expect(t).toContain('بدون ما تنسخ');
    expect(t).toContain('«جلسة في بيتك»');
    expect(t).toContain('رخيص');
    expect(t).toContain('أقل من 100 حرف');
  });
  it('parses the JSON answer, and falls back to plain drafts', () => {
    expect(parseDrafts('خذ: [{"hook":"تبي راحة؟","body":"نجيك البيت","cta":"احجز"}]', 600)).toEqual([{ hook: 'تبي راحة؟', body: 'نجيك البيت', headline: '', description: '', cta: 'احجز' }]);
    expect(parseDrafts('ما فيه', 600)).toEqual([]);
    expect(fallbackDrafts(P(), 2).length).toBe(2);
  });
  it('review flags compliance and the project\'s banned words, without blocking', () => {
    const r = review({ hook: 'علاج نهائي ومضمون', body: 'سعر رخيص', cta: 'احجز' }, P());
    expect(r.compliance.length).toBeGreaterThan(0);
    expect(r.banned).toEqual(['رخيص']);
    expect(r.text).toContain('احجز');
  });
});

describe('routes', () => {
  const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
  const cfg = A.env(E);
  const member = (access: Record<string, string>): A.Profile => ({ id: '22222222-2222-2222-2222-222222222222', email: 'm@example.com', role: 'member', active: true, access });
  const cookieFor = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
  const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new Request('https://well.example' + path,
    { method, headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const stub = (p: A.Profile, rest: (url: string, init: RequestInit) => unknown) => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      return new Response(JSON.stringify(url.includes('/profiles?id=eq.' + p.id) ? [p] : rest(url, init)));
    }));
    return calls;
  };

  it('lists the company\'s projects with a style card per competitor', async () => {
    const u = member({ copy: 'view' });
    const calls = stub(u, () => [{ id: 1, ...P({ competitors: [{ id: 'c1', name: 'أكمي', url: '', platform: '', samples: ['وش رايك تجرب؟ احجز'] }] }) }]);
    const r = await ROUTES.copy.projects.GET(req('/api/copy/projects', await cookieFor(u)), E);
    expect(r.status).toBe(200);
    const j = await r.json() as { projects: { competitors: { card: { samples: number } }[] }[] };
    expect(j.projects[0]!.competitors[0]!.card.samples).toBe(1);
    expect(calls.find(c => c.url.includes('copy_projects'))!.url).toContain(`company_id=eq.${WELL_COMPANY}`);
  });

  it('view cannot save; writing without the AI binding still returns checked drafts', async () => {
    const viewer = member({ copy: 'view' });
    stub(viewer, () => []);
    expect((await ROUTES.copy.projects.POST(req('/api/copy/projects', await cookieFor(viewer), 'POST', { name: 'x' }), E)).status).toBe(403);
    const editor = member({ copy: 'edit' });
    stub(editor, url => url.includes('copy_projects') ? [{ id: 1, ...P() }] : []);
    const w = await ROUTES.copy.write.POST(req('/api/copy/write', await cookieFor(editor), 'POST', { project_id: 1, kind: 'caption', count: 2 }), E);
    expect(w.status).toBe(200);
    const j = await w.json() as { engine: string; drafts: { score: number; checks: unknown[] }[] };
    expect(j.engine).toBe('templates');
    expect(j.drafts.length).toBe(2);
    expect(j.drafts[0]!.checks.length).toBeGreaterThan(0);
  });
});

describe('review with the company rules', () => {
  it('flags a word the company forbids in the knowledge tab', async () => {
    const { companyRules } = await import('../compliance/compliance');
    const p = { name: 'x', service: '', audience: '', offer: '', cta: '', voice: '', banned: [], competitors: [] };
    const d = review({ hook: '', body: 'عرض خاص من منافسنا', cta: '' }, p as never, companyRules(['منافسنا']));
    expect(d.compliance.some(h => h.rule.startsWith('company_'))).toBe(true);
  });
});

describe('ad copy per platform', () => {
  it('asks for the placement fields and flags what the platform would cut', async () => {
    const { overLimits, fitDraft } = await import('./copy');
    const p = { name: 'المحاليل', service: 'فيتامين سي', audience: '', offer: '', cta: '', voice: '', banned: [], competitors: [] };
    const prompt = writePrompt(p as never, 'google', 3, [], []);
    expect(prompt).toContain('عنوان أقل من 30 حرف');
    expect(prompt).toContain('وصف أقل من 90 حرف');
    const d = fitDraft({ hook: 'سطر', body: 'نص', headline: 'عنوان طويل جداً لإعلان قوقل يتعدى الحد', description: 'وصف', cta: 'احجز' }, 'google');
    expect(d.body).toBe('');
    expect(overLimits(d, 'google')).toEqual([{ field: 'العنوان', len: d.headline!.length, max: 30 }]);
  });
});
