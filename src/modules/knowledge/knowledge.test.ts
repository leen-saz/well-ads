// Knowledge: clean input, the system message each module gets, levels on the routes, and the AI calls carrying it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { clean, systemPrompt, withKnowledge, loadKnowledge, type Entry } from './knowledge';
import { list, entry, preview, train } from './routes';
import { QUESTIONS, answerRow, nextQuestion, parseFollowUp } from './training';
import { plan, facts, type AiRun } from '../content/content';
import { rewrite } from '../voice/routes';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const CO = '00000000-0000-0000-0000-000000000001';
const member = (access: Record<string, string>): A.Profile => ({ id: '22222222-2222-2222-2222-222222222222', email: 'm@example.com', role: 'member', active: true, access });
const cookieFor = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new Request('https://well.example' + path,
  { method, headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const stub = (p: A.Profile, rest: (url: string, init: RequestInit) => unknown = () => []) => {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(url.includes('/profiles?id=eq.' + p.id) ? [p] : rest(url, init)));
  }));
  return calls;
};
afterEach(() => { vi.unstubAllGlobals(); });

const e = (x: Partial<Entry>): Entry => ({ id: 1, kind: 'note', title: '', body: 'x', price: null, modules: [], active: true, ...x });

describe('knowledge input', () => {
  it('keeps known kinds and modules, prices for services only', () => {
    expect(clean({ kind: 'service', title: 'محلول فيتامين', body: 'زيارة منزلية', price: '350', modules: ['content', 'hack', 'content'] }).row)
      .toEqual({ kind: 'service', title: 'محلول فيتامين', body: 'زيارة منزلية', price: 350, modules: ['content'] });
    expect(clean({ kind: 'bogus', body: 'x' }).error).toBe('اختر النوع');
    expect(clean({ kind: 'voice', body: '   ' }).error).toBe('اكتب المحتوى');
    expect(clean({ kind: 'voice', body: 'x', price: 10 }).error).toBe('السعر للخدمات بس');
    expect(clean({ kind: 'service', body: 'x', price: -1 }).error).toBe('السعر غير صحيح');
    expect(clean({ kind: 'note', body: 'a\u0000b\nc' }).row?.body).toBe('ab\nc');
  });
});

describe('system message', () => {
  const entries = [
    e({ id: 1, kind: 'winner', body: 'زيارتك في بيتك' }),
    e({ id: 2, kind: 'forbidden', body: 'علاج نهائي' }),
    e({ id: 3, kind: 'service', title: 'محلول', body: 'جلسة', price: 350 }),
    e({ id: 4, kind: 'voice', body: 'سعودي ودود', modules: ['voice'] }),
    e({ id: 5, kind: 'note', body: 'موقوف', active: false }),
  ];
  it('forbidden first, prices shown, scoped and inactive entries left out', () => {
    const s = systemPrompt(entries, 'content');
    expect(s.indexOf('علاج نهائي')).toBeLessThan(s.indexOf('زيارتك في بيتك'));
    expect(s).toContain('- محلول: جلسة (السعر: 350 ريال)');
    expect(s).not.toContain('سعودي ودود');
    expect(s).not.toContain('موقوف');
    expect(systemPrompt(entries, 'voice')).toContain('سعودي ودود');
    expect(systemPrompt([], 'content')).toBe('');
  });
  it('style references come with a "style only" instruction', () => {
    const s = systemPrompt([e({ kind: 'reference', title: 'كاتب', body: 'جمل قصيرة' })], 'content');
    expect(s).toContain('قلّد الإيقاع والنبرة');
    expect(s).toContain('لا تنقل ادعاءاتهم');
  });
  it('stays under the cap by leaving whole entries out', () => {
    const many = Array.from({ length: 50 }, (_, i) => e({ id: i, kind: 'winner', body: 'ن'.repeat(300) }));
    const s = systemPrompt([e({ kind: 'forbidden', body: 'مضمون' }), ...many], 'design', 2000);
    expect(s.length).toBeLessThanOrEqual(2000);
    expect(s).toContain('مضمون');
  });
  it('goes in as a system message before the request, never inside the user text', () => {
    expect(withKnowledge([{ role: 'user', content: 'اكتب' }], 'معرفة')).toEqual([{ role: 'system', content: 'معرفة' }, { role: 'user', content: 'اكتب' }]);
    expect(withKnowledge([{ role: 'user', content: 'اكتب' }], '')).toEqual([{ role: 'user', content: 'اكتب' }]);
  });
  it('a failed read gives no knowledge instead of an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"relation does not exist"}', { status: 404 })));
    expect(await loadKnowledge(cfg, CO)).toEqual([]);
  });
});

describe('knowledge routes', () => {
  it('view reads, cannot write', async () => {
    const v = member({ knowledge: 'view' });
    stub(v, () => [e({ price: '350' as unknown as number })]);
    const r = await list.GET(req('/api/knowledge/list', await cookieFor(v)), E);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { entries: Entry[]; canEdit: boolean }).entries[0]?.price).toBe(350);
    expect((await entry.POST(req('/api/knowledge/entry', await cookieFor(v), 'POST', { kind: 'note', body: 'x' }), E)).status).toBe(403);
  });
  it('an editor adds entries switched off; only an approver switches them on', async () => {
    const ed = member({ knowledge: 'edit' });
    const calls = stub(ed, () => [e({ id: 7, active: false })]);
    const r = await entry.POST(req('/api/knowledge/entry', await cookieFor(ed), 'POST', { kind: 'claim', body: 'فريق مرخّص' }), E);
    expect(((await r.json()) as { pending: boolean }).pending).toBe(true);
    expect(calls.find(c => c.method === 'POST' && c.url.endsWith('/knowledge'))?.body).toMatchObject({ kind: 'claim', active: false, company_id: CO });
    const on = await entry.PATCH(req('/api/knowledge/entry', await cookieFor(ed), 'PATCH', { id: 7, active: true }), E);
    expect(on.status).toBe(403);
    // an editor's edit goes back to waiting
    await entry.PATCH(req('/api/knowledge/entry', await cookieFor(ed), 'PATCH', { id: 7, kind: 'claim', body: 'معدّل' }), E);
    expect(calls.filter(c => c.method === 'PATCH').at(-1)?.body).toMatchObject({ body: 'معدّل', active: false });

    const ap = member({ knowledge: 'approve' });
    const c2 = stub(ap, () => [e({ id: 7, active: true })]);
    expect((await entry.PATCH(req('/api/knowledge/entry', await cookieFor(ap), 'PATCH', { id: 7, active: true }), E)).status).toBe(200);
    const p = c2.find(c => c.method === 'PATCH');
    expect(p?.url).toContain(`company_id=eq.${CO}`);
    expect(p?.body).toMatchObject({ active: true });
  });
  it('preview shows what a module receives', async () => {
    const v = member({ knowledge: 'view' });
    stub(v, () => [e({ kind: 'forbidden', body: 'الأرخص' })]);
    const r = await preview.GET(req('/api/knowledge/preview?module=social', await cookieFor(v)), E);
    expect(((await r.json()) as { system: string }).system).toContain('الأرخص');
    expect((await preview.GET(req('/api/knowledge/preview?module=nope', await cookieFor(v)), E)).status).toBe(400);
  });
});

describe('AI modules carry the knowledge', () => {
  it('content plan sends it as the system message', async () => {
    const ai = vi.fn<AiRun>(async () => ({ response: '{"position":"p","niche":"n","items":[{"kind":"faq","title":"س","why":"w","priority":1}]}' }));
    await plan(ai, 'https://x.sa', '', [], [facts('https://x.sa/', 200, '<h1>a</h1>')], [], 'معرفة الشركة');
    expect(ai.mock.calls[0]?.[1].messages[0]).toEqual({ role: 'system', content: 'معرفة الشركة' });
  });
  it('voice rewrite reads the company knowledge', async () => {
    const v = member({ voice: 'edit' });
    stub(v, url => (url.includes('/knowledge?') ? [e({ kind: 'forbidden', body: 'الأرخص', modules: ['voice'] })] : []));
    const run = vi.fn(async () => ({ response: 'نص جديد' }));
    const r = await rewrite.POST(req('/api/voice/rewrite', await cookieFor(v), 'POST', { text: 'نص', seconds: 30 }), { ...E, AI: { run } } as A.AuthEnv);
    expect(r.status).toBe(200);
    const msgs = (run.mock.calls[0] as unknown as [string, { messages: { role: string; content: string }[] }])[1].messages;
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain('الأرخص');
    expect(msgs[1]?.content).toContain('نص');
  });
});

describe('training chat', () => {
  it('asks the fixed questions in order, skipping answered and passed ones', () => {
    expect(nextQuestion([])?.topic).toBe('services');
    expect(nextQuestion([{ topic: 'services' }], ['prices'])?.topic).toBe('audience');
    expect(nextQuestion(QUESTIONS.map(q => ({ topic: q.topic })))).toBeNull();
    expect(QUESTIONS.some(q => q.kind === 'reference')).toBe(true);
  });
  it('a fixed answer takes kind and question from the bank, not the page', () => {
    expect(answerRow({ topic: 'forbidden', kind: 'claim', question: 'غيره', answer: 'علاج نهائي' }).row)
      .toMatchObject({ kind: 'forbidden', source: 'training', topic: 'forbidden', question: QUESTIONS.find(q => q.topic === 'forbidden')?.q });
    expect(answerRow({ topic: 'ai-abc', kind: 'voice', question: 'وش اللهجة؟', answer: 'نجدية' }).row).toMatchObject({ kind: 'voice', question: 'وش اللهجة؟' });
    expect(answerRow({ topic: 'hack', answer: 'x', question: 'q' }).error).toBe('سؤال غير معروف');
    expect(answerRow({ topic: 'services', answer: ' ' }).error).toBe('اكتب الجواب');
  });
  it('reads the AI follow-up or its done', () => {
    expect(parseFollowUp('{"done":true}')).toBe('done');
    expect(parseFollowUp('{"done":false,"question":"كم مدة الجلسة؟","kind":"service"}')).toMatchObject({ kind: 'service', q: 'كم مدة الجلسة؟' });
    expect(parseFollowUp('{"done":false,"question":"س","kind":"evil"}')).toMatchObject({ kind: 'note' });
    expect(parseFollowUp('no')).toBeNull();
  });
  it('the AI asks only after the fixed questions, and answers save as training entries', async () => {
    const ed = member({ knowledge: 'edit' });
    const run = vi.fn(async () => ({ response: '{"done":false,"question":"كم مدة الجلسة؟","kind":"service"}' }));
    stub(ed, () => [e({ topic: 'services', source: 'training', question: 'وش الخدمات؟', body: 'محاليل' })]);
    let r = (await (await train.GET(req('/api/knowledge/train', await cookieFor(ed)), { ...E, AI: { run } } as A.AuthEnv)).json()) as { next: { topic: string }; history: unknown[]; covered: number };
    expect(r.next.topic).toBe('prices');
    expect(r.covered).toBe(1);
    expect(r.history).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
    stub(ed, () => QUESTIONS.map((q, i) => e({ id: i, topic: q.topic, source: 'training', question: q.q })));
    r = (await (await train.GET(req('/api/knowledge/train', await cookieFor(ed)), { ...E, AI: { run } } as A.AuthEnv)).json()) as typeof r;
    expect(run).toHaveBeenCalledOnce();
    expect(r.next.topic).toMatch(/^ai-/);

    const calls = stub(ed, () => [e({ id: 9, active: false })]);
    const p = await train.POST(req('/api/knowledge/train', await cookieFor(ed), 'POST', { topic: 'tone', answer: 'سعودي ودود' }), E);
    expect(((await p.json()) as { pending: boolean }).pending).toBe(true);
    expect(calls.find(c => c.method === 'POST' && c.url.endsWith('/knowledge'))?.body).toMatchObject({ kind: 'voice', source: 'training', topic: 'tone', active: false, company_id: CO });
  });
});
