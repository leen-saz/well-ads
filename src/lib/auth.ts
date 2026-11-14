// Port of well-ads-dashboard web/lib/auth.js. Same behavior; env comes from Worker bindings instead of process.env.
// Email + password via Supabase Auth, session in an HMAC-signed cookie. Web Crypto only.

import { companyOf, WELL_COMPANY } from './tenant';
import { MODULES, LIVE, isModule } from '../modules/registry';
import { hit } from './ratelimit';

export const SESSION = '__Host-well_session';
export const SESSION_HOURS = 12;
export const RECHECK_MS = 10 * 60 * 1000; // pages re-read the user's permissions every 10 minutes
// Core dashboards, then one per live module (src/modules/registry.ts)
const CORE = { ceo: 'الحملات والمنصات', creative: 'المواد الإعلانية', control: 'لوحة القرارات', connectors: 'الربط' };
export const DASHBOARDS: Record<string, string> = { ...CORE, ...Object.fromEntries(MODULES.filter(m => LIVE.includes(m.key)).map(m => [m.key, m.ar])) };
// Department scope: empty = all departments. A department manager sees only their department.
export const DEPTS = { iv: 'المحاليل الوريدية', midwife: 'القبالة / رعاية الحمل', foot: 'تقويم القدم', renan: 'رينان لصحة الطفل' } as const;
export const PASSWORD_MIN = 10;
export const LOCKED = 'هالموديول مقفل لشركتك';
export const VIEW_ONLY = 'صلاحيتك هنا مشاهدة بس';
export const NO_APPROVE = 'الموافقة تحتاج صلاحية موافقة';
// Control (decisions, learning) and Connectors (ad-platform keys in the Vault) have no company column yet (ADR-0006):
// they are Well's alone, so another company's users are refused instead of reading or overwriting Well's data.
export const WELL_ONLY = 'هالقسم مو متاح لشركتك للحين';

export type Dashboard = string;
// Per dashboard/module: view < edit < approve. Owners have approve everywhere.
export const LEVELS = ['view', 'edit', 'approve'] as const;
export type Level = typeof LEVELS[number];
const rank = (l: string | undefined) => (l ? LEVELS.indexOf(l as Level) : -1);
export type Dept = keyof typeof DEPTS;
export type Need = Dashboard | 'any' | 'owner' | 'media';

export interface AuthEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SESSION_SECRET?: string;
  OWNER_EMAIL?: string;
}
export interface Cfg { url: string; service: string; secret: string; owner: string }
export interface Session {
  uid: string; email: string; name: string;
  role: 'owner' | 'member';
  dash: Dashboard[]; depts: Dept[];
  co: string; // company id (SaaS); owner = owner of this company only
  off?: string[]; // modules locked for this company (companies.disabled_modules)
  lvl?: Record<string, Level>; // level per dashboard (profiles.access)
  exp: number; chk: number;
  iat?: number; // when this login was made: a login older than the user's `valid_after` is refused (see revoked)
  stale?: boolean;
}
export interface Profile {
  id: string; email?: string | null; name?: string | null; role?: string | null;
  dashboards?: string[] | null; departments?: string[] | null; active?: boolean | null;
  company_id?: string | null;
  company?: { disabled_modules?: string[] | null; active?: boolean | null } | null;
  access?: Record<string, string> | null;
  valid_after?: string | null; // every login made before this moment is void (password change, reset, logout)
}

export function env(e: AuthEnv): Cfg {
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SESSION_SECRET', 'OWNER_EMAIL'] as const) {
    if (!e[k]) throw new Error(`missing env ${k}`);
  }
  const secret = e.SESSION_SECRET as string;
  if (secret.length < 32) throw new Error('SESSION_SECRET too short');
  return {
    // Accept the Data API URL too (https://x.supabase.co/rest/v1): every call adds its own /rest/v1 or /auth/v1.
    url: (e.SUPABASE_URL as string).trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, ''),
    service: (e.SUPABASE_SERVICE_ROLE_KEY as string).trim(),
    secret,
    owner: (e.OWNER_EMAIL as string).trim().toLowerCase(),
  };
}

const enc = new TextEncoder(), dec = new TextDecoder();
const toB64u = (bytes: Uint8Array): string => {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = (str: string): Uint8Array<ArrayBuffer> => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const KEYS = new Map<string, Promise<CryptoKey>>();
function key(secret: string): Promise<CryptoKey> {
  let k = KEYS.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    KEYS.set(secret, k);
  }
  return k;
}

// Every signed token carries a type, so a token made for one purpose (the OAuth state in a URL) is never accepted as another
// (the session cookie). Same secret, different `typ`; verify() refuses a token of the wrong type.
export type TokenType = 'session' | 'oauth';
export async function sign(payload: object, secret: string, typ: TokenType = 'session'): Promise<string> {
  const p = toB64u(enc.encode(JSON.stringify({ ...payload, typ })));
  const m = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(p)));
  return `${p}.${toB64u(m)}`;
}

// Returns the cookie payload if the signature is valid and not expired. stale = permissions must be re-read.
// crypto.subtle.verify compares in constant time.
// `typ` is the type the caller expects. Session cookies issued before types existed have no `typ`: they are accepted as
// sessions only if they have the session's own shape (role + dash list), which an OAuth state never has.
export async function verify(token: string | null | undefined, secret: string, now = Date.now(), typ: TokenType = 'session'): Promise<Session | null> {
  if (!token || !secret) return null;
  const [p, s, extra] = token.split('.');
  if (!p || !s || extra !== undefined) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64u(s), enc.encode(p)); } catch { return null; }
  if (!ok) return null;
  let o: Session;
  try { o = JSON.parse(dec.decode(fromB64u(p))) as Session; } catch { return null; }
  if (!o || typeof o.exp !== 'number' || o.exp < now || !o.uid) return null;
  const got = (o as { typ?: unknown }).typ;
  if (got === undefined) { if (typ !== 'session' || !Array.isArray(o.dash) || (o.role !== 'owner' && o.role !== 'member')) return null; }
  else if (got !== typ) return null;
  return { ...o, stale: !o.chk || now - o.chk > RECHECK_MS };
}

// A value that cannot be decoded (a cut or garbled cookie) is no cookie: the caller answers "sign in", never a server error.
export function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export const setCookie = (value: string, maxAgeSec: number): string =>
  `${SESSION}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
export const clearCookie = (): string => `${SESSION}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export const isOwner = (s: Session | null | undefined, cfg?: Cfg): boolean =>
  !!s && (s.role === 'owner' || (!!cfg && s.email === cfg.owner));
// A module the company switched off: locked for everyone in it, the owner included
export const locked = (s: Session, need: Need): boolean => isModule(need) && !!s.off?.includes(need);
export function can(s: Session | null | undefined, need: Need, cfg?: Cfg): boolean {
  if (!s) return false;
  if (need === 'any') return true;
  if (locked(s, need)) return false;
  if (isOwner(s, cfg)) return true;
  if (need === 'owner') return false;
  return Array.isArray(s.dash) && (s.dash as string[]).includes(need);
}
// Where the user lands after sign-in, and where a page they may not open sends them: the start page. Every user may
// open it, and it lists what they can reach (src/api/routes/today.ts).
export const home = (): string => '/today/';
// Blocks redirects to another site after login
export const safePath = (p: unknown): string =>
  typeof p === 'string' && /^\/(?!\/)[^\s\\]*$/.test(p) ? p : '';

export function levelsOf(p: Profile): Record<string, Level> {
  const src = p.access && Object.keys(p.access).length ? p.access : Object.fromEntries((p.dashboards || []).map(d => [d, 'approve']));
  return Object.fromEntries(Object.entries(src).filter(([k, l]) => k in DASHBOARDS && rank(l) >= 0)) as Record<string, Level>;
}
// The user's level on a dashboard/module is at least `min`
export const atLeast = (s: Session, key: string, min: Level, cfg?: Cfg): boolean => isOwner(s, cfg) || rank(s.lvl?.[key]) >= rank(min);
export function sessionFor(profile: Profile, cfg: Cfg, now = Date.now()): Session {
  const email = String(profile.email || '').toLowerCase();
  const owner = email === cfg.owner || profile.role === 'owner';
  // access wins; profiles without it (before migration 012) keep full use of their dashboards, as before
  const lvl = owner ? Object.fromEntries(Object.keys(DASHBOARDS).map(k => [k, 'approve' as Level])) : levelsOf(profile);
  return {
    uid: profile.id, email, name: profile.name || '',
    role: owner ? 'owner' : 'member',
    dash: Object.keys(lvl),
    lvl,
    depts: owner ? [] : ((profile.departments || []).filter(d => d in DEPTS) as Dept[]),
    co: companyOf(profile.company_id),
    off: (profile.company?.disabled_modules || []).filter(isModule),
    exp: now + SESSION_HOURS * 3600 * 1000, chk: now, iat: now,
  };
}

// A login made before the profile's `valid_after` (a cookie without a time counts as the oldest) is void: this is what makes a
// stolen cookie stop working when the password changes or the user signs out. A profile without the column (migration 036 not
// applied yet) never revokes, as before.
export const revoked = (p: Profile, s: { iat?: number | undefined }): boolean => {
  const at = p.valid_after ? Date.parse(p.valid_after) : 0;
  return at > 0 && (s.iat ?? 0) < at;
};
// A company that is switched off (companies.active = false): nobody in it signs in or reaches the API, the owner included
export const companyOff = (p: Profile): boolean => p.company?.active === false;

// ---- Supabase REST. The service key stays on the server; every call is server-side.
export interface SbResult<T = unknown> { ok: boolean; status: number; data: T }
export async function sb<T = unknown>(cfg: Cfg, path: string,
  { method = 'GET', body, token, headers = {} }: { method?: string; body?: unknown; token?: string; admin?: boolean; headers?: Record<string, string> } = {},
): Promise<SbResult<T>> {
  const k = cfg.service;
  const res = await fetch(cfg.url + path, {
    method,
    headers: { apikey: k, Authorization: `Bearer ${token || k}`, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data: data as T };
}

// A table or column a migration adds, read before that migration is applied (PostgREST / Postgres error codes)
export const missingSchema = (r: SbResult<unknown>): boolean =>
  !r.ok && ['PGRST205', 'PGRST204', '42P01', '42703'].includes(String((r.data as { code?: unknown } | null)?.code ?? ''));
// A table a migration adds is not there yet: plain words for everyone; the owner is pointed to the Data health page
export const notApplied = (user: { role: string } | null | undefined, file: string) => {
  console.warn('not_applied', file);   // the file to apply is for the logs and the data-health page, never for a page's text
  return user?.role === 'owner' ? 'جزء من النظام ما اكتمل تجهيزه. التفاصيل في صفحة صحة الداتا.' : 'جزء من النظام ما اكتمل تجهيزه. بلّغ الإدارة.';
};

// A feature waiting for a key: plain words for everyone; the key's name stays in the logs and on the Connectors page
export const notEnabled = (user: { role: string } | null | undefined, what: string, key: string) => {
  console.warn('not_enabled', key);
  return user?.role === 'owner' ? `${what} يحتاج تفعيل. التفاصيل في صفحة الربط.` : `${what} يحتاج تفعيل من الإدارة. بلّغ مالك الحساب.`;
};

// Diagnostics: the kind of key in use, never the key. JWT keys expose only their role claim.
export function keyKind(k: string): string {
  if (k.startsWith('sb_secret_')) return 'sb_secret';
  if (k.startsWith('sb_publishable_')) return 'sb_publishable';
  const p = k.split('.')[1];
  if (!p) return 'unknown';
  try { return 'jwt:' + String((JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }).role ?? '?'); } catch { return 'unknown'; }
}

// 'missing' = the account has no profile; 'error' = Supabase could not answer (5xx, 429, network). The two must not be mixed:
// a hiccup is not a reason to log anyone out.
export type ProfileRead = { kind: 'ok'; profile: Profile } | { kind: 'missing' } | { kind: 'error' };
export async function readProfile(cfg: Cfg, uid: string): Promise<ProfileRead> {
  const q = `/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=`;
  const done = (r: SbResult<Profile[]>): ProfileRead | null => {
    if (r.ok && Array.isArray(r.data)) return r.data[0] ? { kind: 'ok', profile: r.data[0] } : { kind: 'missing' };
    return null;
  };
  const hiccup = (r: SbResult<unknown>) => r.status >= 500 || r.status === 429;
  let r: SbResult<Profile[]>;
  try { r = await sb<Profile[]>(cfg, q + '*,company:companies(disabled_modules,active)', { admin: true }); } catch { return { kind: 'error' }; }
  const first = done(r);
  if (first) return first;
  if (hiccup(r)) return { kind: 'error' };
  // A column from a migration that is not applied yet must not lock everyone out: read the profile alone and log why.
  const d = (r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {}) as Record<string, unknown>;
  console.warn('profile_read_degraded', JSON.stringify({ status: r.status, code: d.code ?? null, msg: String(d.message ?? '').slice(0, 160) }));
  let plain: SbResult<Profile[]>;
  try { plain = await sb<Profile[]>(cfg, q + '*', { admin: true }); } catch { return { kind: 'error' }; }
  const second = done(plain);
  if (second) return second;
  return hiccup(plain) ? { kind: 'error' } : { kind: 'missing' };
}
// Old shape for callers that only need "profile or nothing" (login, OAuth callback)
export async function loadProfile(cfg: Cfg, uid: string): Promise<Profile | null> {
  const r = await readProfile(cfg, uid);
  return r.kind === 'ok' ? r.profile : null;
}

// Re-reads the user's permissions and issues the renewed cookie (renewing never extends the session). Shared by
// /api/auth/refresh and the page gate, which renews in place instead of redirecting there and back.
export type Renewed = { kind: 'ok'; session: Session; cookie: string } | { kind: 'login' } | { kind: 'expired' } | { kind: 'error' };
export async function renew(cfg: Cfg, s: Session): Promise<Renewed> {
  const read = await readProfile(cfg, s.uid);
  if (read.kind === 'error') return { kind: 'error' }; // Supabase hiccup: keep the session as it is
  if (read.kind === 'missing' || read.profile.active === false || companyOff(read.profile) || revoked(read.profile, s)) return { kind: 'login' };
  const profile = read.profile;
  const fresh = sessionFor(profile, cfg);
  fresh.exp = s.exp;
  // renewing keeps the time of the original login: a renewed cookie must not outlive a later revocation
  if (s.iat === undefined) delete fresh.iat; else fresh.iat = s.iat;
  const left = Math.max(0, Math.floor((s.exp - Date.now()) / 1000));
  if (!left) return { kind: 'expired' };
  return { kind: 'ok', session: fresh, cookie: setCookie(await sign(fresh, cfg.secret), left) };
}

// What a visitor typed in the email box, for the audit log: only something shaped like an email and of sane length.
// People type passwords there, and anyone without a session can write these rows, so nothing else is stored.
export const auditEmail = (v: unknown): string | null => { const s = String(v ?? '').trim().toLowerCase(); return s.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null; };

type Who = { uid?: string; id?: string | undefined; email?: string | undefined; co?: string } | null;
export async function audit(cfg: Cfg, user: Who, action: string, fields: Record<string, unknown> = {}): Promise<void> {
  await sb(cfg, '/rest/v1/audit_log', {
    method: 'POST', admin: true, headers: { Prefer: 'return=minimal' },
    body: { user_id: user ? user.uid || user.id || null : null, email: user ? user.email ?? null : null, ...(user?.co ? { company_id: user.co } : {}), action, ...fields },
  }).catch(() => {});
}

// An event anyone can cause without signing in (a wrong password, a reset request). audit_log is append-only, so a flood of these
// can never be cleaned: each kind is written at most a few times a minute per isolate, the rest only reach the Worker log.
export async function auditAnon(cfg: Cfg, user: Who, action: string, fields: Record<string, unknown> = {}): Promise<void> {
  if (!hit(`anon-audit:${action}`, 6, 60_000)) return;
  await audit(cfg, user, action, fields);
}

// Voids every login the user has made so far (their cookies are stateless, so this is the only way to end them). Returns the
// moment written, or null when it could not be saved (the column is missing until migration 036, or Supabase failed).
export async function revokeSessions(cfg: Cfg, uid: string, now = Date.now()): Promise<number | null> {
  if (!/^[0-9a-f-]{36}$/i.test(uid)) return null;
  try {
    const r = await sb(cfg, `/rest/v1/profiles?id=eq.${uid}`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=minimal' }, body: { valid_after: new Date(now).toISOString() } });
    if (r.ok) return now;
    console.warn('revoke_sessions_failed', r.status);
  } catch { console.warn('revoke_sessions_failed'); }
  return null;
}

// A daily limit that cannot be skipped: the counting row is written FIRST (and must be saved), then the day's rows are counted.
// Two requests at once both write before either counts, so the one over the limit is refused; a failed write or count refuses
// too (fail closed), where the old way (check, spend, write the row afterwards) let parallel calls through and a lost row meant no limit.
export async function claimDaily(cfg: Cfg, user: { uid: string; email?: string; co?: string }, action: string, limit: number, since: string): Promise<'ok' | 'over' | 'error'> {
  if (!/^[0-9a-f-]{36}$/i.test(user.uid)) return 'error';
  const w = await sb(cfg, '/rest/v1/audit_log', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' },
    body: { user_id: user.uid, email: user.email ?? null, ...(user.co ? { company_id: user.co } : {}), action } }).catch(() => null);
  if (!w || !w.ok) return 'error';
  const r = await sb<unknown[]>(cfg, `/rest/v1/audit_log?select=id&action=eq.${encodeURIComponent(action)}&user_id=eq.${user.uid}&at=gte.${encodeURIComponent(since)}&limit=${limit + 1}`, { admin: true }).catch(() => null);
  if (!r || !r.ok || !Array.isArray(r.data)) return 'error';
  return r.data.length > limit ? 'over' : 'ok';
}

// ---- Responses
export function json(status: number, obj: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
const escHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export function html(status: number, msg: string): Response {
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Well</title><body><p>${escHtml(msg)}</p><p><a href="/login/">الدخول</a></p></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

// Mutating requests must come from the same site (CSRF, together with SameSite=Strict)
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  if (!origin) return !!site;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export async function readJson(request: Request, limit = 20000): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > limit) throw new Error('too large');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

// For the API: cookie + permissions re-read from the DB every time (the source of truth). Throws a Response on refusal.
export async function requireUser(request: Request, e: AuthEnv, need: Need, { write = false, approve = false, well = false } = {}): Promise<{ cfg: Cfg; user: Session }> {
  let cfg: Cfg;
  try { cfg = env(e); } catch { throw json(503, { error: 'الإعداد غير مكتمل' }); }
  if (write && !sameOrigin(request)) throw json(403, { error: 'طلب مرفوض' });
  const s = await verify(readCookie(request, SESSION), cfg.secret);
  if (!s) throw json(401, { error: 'سجّل الدخول' });
  const read = await readProfile(cfg, s.uid);
  // A Supabase hiccup answers 503 and keeps the cookie; only a missing or disabled account clears it
  if (read.kind === 'error') throw json(503, { error: 'تعذّر التحقق من حسابك الحين. جرّب بعد لحظات.' });
  if (read.kind === 'missing' || read.profile.active === false || companyOff(read.profile)) throw json(401, { error: 'الحساب موقوف' }, { 'set-cookie': clearCookie() });
  if (revoked(read.profile, s)) throw json(401, { error: 'انتهت الجلسة، سجّل الدخول من جديد' }, { 'set-cookie': clearCookie() });
  const user = sessionFor(read.profile, cfg);
  if (locked(user, need)) throw json(403, { error: LOCKED });
  if (well && user.co !== WELL_COMPANY) throw json(403, { error: WELL_ONLY });
  if (!can(user, need, cfg)) throw json(403, { error: 'ما عندك صلاحية' });
  // Writes need edit and approvals need approve on that dashboard (owner/any/media checks stay as they are)
  if (need in DASHBOARDS && approve && !atLeast(user, need, 'approve', cfg)) throw json(403, { error: NO_APPROVE });
  if (need in DASHBOARDS && write && !atLeast(user, need, 'edit', cfg)) throw json(403, { error: VIEW_ONLY });
  return { cfg, user };
}

export type Handler = (request: Request, e: AuthEnv) => Response | Promise<Response>;
// Wraps a handler: a thrown Response is returned as is, anything else is a 500 without details.
export const handle = (fn: Handler): Handler => async (request, e) => {
  try { return await fn(request, e); } catch (err) {
    if (err instanceof Response) return err;
    // A body that is not JSON, or too large, is the caller's mistake: say so, not "server error"
    if (err instanceof SyntaxError) return json(400, { error: 'الطلب مو مكتوب صح' });
    if (err instanceof Error && err.message === 'too large') return json(413, { error: 'الطلب كبير' });
    console.error(err);
    return json(500, { error: 'صار خطأ، جرّب مرة ثانية' });
  }
};
