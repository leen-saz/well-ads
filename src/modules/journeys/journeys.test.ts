// Journeys: step and contact validation, sending over WhatsApp and Gmail with stubbed APIs, and starting a run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { cleanContact, cleanSteps, notices, send, DAILY_PER_USER, DAILY_PER_CONTACT } from './journeys';
import { start } from './routes';
import { WELL_COMPANY } from '../../lib/tenant';

afterEach(() => { vi.unstubAllGlobals(); });

describe('steps and contacts', () => {
  it('keeps valid steps and refuses bad ones', () => {
    const ok = cleanSteps([{ type: 'whatsapp', template: 'lead_followup' }, { type: 'wait', hours: 24 }, { type: 'email', subject: 'هلا', body: 'أهلاً {{name}}' }]);
    expect(ok.steps?.map(s => s.type)).toEqual(['whatsapp', 'wait', 'email']);
    expect(ok.steps?.[0]).toEqual({ type: 'whatsapp', template: 'lead_followup', lang: 'ar' });
    expect(cleanSteps([{ type: 'wait', hours: 2 }]).error).toBeTruthy();          // no message at all
    expect(cleanSteps([{ type: 'wait', hours: 99999 }]).error).toContain('90');
    expect(cleanSteps([{ type: 'whatsapp', template: 'Bad Name' }]).error).toContain('قالب');
    expect(notices(ok.steps!)).toHaveLength(1);                                     // WhatsApp pricing notice
  });
  it('emails and pushes get precise compliance notes, without blocking the journey', () => {
    const c = cleanSteps([{ type: 'email', subject: 'عرض', body: 'محلولنا يشفيك من الزكام' }, { type: 'push', title: 'الأفضل في الرياض', body: '' }]);
    expect(c.steps).toHaveLength(2);
    const n = notices(c.steps!);
    expect(n.some(x => x.startsWith('الخطوة 1') && x.includes('«يشفيك»'))).toBe(true);
    expect(n.some(x => x.startsWith('الخطوة 2') && x.includes('«الأفضل»'))).toBe(true);
  });
  it('normalizes Saudi phones and needs a phone or an email', () => {
    expect(cleanContact({ phone: '0551234567' })).toEqual({ name: '', phone: '966551234567' });
    expect(cleanContact({ phone: '+966 55 123 4567', email: 'A@B.co' })).toEqual({ name: '', phone: '966551234567', email: 'a@b.co' });
    expect(cleanContact({ phone: '12' })).toBeNull();
  });
});

describe('send', () => {
  it('sends a WhatsApp template with the name', async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => new Response(JSON.stringify({ messages: [{ id: 'm' }], sent: JSON.parse(String(init.body)) }))) as unknown as typeof fetch;
    const r = await send({ type: 'whatsapp', template: 't', lang: 'ar' }, { name: 'سارة', phone: '966551234567' }, { WHATSAPP_TOKEN: 'w', WHATSAPP_PHONE_ID: 'p' }, f);
    expect(r.ok).toBe(true);
    const body = JSON.parse(String((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1].body));
    expect(body.template.components[0].parameters[0].text).toBe('سارة');
  });
  it('sends Gmail after refreshing the token, and says what is missing', async () => {
    const urls: string[] = [];
    const f = vi.fn(async (u: string) => { urls.push(u); return new Response(JSON.stringify({ access_token: 'a', id: 'x' })); }) as unknown as typeof fetch;
    const t = { GMAIL_CLIENT_ID: 'c', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r' };
    expect((await send({ type: 'email', subject: 'هلا {{name}}', body: 'نص' }, { name: 'س', email: 'a@b.co' }, t, f)).ok).toBe(true);
    expect(urls).toEqual(['https://oauth2.googleapis.com/token', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send']);
    expect((await send({ type: 'email', subject: 's', body: 'b' }, { phone: '1' }, t, f)).error).toBe('ما فيه إيميل');
    expect((await send({ type: 'whatsapp', template: 't', lang: 'ar' }, { phone: '966551234567' }, {}, f)).error).toContain('اربط');
  });
});

describe('start', () => {
  it("creates a run and a Workflow instance only for the company's own journey", async () => {
    const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
    const cfg = A.env(E);
    const leen: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true };
    const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(leen, cfg), cfg.secret))}`;
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('profiles?id=eq.')) return new Response(JSON.stringify([leen]));
      if (url.includes('control_settings')) return new Response(JSON.stringify([{ guardrails: { kill: false } }]));
      if (url.includes('journey_runs?select=id')) return new Response('[]');   // no runs today yet: under both daily limits
      if (url.includes('journeys?id=eq.7')) return new Response(JSON.stringify([{ id: 7, steps: [{ type: 'wait', hours: 1 }], active: true, mode: 'manual' }]));
      if (url.includes('journeys?id=eq.')) return new Response('[]');
      if (url.endsWith('/rest/v1/journey_runs')) return new Response(JSON.stringify([{ id: 99 }]));
      return new Response('[]');
    }));
    const created: unknown[] = [];
    const env = { ...E, JOURNEY: { create: async (o: unknown) => { created.push(o); return {}; } } };
    const req = (id: number) => new Request('https://well.example/api/journeys/start', { method: 'POST',
      headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ id, contact: { phone: '0551234567' } }) });
    expect((await start.POST(req(7), env)).status).toBe(200);
    expect(created).toEqual([{ id: 'run-99', params: { runId: 99, companyId: WELL_COMPANY, steps: [{ type: 'wait', hours: 1 }], contact: { name: '', phone: '966551234567' } } }]);
    expect(urls.find(u => u.includes('journeys?id=eq.7'))).toContain(`company_id=eq.${WELL_COMPANY}`);
    expect((await start.POST(req(8), env)).status).toBe(404);
  });
});

describe('start: a run sends real messages, so it is an approval with limits', () => {
  const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
  const cfg = A.env(E);
  const member = (level: 'edit' | 'approve'): A.Profile => ({ id: '22222222-2222-2222-2222-222222222222', email: 'm@example.com', active: true, role: 'member', company_id: WELL_COMPANY, access: { journeys: level } });
  async function go(p: A.Profile, o: { active?: boolean; kill?: boolean | 'down'; userRuns?: number; contactRuns?: number } = {}) {
    const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
    const created: unknown[] = [], posted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes('profiles?id=eq.')) return new Response(JSON.stringify([p]));
      if (url.includes('control_settings')) return o.kill === 'down' ? new Response('{}', { status: 500 }) : new Response(JSON.stringify([{ guardrails: { kill: o.kill === true } }]));
      if (url.includes('journeys?id=eq.7')) return new Response(JSON.stringify([{ id: 7, steps: [{ type: 'wait', hours: 1 }], active: o.active !== false, mode: 'manual' }]));
      if (url.includes('journey_runs?select=id') && url.includes('started_by=')) return new Response(JSON.stringify(Array.from({ length: o.userRuns ?? 0 }, (_, i) => ({ id: i }))));
      if (url.includes('journey_runs?select=id')) return new Response(JSON.stringify(Array.from({ length: o.contactRuns ?? 0 }, (_, i) => ({ id: i }))));
      if (url.endsWith('/rest/v1/journey_runs') && init.method === 'POST') { posted.push(String(init.body)); return new Response(JSON.stringify([{ id: 99 }])); }
      return new Response('[]');
    }));
    const env = { ...E, JOURNEY: { create: async (x: unknown) => { created.push(x); return {}; } } };
    const res = await start.POST(new Request('https://well.example/api/journeys/start', { method: 'POST', headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ id: 7, contact: { phone: '0551234567' } }) }), env);
    return { status: res.status, created, posted };
  }
  it('edit level alone cannot start a run; approve level can', async () => {
    const edit = await go(member('edit'));
    expect(edit.status).toBe(403); expect(edit.created).toEqual([]); expect(edit.posted).toEqual([]);
    expect((await go(member('approve'))).status).toBe(200);
  });
  it('a journey saved as paused does not send', async () => {
    const r = await go(member('approve'), { active: false });
    expect(r.status).toBe(409); expect(r.created).toEqual([]);
  });
  it('the emergency stop stops it, and an unreadable stop state counts as stopped', async () => {
    expect((await go(member('approve'), { kill: true })).status).toBe(409);
    const down = await go(member('approve'), { kill: 'down' });
    expect(down.status).toBe(409); expect(down.created).toEqual([]);
  });
  it('a person cannot start more than the daily limit, and a customer cannot receive more than theirs', async () => {
    const u = await go(member('approve'), { userRuns: DAILY_PER_USER });
    expect(u.status).toBe(429); expect(u.created).toEqual([]); expect(u.posted).toEqual([]);
    expect((await go(member('approve'), { userRuns: DAILY_PER_USER - 1 })).status).toBe(200);
    const c = await go(member('approve'), { contactRuns: DAILY_PER_CONTACT });
    expect(c.status).toBe(429); expect(c.created).toEqual([]);
    expect((await go(member('approve'), { contactRuns: DAILY_PER_CONTACT - 1 })).status).toBe(200);
  });
});

describe('send: a reply Meta accepted is never turned into a failure that gets retried', () => {
  it('a 2xx WhatsApp reply with an unreadable body counts as sent (a retry would message the customer twice)', async () => {
    const f = vi.fn(async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;
    expect((await send({ type: 'whatsapp', template: 't', lang: 'ar' }, { phone: '966551234567' }, { WHATSAPP_TOKEN: 'w', WHATSAPP_PHONE_ID: 'p' }, f)).ok).toBe(true);
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'no' } }), { status: 400 })) as unknown as typeof fetch;
    expect((await send({ type: 'whatsapp', template: 't', lang: 'ar' }, { phone: '966551234567' }, { WHATSAPP_TOKEN: 'w', WHATSAPP_PHONE_ID: 'p' }, bad)).ok).toBe(false);
  });
});
