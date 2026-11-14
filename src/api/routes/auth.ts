// /api/auth/*: login, logout, refresh, forgot, reset. Port of web/lib/routes/auth/*.js.
import {
  env, sb, loadProfile, sessionFor, sign, renew, verify, readCookie, setCookie, clearCookie, safePath, home, audit, html, json,
  sameOrigin, readJson, handle, keyKind, auditEmail, auditAnon, revokeSessions, companyOff, SESSION, SESSION_HOURS, PASSWORD_MIN, type Profile,
} from '../../lib/auth';
import { hit, clientIp } from '../../lib/ratelimit';

const TOO_MANY = 'محاولات كثيرة. جرّب بعد شوي.';
const TEN_MIN = 10 * 60_000;

export const login = { POST: handle(async (request, e) => {
  if (!sameOrigin(request)) return json(403, { error: 'طلب مرفوض' });
  const cfg = env(e);
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return json(400, { error: 'اكتب الإيميل والباسوورد' });
  // The door anyone can knock on: a brake per address and per email, before Supabase is asked anything
  if (!hit(`login:ip:${clientIp(request)}`, 30, TEN_MIN) || !hit(`login:email:${email.slice(0, 254)}`, 8, TEN_MIN)) return json(429, { error: TOO_MANY });
  const r = await sb<{ user?: { id: string } }>(cfg, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!r.ok || !r.data || !r.data.user) {
    // Diagnostics only: Supabase status and error code, never the email, password or keys.
    const d = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
    console.warn('login_failed', JSON.stringify({ status: r.status, code: d.error_code ?? d.code ?? null, msg: String(d.msg ?? d.message ?? d.error_description ?? d.error ?? '').slice(0, 120) }));
    await auditAnon(cfg, { email: auditEmail(email) ?? undefined }, 'login_failed');
    return json(401, { error: 'الإيميل أو الباسوورد غلط' });
  }
  const uid = r.data.user.id;
  let profile = await loadProfile(cfg, uid);
  // Leen's first login: her profile is created as owner
  if (!profile && email === cfg.owner) {
    const made = await sb<Profile[]>(cfg, '/rest/v1/profiles', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { id: uid, email, name: 'Leen', role: 'owner', dashboards: ['ceo', 'creative', 'control'], active: true } });
    profile = made.ok ? made.data[0] || null : null;
  }
  if (!profile || profile.active === false || companyOff(profile)) {
    // Diagnostics only: HTTP status and row count of the profile read, and the key type. No values.
    const chk = await sb<unknown>(cfg, `/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=id,active`, { admin: true });
    const d = (chk.data && typeof chk.data === 'object' && !Array.isArray(chk.data) ? chk.data : {}) as Record<string, unknown>;
    console.warn('login_blocked', JSON.stringify({ key: keyKind(cfg.service), owner: email === cfg.owner, profileStatus: chk.status,
      rows: Array.isArray(chk.data) ? chk.data.length : null, active: profile ? profile.active : null, code: d.code ?? null, msg: String(d.message ?? '').slice(0, 120) }));
    await auditAnon(cfg, { uid, email }, 'login_blocked');
    return json(403, { error: 'حسابك غير مفعّل. تواصل مع مسؤولة اللوحة.' });
  }
  const s = sessionFor(profile, cfg);
  await audit(cfg, s, 'login');
  return json(200, { ok: true, next: safePath(body.next) || home() }, { 'set-cookie': setCookie(await sign(s, cfg.secret), SESSION_HOURS * 3600) });
}) };

// Logout is POST and same-origin only, so another site cannot log the user out with a link.
export const logout = {
  POST: handle(async (request, e) => {
    if (!sameOrigin(request)) return new Response(null, { status: 403 });
    // Cookies are stateless, so signing out also voids this user's logins made so far: a copied cookie stops working too
    try {
      const cfg = env(e);
      const s = await verify(readCookie(request, SESSION), cfg.secret);
      if (s) await revokeSessions(cfg, s.uid);
    } catch { /* signing out must always work */ }
    return new Response(null, { status: 303, headers: { location: '/login/', 'set-cookie': clearCookie(), 'cache-control': 'no-store' } });
  }),
  // Old saved link: goes home without logging anyone out
  GET: handle(() => new Response(null, { status: 303, headers: { location: '/account/', 'cache-control': 'no-store' } })),
};

// Re-reads the user's permissions from the DB and renews the cookie. A disabled account is logged out.
export const refresh = { GET: handle(async (request, e) => {
  const cfg = env(e);
  const url = new URL(request.url);
  const s = await verify(readCookie(request, SESSION), cfg.secret);
  const out = (to: string, cookie: string) => new Response(null, { status: 302, headers: { location: to, 'set-cookie': cookie, 'cache-control': 'no-store' } });
  if (!s) return out('/login/', clearCookie());
  const r = await renew(cfg, s);
  if (r.kind === 'login') return out('/login/', clearCookie());
  if (r.kind === 'expired') return html(401, 'انتهت الجلسة.');
  if (r.kind === 'error') return new Response(null, { status: 302, headers: { location: safePath(url.searchParams.get('next')) || home(), 'cache-control': 'no-store' } }); // hiccup: keep the cookie
  return out(safePath(url.searchParams.get('next')) || home(), r.cookie);
}) };

// Sends a reset link. Same reply every time so nobody learns whether an email is registered.
export const forgot = { POST: handle(async (request, e) => {
  if (!sameOrigin(request)) return json(403, { error: 'طلب مرفوض' });
  const cfg = env(e);
  const email = String((await readJson(request)).email || '').trim().toLowerCase();
  if (email) {
    // Same reply whether or not the email exists, so the brake must not depend on it either
    if (!hit(`forgot:ip:${clientIp(request)}`, 6, TEN_MIN) || !hit(`forgot:email:${email.slice(0, 254)}`, 3, TEN_MIN)) return json(429, { error: TOO_MANY });
    const to = new URL('/reset/', request.url).toString();
    // Leen's first time: no account yet, so she gets an invite email to set her password
    const invited = email === cfg.owner
      ? (await sb(cfg, `/auth/v1/invite?redirect_to=${encodeURIComponent(to)}`, { method: 'POST', admin: true, body: { email, data: { name: 'Leen' } } })).ok
      : false;
    if (!invited) await sb(cfg, `/auth/v1/recover?redirect_to=${encodeURIComponent(to)}`, { method: 'POST', body: { email } });
    await auditAnon(cfg, { email: auditEmail(email) ?? undefined }, 'password_reset_requested');
  }
  return json(200, { ok: true });
}) };

// New password from the email link (reset or invite). The token comes from the link itself.
export const reset = { POST: handle(async (request, e) => {
  if (!sameOrigin(request)) return json(403, { error: 'طلب مرفوض' });
  const cfg = env(e);
  const body = await readJson(request);
  const token = String(body.access_token || '');
  const password = String(body.password || '');
  if (!token) return json(400, { error: 'الرابط ناقص. اطلب رابط جديد.' });
  if (!hit(`reset:ip:${clientIp(request)}`, 20, TEN_MIN)) return json(429, { error: TOO_MANY });
  if (password.length < PASSWORD_MIN) return json(400, { error: `الباسوورد لازم ${PASSWORD_MIN} أحرف أو أكثر` });
  const r = await sb<{ id?: string; email?: string }>(cfg, '/auth/v1/user', { method: 'PUT', token, body: { password } });
  if (!r.ok) return json(400, { error: 'الرابط انتهى أو استُخدم. اطلب رابط جديد.' });
  // A new password voids every login made with the old one
  if (r.data?.id) await revokeSessions(cfg, r.data.id);
  await audit(cfg, { id: r.data?.id, email: r.data?.email }, 'password_set');
  return json(200, { ok: true });
}) };
