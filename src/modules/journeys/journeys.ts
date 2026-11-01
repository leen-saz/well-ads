// الرحلات: التحقق من الخطوات، والإرسال لكل قناة. التشغيل نفسه في src/modules/journeys/workflow.ts (Cloudflare Workflows).
// واتساب مدفوع من Meta لكل محادثة (الاستثناء المسموح، مع تنويه بالتسعيرة). الإيميل من Gmail بحساب الشركة (OAuth).

export const CHANNELS = {
  wait: { name: 'انتظر' },
  whatsapp: { name: 'واتساب', notice: 'واتساب يحاسب لكل محادثة حسب تسعيرة Meta (رسائل القوالب التسويقية في السعودية بسعر لكل رسالة).' },
  email: { name: 'إيميل' },
  push: { name: 'إشعار', soon: true },
} as const;
export type Step =
  | { type: 'wait'; hours: number }
  | { type: 'whatsapp'; template: string; lang: string }
  | { type: 'email'; subject: string; body: string }
  | { type: 'push'; title: string; body: string };
export interface Contact { name?: string; phone?: string; email?: string }

const MAX_STEPS = 20, MAX_WAIT_H = 24 * 90;

export function cleanSteps(input: unknown): { steps?: Step[]; error?: string } {
  if (!Array.isArray(input) || !input.length) return { error: 'أضف خطوة وحدة على الأقل' };
  if (input.length > MAX_STEPS) return { error: `الحد ${MAX_STEPS} خطوة` };
  const out: Step[] = [];
  for (const [i, raw] of input.entries()) {
    const s = (raw || {}) as Record<string, unknown>, n = i + 1;
    if (s.type === 'wait') {
      const hours = Number(s.hours);
      if (!(hours > 0 && hours <= MAX_WAIT_H)) return { error: `الخطوة ${n}: الانتظار بين ساعة و90 يوم` };
      out.push({ type: 'wait', hours });
    } else if (s.type === 'whatsapp') {
      const template = String(s.template || '').trim();
      if (!/^[a-z0-9_]{1,512}$/.test(template)) return { error: `الخطوة ${n}: اسم قالب واتساب المعتمد (حروف إنجليزية صغيرة و_)` };
      out.push({ type: 'whatsapp', template, lang: /^[a-z]{2}(_[A-Z]{2})?$/.test(String(s.lang)) ? String(s.lang) : 'ar' });
    } else if (s.type === 'email') {
      const subject = String(s.subject || '').trim().slice(0, 200), body = String(s.body || '').trim().slice(0, 20000);
      if (!subject || !body) return { error: `الخطوة ${n}: عنوان ونص الإيميل` };
      out.push({ type: 'email', subject, body });
    } else if (s.type === 'push') {
      const title = String(s.title || '').trim().slice(0, 100), body = String(s.body || '').trim().slice(0, 300);
      if (!title) return { error: `الخطوة ${n}: عنوان الإشعار` };
      out.push({ type: 'push', title, body });
    } else return { error: `الخطوة ${n}: نوع غير معروف` };
  }
  if (out.every(s => s.type === 'wait')) return { error: 'الرحلة لازم فيها رسالة وحدة على الأقل' };
  return { steps: out };
}

export function cleanContact(c: unknown): Contact | null {
  const o = (c || {}) as Record<string, unknown>;
  const phone = String(o.phone || '').replace(/[^\d+]/g, '');
  const email = String(o.email || '').trim().toLowerCase();
  const out: Contact = { name: String(o.name || '').trim().slice(0, 80) };
  if (/^\+?\d{9,15}$/.test(phone)) out.phone = phone.replace(/^0/, '966').replace(/^\+/, '');
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) out.email = email;
  return out.phone || out.email ? out : null;
}

// {{name}} in messages
const fill = (s: string, c: Contact) => s.replace(/\{\{\s*name\s*\}\}/g, c.name || '');

export const notices = (steps: Step[]) => [...new Set(steps.flatMap(s => (s.type === 'whatsapp' ? [CHANNELS.whatsapp.notice] : [])))];

type Tokens = Record<string, string | undefined>;
export type Sent = { ok: boolean; error?: string };

async function gmailToken(t: Tokens, f: typeof fetch): Promise<string | null> {
  if (!t.GMAIL_CLIENT_ID || !t.GMAIL_CLIENT_SECRET || !t.GMAIL_REFRESH_TOKEN) return null;
  const r = await f('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
    client_id: t.GMAIL_CLIENT_ID, client_secret: t.GMAIL_CLIENT_SECRET, refresh_token: t.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  return ((await r.json()) as { access_token?: string }).access_token || null;
}
const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function send(step: Step, c: Contact, t: Tokens, f: typeof fetch = fetch): Promise<Sent> {
  if (step.type === 'whatsapp') {
    if (!c.phone) return { ok: false, error: 'ما فيه رقم جوال' };
    if (!t.WHATSAPP_TOKEN || !t.WHATSAPP_PHONE_ID) return { ok: false, error: 'اربط واتساب للأعمال من صفحة الربط' };
    const r = await f(`https://graph.facebook.com/v23.0/${t.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${t.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: c.phone, type: 'template',
        template: { name: step.template, language: { code: step.lang },
          ...(c.name ? { components: [{ type: 'body', parameters: [{ type: 'text', text: c.name }] }] } : {}) } }),
    });
    const j = (await r.json()) as { messages?: unknown[]; error?: { message?: string } };
    return j.messages ? { ok: true } : { ok: false, error: j.error?.message || 'ما انرسلت' };
  }
  if (step.type === 'email') {
    if (!c.email) return { ok: false, error: 'ما فيه إيميل' };
    const token = await gmailToken(t, f);
    if (!token) return { ok: false, error: 'اربط Gmail من صفحة الربط' };
    const subject = `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(fill(step.subject, c))))}?=`;
    const raw = b64url(`To: ${c.email}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${fill(step.body, c)}`);
    const r = await f('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }) });
    return r.ok ? { ok: true } : { ok: false, error: 'ما انرسل الإيميل' };
  }
  if (step.type === 'push') return { ok: false, error: 'الإشعارات قريباً' };
  return { ok: true };
}
