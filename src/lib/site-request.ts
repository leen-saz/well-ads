// What a visitor sends from the public request form (src/components/site/RequestForm.astro), checked field by field.
// Pure functions, shared by the route (src/api/routes/site.ts) and the tests. Errors are keyed by field so the form
// can show each one next to its box.
export const KINDS = ['board', 'leakmap', 'security', 'other'] as const;
export type Kind = typeof KINDS[number];
export const SCOPES = ['code', 'web', 'mobile', 'cloud'] as const;
export const LIMIT_PER_HOUR = 3;
// A person needs a few seconds to fill the form; a script posting straight away does not
export const MIN_FILL_MS = 2500;

export interface SiteRequest {
  kind: Kind; name: string; company: string | null; phone: string; email: string | null;
  scope: string[]; message: string | null; page: string; lang: 'ar' | 'en';
}
export type Cleaned = { ok: true; data: SiteRequest } | { ok: false; errors: Record<string, string> } | { ok: false; bot: true };

const toLatin = (s: string) => s.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Saudi mobiles in any common shape (05…, 5…, 9665…, +9665…, 009665…, Arabic digits) become +9665XXXXXXXX;
// a number written with + and a country code is kept as an international number
export function phone(v: unknown): string | null {
  const raw = toLatin(String(v ?? '')).replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(raw) && !raw.startsWith('+966')) return raw;
  const d = raw.replace(/^\+/, '').replace(/^00/, '');
  const m = d.match(/^(?:966|0)?(5\d{8})$/);
  return m ? `+966${m[1]}` : null;
}

export function email(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  return s.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s) ? s : null;
}

export function cleanRequest(b: Record<string, unknown>): Cleaned {
  // Honeypot: a field people never see. Anything in it is a bot; the route answers OK and stores nothing.
  if (text(b.website, 200) || (typeof b.t === 'number' && b.t < MIN_FILL_MS)) return { ok: false, bot: true };
  const errors: Record<string, string> = {};
  const kind = (KINDS as readonly string[]).includes(String(b.kind)) ? b.kind as Kind : 'other';
  const name = text(b.name, 80);
  if (name.length < 2) errors.name = 'اكتب اسمك';
  const company = text(b.company, 120) || null;
  const ph = phone(b.phone);
  if (!ph) errors.phone = 'اكتب رقم جوال صحيح، مثل ٠٥٠١٢٣٤٥٦٧';
  const rawEmail = String(b.email ?? '').trim();
  const em = rawEmail ? email(rawEmail) : null;
  if (rawEmail && !em) errors.email = 'الإيميل غير صحيح';
  const scope = kind === 'security' && Array.isArray(b.scope) ? [...new Set(b.scope.map(String).filter(s => (SCOPES as readonly string[]).includes(s)))] : [];
  const message = text(b.message, 1500) || null;
  if (b.consent !== true) errors.consent = 'نحتاج موافقتك عشان نتواصل معك';
  const page = /^\/(welcome|security|profile)\/$/.test(String(b.page)) ? String(b.page) : '/';
  const lang = b.lang === 'en' ? 'en' : 'ar';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { kind, name, company, phone: ph!, email: em, scope, message, page, lang } };
}

// The visitor's address is never stored: a keyed hash of it and today's date, so it cannot be reversed or followed
// from one day to the next, and is still enough to count one visitor's requests in the last hour
export async function ipKey(ip: string, secret: string, day = new Date().toISOString().slice(0, 10)): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`site-request|${day}|${ip}`)));
  return [...sig.slice(0, 16)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export const KIND_AR: Record<Kind, string> = { board: 'لوحة Apipeline', leakmap: 'خريطة التسرب', security: 'فحص أمني', other: 'استفسار' };
