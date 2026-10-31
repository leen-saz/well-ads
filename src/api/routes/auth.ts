// /api/auth/*: login, logout, refresh, forgot, reset. Port of web/lib/routes/auth/*.js.
import {
  env, sb, loadProfile, sessionFor, sign, verify, readCookie, setCookie, clearCookie, safePath, home, audit, html, json,
  sameOrigin, readJson, handle, SESSION, SESSION_HOURS, PASSWORD_MIN, type Profile,
} from '../../lib/auth';

export const login = { POST: handle(async (request, e) => {
  if (!sameOrigin(request)) return json(403, { error: 'طلب مرفوض' });
  const cfg = env(e);
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return json(400, { error: 'اكتب الإيميل والباسوورد' });
  const r = await sb<{ user?: { id: string } }>(cfg, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!r.ok || !r.data || !r.data.user) {
    await audit(cfg, { email }, 'login_failed');
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
  if (!profile || profile.active === false) {
    await audit(cfg, { uid, email }, 'login_blocked');
    return json(403, { error: 'حسابك غير مفعّل. تواصل مع مسؤولة اللوحة.' });
  }
  const s = sessionFor(profile, cfg);
  await audit(cfg, s, 'login');
  return json(200, { ok: true, next: safePath(body.next) || home(s, cfg) }, { 'set-cookie': setCookie(await sign(s, cfg.secret), SESSION_HOURS * 3600) });
}) };

// Logout is POST and same-origin only, so another site cannot log the user out with a link.
export const logout = {
  POST: handle(request => {
    if (!sameOrigin(request)) return new Response(null, { status: 403 });
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
  const profile = await loadProfile(cfg, s.uid);
  if (!profile || profile.active === false) return out('/login/', clearCookie());
  const fresh = sessionFor(profile, cfg);
  fresh.exp = s.exp; // renewing never extends the session
  const left = Math.max(0, Math.floor((s.exp - Date.now()) / 1000));
  if (!left) return html(401, 'انتهت الجلسة.');
  return out(safePath(url.searchParams.get('next')) || home(fresh, cfg), setCookie(await sign(fresh, cfg.secret), left));
}) };

// Sends a reset link. Same reply every time so nobody learns whether an email is registered.
export const forgot = { POST: handle(async (request, e) => {
  if (!sameOrigin(request)) return json(403, { error: 'طلب مرفوض' });
  const cfg = env(e);
  const email = String((await readJson(request)).email || '').trim().toLowerCase();
  if (email) {
    const to = new URL('/reset/', request.url).toString();
    // Leen's first time: no account yet, so she gets an invite email to set her password
    const invited = email === cfg.owner
      ? (await sb(cfg, `/auth/v1/invite?redirect_to=${encodeURIComponent(to)}`, { method: 'POST', admin: true, body: { email, data: { name: 'Leen' } } })).ok
      : false;
    if (!invited) await sb(cfg, `/auth/v1/recover?redirect_to=${encodeURIComponent(to)}`, { method: 'POST', body: { email } });
    await audit(cfg, { email }, 'password_reset_requested');
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
  if (password.length < PASSWORD_MIN) return json(400, { error: `الباسوورد لازم ${PASSWORD_MIN} أحرف أو أكثر` });
  const r = await sb<{ id?: string; email?: string }>(cfg, '/auth/v1/user', { method: 'PUT', token, body: { password } });
  if (!r.ok) return json(400, { error: 'الرابط انتهى أو استُخدم. اطلب رابط جديد.' });
  await audit(cfg, { id: r.data?.id, email: r.data?.email }, 'password_set');
  return json(200, { ok: true });
}) };
