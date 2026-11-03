// Every tab in AI_MODULES really reads the company's knowledge: its AI call (or, for Maestro, the task its agents
// read) carries the active entries. A new AI module added to the list without wiring fails here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { AI_MODULES } from '../../src/modules/knowledge/knowledge';
import { ROUTES } from '../../src/modules/routes';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const OWNER: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true };
const PC = '22222222-2222-2222-2222-222222222222';
const SECRET = 'كلمة-من-المعرفة-للاختبار';
const LONG = 'مسودة '.repeat(60);
const cookie = async () => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(OWNER, cfg), cfg.secret))}`;
const post = async (path: string, body: unknown, method = 'POST') => new Request('https://well.example' + path,
  { method, headers: { cookie: await cookie(), origin: 'https://well.example', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });

// Supabase + Paperclip stand-in; returns what Paperclip was sent
function world() {
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.startsWith('https://pc.example')) { sent.push(String(init.body || '')); return new Response(JSON.stringify({ id: 'i1' })); }
    const data = url.includes('/profiles?') ? [OWNER]
      : url.includes('/knowledge?') ? [{ id: 1, kind: 'forbidden', title: '', body: SECRET, price: null, modules: [], active: true }]
      : url.includes('/content_plans?') ? [{ id: 3, site: 'https://x.sa', competitors: [], items: [{ id: 'a1', kind: 'article', title: 'ت', why: 'و', priority: 1, status: 'approved' }] }]
      : url.includes('/copy_projects?') ? [{ id: 5, name: 'محاليل', service: 'محاليل', audience: '', offer: '', voice: '', banned: [], competitors: [] }]
      : url.includes('/companies?') ? [{ id: OWNER.id, name: 'Well', paperclip_company_id: PC }]
      : [];
    return new Response(JSON.stringify(data));
  }));
  return sent;
}
// A Workers AI stand-in that records what each call was given
function ai() {
  const seen: string[] = [];
  const run = vi.fn(async (...args: [string, { messages?: { role: string; content: string }[] }]) => {
    const input = args[1];
    seen.push(JSON.stringify(input.messages || []));
    return { response: input.messages?.some(m => m.content.includes('JSON فقط: {"head"')) ? '{"head":"عنوان","body":"نص الرسالة"}' : LONG };
  });
  return { seen, run };
}
afterEach(() => { vi.unstubAllGlobals(); });

const CALLS: Record<(typeof AI_MODULES)[number], (env: A.AuthEnv) => Promise<Response>> = {
  content: async env => ROUTES.content.item.PATCH(await post('/api/content/item', { plan: 3, item: 'a1', action: 'draft' }, 'PATCH'), env),
  copy: async env => ROUTES.copy.write.POST(await post('/api/copy/write', { project_id: 5, kind: 'ad', count: 2 }), env),
  design: async env => ROUTES.design.brief.POST(await post('/api/design/brief', { type: 'ad', offer: 'محاليل' }), env),
  voice: async env => ROUTES.voice.rewrite.POST(await post('/api/voice/rewrite', { text: 'نص', seconds: 30 }), env),
  social: async env => ROUTES.social.suggest.POST(await post('/api/social/suggest', { brief: 'محاليل في البيت', platforms: ['facebook'] }), env),
  maestro: async env => ROUTES.maestro.task.POST(await post('/api/maestro/task', { title: 'اكتب منشور' }), env),
  journeys: async env => ROUTES.journeys.write.POST(await post('/api/journeys/write', { type: 'email', idea: 'متابعة' }), env),
};

describe('every AI module reads the knowledge', () => {
  it('covers the whole list', () => {
    expect(Object.keys(CALLS).sort()).toEqual([...AI_MODULES].sort());
  });
  for (const m of AI_MODULES) {
    it(m, async () => {
      const sent = world(), { seen, run } = ai();
      const r = await CALLS[m]({ ...E, AI: { run }, PAPERCLIP_URL: 'https://pc.example', PAPERCLIP_TOKEN: 't' } as A.AuthEnv);
      expect(r.status, await r.clone().text()).toBe(200);
      const got = m === 'maestro' ? sent.join('\n') : seen.join('\n');
      expect(got, `${m} did not pass the knowledge`).toContain(SECRET);
      if (m !== 'maestro') expect(seen.some(s => s.includes('"role":"system"') && s.includes(SECRET))).toBe(true);
    });
  }
});
