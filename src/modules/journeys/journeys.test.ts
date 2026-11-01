// Journeys: step and contact validation, sending over WhatsApp and Gmail with stubbed APIs, and starting a run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { cleanContact, cleanSteps, notices, send } from './journeys';
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
      if (url.includes('journeys?id=eq.7')) return new Response(JSON.stringify([{ id: 7, steps: [{ type: 'wait', hours: 1 }] }]));
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
