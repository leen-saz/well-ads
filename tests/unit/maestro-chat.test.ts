// «المدير» chat route: at most 10 messages a minute per user (each one wakes a paid agent), and what reaches
// Paperclip carries the user's name, never their email.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { ROUTES } from '../../src/modules/routes';

const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com', PAPERCLIP_URL: 'https://pc.example', PAPERCLIP_TOKEN: 't' };
const cfg = A.env(E);
const OWNER: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', name: 'لين', active: true };
const post = async (body: unknown) => new Request('https://well.example/api/maestro/chat', {
  method: 'POST', body: JSON.stringify(body),
  headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(OWNER, cfg), cfg.secret))}`, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' },
});

// Supabase + Paperclip stand-in: `recent` chat messages in the last minute; returns what Paperclip was sent
function world(recent: number) {
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.startsWith('https://pc.example')) {
      if (init.method === 'PATCH') sent.push(String(init.body));
      return new Response(JSON.stringify(url.includes('/agents') ? [{ id: 'ceo1', role: 'ceo' }] : [{ id: 'i1', title: 'محادثة المدير', status: 'todo' }]));
    }
    const data = url.includes('/profiles?') ? [OWNER]
      : url.includes('/companies?') ? [{ id: OWNER.id, name: 'Well', paperclip_company_id: 'pc1' }]
      : url.includes('/audit_log?') ? Array.from({ length: recent }, () => ({ action: 'maestro_chat' }))
      : [];
    return new Response(JSON.stringify(data));
  }));
  return sent;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('maestro chat', () => {
  it('sends with the name, not the email', async () => {
    const sent = world(3);
    const r = await ROUTES.maestro.chat.POST!(await post({ text: 'وزع مهام الأسبوع' }), E);
    expect(r.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('لين');
    expect(sent[0]).not.toContain('leen@example.com');
  });

  it('stops at 10 messages a minute', async () => {
    const sent = world(10);
    const r = await ROUTES.maestro.chat.POST!(await post({ text: 'مرة ثانية' }), E);
    expect(r.status).toBe(429);
    expect(sent).toHaveLength(0);
  });
});
