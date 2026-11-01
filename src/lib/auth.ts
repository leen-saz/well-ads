// Port of well-ads-dashboard web/lib/auth.js. Same behavior; env comes from Worker bindings instead of process.env.
// Email + password via Supabase Auth, session in an HMAC-signed cookie. Web Crypto only.

import { companyOf } from './tenant';
import { MODULES, LIVE, isModule } from '../modules/registry';

export const SESSION = '__Host-well_session';
export const SESSION_HOURS = 12;
export const RECHECK_MS = 10 * 60 * 1000; // pages re-read the user's permissions every 10 minutes
// Core dashboards, then one per live module (src/modules/registry.ts)
const CORE = { ceo: 'التحليلات', creative: 'الكرييتف', control: 'لوحة القرارات', connectors: 'الربط' };
export const DASHBOARDS: Record<string, string> = { ...CORE, ...Object.fromEntries(MODULES.filter(m => LIVE.includes(m.key)).map(m => [m.key, m.ar])) };
// Department scope: empty = all departments. A department manager sees only their department.
export const DEPTS = { iv: 'المحاليل الوريدية', midwife: 'القبالة / رعاية الحمل', foot: 'تقويم القدم', renan: 'رينان لصحة الطفل' } as const;
export const PASSWORD_MIN = 10;
export const LOCKED = 'هالموديول مقفل لشركتك';
export const VIEW_ONLY = 'صلاحيتك هنا مشاهدة بس';
export const NO_APPROVE = 'الموافقة تحتاج صلاحية موافقة';

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
  stale?: boolean;
}
export interface Profile {
  id: string; email?: string | null; name?: string | null; role?: string | null;
  dashboards?: string[] | null; departments?: string[] | null; active?: boolean | null;
  company_id?: string | null;
  company?: { disabled_modules?: string[] | null } | null;
  access?: Record<string, string> | null;
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

export async function sign(payload: object, secret: string): Promise<string> {
  const p = toB64u(enc.encode(JSON.stringify(payload)));
  const m = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(p)));
  return `${p}.${toB64u(m)}`;
}

// Returns the cookie payload if the signature is valid and not expired. stale = permissions must be re-read.
// crypto.subtle.verify compares in constant time.
export async function verify(token: string | null | undefined, secret: string, now = Date.now()): Promise<Session | null> {
  if (!token || !secret) return null;
  const [p, s, extra] = token.split('.');
  if (!p || !s || extra !== undefined) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64u(s), enc.encode(p)); } catch { return null; }
  if (!ok) return null;
  let o: Session;
  try { o = JSON.parse(dec.decode(fromB64u(p))) as Session; } catch { return null; }
  if (!o || typeof o.exp !== 'number' || o.exp < now || !o.uid) return null;
  return { ...o, stale: !o.chk || now - o.chk > RECHECK_MS };
}

export function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
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
// First dashboard the user may open
export function home(s: Session, cfg?: Cfg): string {
  if (can(s, 'ceo', cfg)) return '/';
  if (can(s, 'creative', cfg)) return '/?view=creative';
  if (can(s, 'control', cfg)) return '/control/';
  if (can(s, 'connectors', cfg)) return '/connectors/';
  if (can(s, 'social', cfg)) return '/social/';
  if (can(s, 'journeys', cfg)) return '/journeys/';
  if (can(s, 'content', cfg)) return '/content/';
  return '/account/';
}
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
    exp: now + SESSION_HOURS * 3600 * 1000, chk: now,
  };
}

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

// Diagnostics: the kind of key in use, never the key. JWT keys expose only their role claim.
export function keyKind(k: string): string {
  if (k.startsWith('sb_secret_')) return 'sb_secret';
  if (k.startsWith('sb_publishable_')) return 'sb_publishable';
  const p = k.split('.')[1];
  if (!p) return 'unknown';
  try { return 'jwt:' + String((JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }).role ?? '?'); } catch { return 'unknown'; }
}

export async function loadProfile(cfg: Cfg, uid: string): Promise<Profile | null> {
  const r = await sb<Profile[]>(cfg, `/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=*,company:companies(disabled_modules)`, { admin: true });
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

type Who = { uid?: string; id?: string | undefined; email?: string | undefined; co?: string } | null;
export async function audit(cfg: Cfg, user: Who, action: string, fields: Record<string, unknown> = {}): Promise<void> {
  await sb(cfg, '/rest/v1/audit_log', {
    method: 'POST', admin: true, headers: { Prefer: 'return=minimal' },
    body: { user_id: user ? user.uid || user.id || null : null, email: user ? user.email ?? null : null, ...(user?.co ? { company_id: user.co } : {}), action, ...fields },
  }).catch(() => {});
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
export async function requireUser(request: Request, e: AuthEnv, need: Need, { write = false, approve = false } = {}): Promise<{ cfg: Cfg; user: Session }> {
  let cfg: Cfg;
  try { cfg = env(e); } catch { throw json(503, { error: 'الإعداد غير مكتمل' }); }
  if (write && !sameOrigin(request)) throw json(403, { error: 'طلب مرفوض' });
  const s = await verify(readCookie(request, SESSION), cfg.secret);
  if (!s) throw json(401, { error: 'سجّل الدخول' });
  const profile = await loadProfile(cfg, s.uid);
  if (!profile || profile.active === false) throw json(401, { error: 'الحساب موقوف' }, { 'set-cookie': clearCookie() });
  const user = sessionFor(profile, cfg);
  if (locked(user, need)) throw json(403, { error: LOCKED });
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
    console.error(err);
    return json(500, { error: 'صار خطأ، جرّب مرة ثانية' });
  }
};
