// /api/admin/*: users and log (Leen only). Port of web/lib/routes/admin/*.js.
import { sb, json, readJson, handle, requireUser, audit, revokeSessions, levelsOf, DASHBOARDS, DEPTS, LEVELS, PASSWORD_MIN, type Cfg, type Level, type Profile } from '../../lib/auth';
import { logRange } from '../../lib/logrange';
import { isDay, parseRangeParams } from '../../../public/assets/period.js';
import { MODULES, isModule } from '../../modules/registry';
import { scoped, WELL_COMPANY } from '../../lib/tenant';

type Row = Record<string, unknown> & { email?: string };
const cleanDash = (d: unknown) => [...new Set((Array.isArray(d) ? d : []).filter((x): x is string => typeof x === 'string' && x in DASHBOARDS))];
// { dashboard: level } -> only known dashboards and levels. Falls back to the old dashboards list (all as approve).
function cleanAccess(body: Record<string, unknown>): Record<string, Level> {
  if (body.access && typeof body.access === 'object') {
    return Object.fromEntries(Object.entries(body.access as Record<string, unknown>)
      .filter(([k, l]) => k in DASHBOARDS && (LEVELS as readonly string[]).includes(String(l)))) as Record<string, Level>;
  }
  return Object.fromEntries(cleanDash(body.dashboards).map(k => [k, 'approve' as Level]));
}
const cleanDept = (d: unknown) => [...new Set((Array.isArray(d) ? d : []).filter((x): x is string => typeof x === 'string' && x in DEPTS))];

// Why the invite email did not go out, said plainly (never the upstream's own text)
function inviteFailure(r: { status: number; data: unknown }): string {
  const d = (r.data && typeof r.data === 'object' ? r.data : {}) as { error_code?: unknown; code?: unknown };
  const code = String(d.error_code ?? d.code ?? '');
  if (r.status === 422 || code === 'email_exists') return 'الإيميل مسجّل من قبل';
  if (r.status === 429 || /rate_limit/.test(code)) return 'وصلنا حد الإيميلات، أضفه مباشرة';
  if (code === 'email_address_invalid') return 'الإيميل غير صحيح';
  return 'ما انرسلت الدعوة. أضفه مباشرة بباسوورد مؤقت';
}
const pwError = (pw: string) => (pw.length < PASSWORD_MIN ? `الباسوورد لازم ${PASSWORD_MIN} أحرف أو أكثر` : pw.length > 72 ? 'الباسوورد طويل زيادة (أقصاه 72)' : null);
const UUID36 = /^[0-9a-f-]{36}$/i;
type AuthUser = { id?: string; email?: string; created_at?: string; user_metadata?: { name?: unknown; company_id?: unknown } };
// Every account the dashboard creates (invite, direct) is stamped with the company that made it. An account with no profile
// belongs to that company only: another company's owner neither sees it in the list nor can give it a profile. An unstamped
// account (made by hand in Supabase) is the platform's: only Well's owner sees it.
const mine = (u: AuthUser, co: string): boolean => {
  const c = u.user_metadata?.company_id;
  return typeof c === 'string' && c ? c === co : co === WELL_COMPANY;
};

// Auth accounts that have no profile row in any company (made by hand in Supabase, or an invite that half-worked)
async function withoutProfile(cfg: Cfg): Promise<AuthUser[]> {
  const have = new Set<string>();
  for (let off = 0; off < 20000; off += 1000) {
    const r = await sb<{ id: string }[]>(cfg, `/rest/v1/profiles?select=id&order=id.asc&limit=1000&offset=${off}`, { admin: true });
    if (!r.ok || !Array.isArray(r.data)) throw new Error('profiles');
    r.data.forEach(x => have.add(x.id));
    if (r.data.length < 1000) break;
  }
  const out: AuthUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await sb<{ users?: AuthUser[] }>(cfg, `/auth/v1/admin/users?page=${page}&per_page=200`, { admin: true });
    if (!r.ok || !r.data || !Array.isArray(r.data.users)) throw new Error('auth');
    for (const u of r.data.users) if (u.id && u.email && !have.has(u.id)) out.push(u);
    if (r.data.users.length < 200) break;
  }
  return out;
}

export const log = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'owner');
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD: whole days in Riyadh time (UTC+3), both ends included
  let from = url.searchParams.get('from'), to = url.searchParams.get('to');
  // a real range is put in order and cut to a year; anything else is ignored, as before
  if (isDay(from) && isDay(to)) { const r = parseRangeParams(k => (k === 'from' ? from : to)); if (!('error' in r)) { from = r.from; to = r.to; } }
  const range = logRange(from, to);
  const r = await sb(cfg, scoped(`/rest/v1/audit_log?select=*${range}&order=at.desc&limit=${limit}`, user.co), { admin: true });
  return json(r.ok ? 200 : 500, r.ok ? { log: r.data } : { error: 'ما قدرت أقرأ السجل' });
}) };

export const users = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner');
    const r = await sb(cfg, scoped('/rest/v1/profiles?select=id,email,name,role,dashboards,access,departments,active,created_at&order=created_at.asc', user.co), { admin: true });
    const users = r.ok && Array.isArray(r.data) ? (r.data as Row[]).map(u => ({ ...u, access: levelsOf(u as unknown as Profile) })) : [];
    return json(r.ok ? 200 : 500, r.ok ? { users, dashboards: Object.fromEntries(Object.entries(DASHBOARDS).filter(([k]) => !user.off?.includes(k))), levels: LEVELS, departments: DEPTS } : { error: 'ما قدرت أقرأ المستخدمين' });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 80);
    const access = cleanAccess(body);
    const dashboards = Object.keys(access);
    const departments = cleanDept(body.departments);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'الإيميل غير صحيح' });
    if (!dashboards.length) return json(400, { error: 'اختر لوحة وحدة على الأقل' });
    // The invite email has a link where the user sets their own password
    const to = new URL('/reset/', request.url).toString();
    const inv = await sb<{ id?: string }>(cfg, `/auth/v1/invite?redirect_to=${encodeURIComponent(to)}`, { method: 'POST', admin: true, body: { email, data: { name, company_id: user.co } } });
    if (!inv.ok || !inv.data || !inv.data.id) return json(inv.status === 422 ? 400 : 502, { error: inviteFailure(inv) });
    // The id Supabase answered with must not already have a profile, in this company or any other: an insert that fails on
    // conflict, never a merge that would rewrite someone else's company, role or access
    const has = await sb<unknown[]>(cfg, `/rest/v1/profiles?id=eq.${encodeURIComponent(inv.data.id)}&select=id`, { admin: true });
    if (!has.ok || !Array.isArray(has.data)) return json(500, { error: 'ما قدرت أقرأ المستخدمين' });
    if (has.data.length) return json(409, { error: 'الإيميل مسجّل من قبل' });
    const p = await sb<Row[]>(cfg, '/rest/v1/profiles', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { id: inv.data.id, email, name, role: 'member', dashboards, access, departments, active: true, company_id: user.co } });
    if (p.status === 409) return json(409, { error: 'الإيميل مسجّل من قبل' });
    if (!p.ok || !Array.isArray(p.data) || !p.data.length) return json(500, { error: 'انرسلت الدعوة بس ما انحفظ الملف' });
    await audit(cfg, user, 'user_invited', { target: { email, access, departments } });
    return json(200, { ok: true, user: p.data[0] });
  }),
  PATCH: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const body = await readJson(request);
    const id = String(body.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'مستخدم غير معروف' });
    if (id === user.uid && body.active === false) return json(400, { error: 'ما تقدر توقف حسابك' });
    const patch: Record<string, unknown> = {};
    if ('access' in body || 'dashboards' in body) { patch.access = cleanAccess(body); patch.dashboards = Object.keys(patch.access as object); }
    if ('departments' in body) patch.departments = cleanDept(body.departments);
    if ('name' in body) patch.name = String(body.name || '').trim().slice(0, 80);
    if ('active' in body) patch.active = !!body.active;
    const before = await sb<Row[]>(cfg, scoped(`/rest/v1/profiles?id=eq.${id}&select=*`, user.co), { admin: true });
    if (!before.ok || !before.data.length) return json(404, { error: 'مستخدم غير معروف' });
    // One owner never switches off another owner (or bans them in Supabase): the company could be locked out of its own account
    if (patch.active === false && before.data[0]?.role === 'owner' && id !== user.uid) return json(403, { error: 'ما تقدر توقف مالك ثاني. هذا من اختصاص الدعم.' });
    const r = await sb<Row[]>(cfg, scoped(`/rest/v1/profiles?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: patch });
    if (!r.ok || !r.data.length) return json(400, { error: 'ما انحفظ التعديل' });
    if ('active' in patch) {
      // Disabling also blocks login in Supabase itself, not only in the dashboard
      await sb(cfg, `/auth/v1/admin/users/${id}`, { method: 'PUT', admin: true, body: { ban_duration: patch.active ? 'none' : '876000h' } });
    }
    await audit(cfg, user, 'user_updated', { target: { id, email: r.data[0]?.email }, before: before.ok ? before.data[0] : null, after: r.data[0] });
    return json(200, { ok: true, user: r.data[0] });
  }),
};

// Add a user directly: the owner types a temporary password, no email is involved
export const direct = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 80);
    const password = String(body.password || '');
    const access = cleanAccess(body);
    const dashboards = Object.keys(access);
    const departments = cleanDept(body.departments);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'الإيميل غير صحيح' });
    const bad = pwError(password);
    if (bad) return json(400, { error: bad });
    if (!dashboards.length) return json(400, { error: 'اختر لوحة وحدة على الأقل' });
    const made = await sb<{ id?: string }>(cfg, '/auth/v1/admin/users', { method: 'POST', admin: true, body: { email, password, email_confirm: true, user_metadata: { name, company_id: user.co } } });
    if (!made.ok || !made.data || !made.data.id) return json(made.status === 422 ? 400 : 502, { error: made.status === 422 ? 'الإيميل مسجّل من قبل' : 'ما انضاف المستخدم، جرّب مرة ثانية' });
    const p = await sb<Row[]>(cfg, '/rest/v1/profiles', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { id: made.data.id, email, name, role: 'member', dashboards, access, departments, active: true, company_id: user.co } });
    if (!p.ok || !Array.isArray(p.data) || !p.data.length) {
      // No half-made account: take the login back so the same email can be tried again
      await sb(cfg, `/auth/v1/admin/users/${made.data.id}`, { method: 'DELETE', admin: true }).catch(() => {});
      return json(500, { error: 'ما انحفظ الملف، جرّب مرة ثانية' });
    }
    await audit(cfg, user, 'user_added_direct', { target: { id: made.data.id, email, access, departments } });
    return json(200, { ok: true, user: p.data[0] });
  }),
};

// Accounts that can sign in but have no profile yet: listed, and given a profile and levels from here
export const orphans = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner');
    try {
      const list = (await withoutProfile(cfg)).filter(u => mine(u, user.co));
      return json(200, { accounts: list.map(u => ({ id: u.id, email: u.email, name: typeof u.user_metadata?.name === 'string' ? u.user_metadata.name : '', created_at: u.created_at ?? null })) });
    } catch { return json(500, { error: 'ما قدرت أقرأ الحسابات' }); }
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const body = await readJson(request);
    const id = String(body.id || '');
    if (!UUID36.test(id)) return json(400, { error: 'حساب غير معروف' });
    const access = cleanAccess(body);
    const dashboards = Object.keys(access);
    if (!dashboards.length) return json(400, { error: 'اختر لوحة وحدة على الأقل' });
    const au = await sb<AuthUser>(cfg, `/auth/v1/admin/users/${id}`, { admin: true });
    if (!au.ok || !au.data || au.data.id !== id || !au.data.email || !mine(au.data, user.co)) return json(404, { error: 'حساب غير معروف' });
    const has = await sb<unknown[]>(cfg, `/rest/v1/profiles?id=eq.${id}&select=id`, { admin: true });
    if (!has.ok) return json(500, { error: 'ما قدرت أقرأ المستخدمين' });
    if (has.data.length) return json(409, { error: 'الحساب له ملف من قبل' });
    const email = au.data.email.toLowerCase();
    const name = String(body.name || (typeof au.data.user_metadata?.name === 'string' ? au.data.user_metadata.name : '') || '').trim().slice(0, 80);
    const departments = cleanDept(body.departments);
    const p = await sb<Row[]>(cfg, '/rest/v1/profiles', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { id, email, name, role: 'member', dashboards, access, departments, active: true, company_id: user.co } });
    if (!p.ok || !Array.isArray(p.data) || !p.data.length) return json(500, { error: 'ما انحفظ الملف، جرّب مرة ثانية' });
    await audit(cfg, user, 'user_profile_created', { target: { id, email, access, departments } });
    return json(200, { ok: true, user: p.data[0] });
  }),
};

// The owner sets a new password for a user of the company (the password is never stored, returned or logged)
export const password = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const body = await readJson(request);
    const id = String(body.id || '');
    const pw = String(body.password || '');
    if (!UUID36.test(id)) return json(400, { error: 'مستخدم غير معروف' });
    const bad = pwError(pw);
    if (bad) return json(400, { error: bad });
    const who = await sb<Row[]>(cfg, scoped(`/rest/v1/profiles?id=eq.${id}&select=id,email`, user.co), { admin: true });
    if (!who.ok || !Array.isArray(who.data) || !who.data.length) return json(404, { error: 'مستخدم غير معروف' });
    const r = await sb(cfg, `/auth/v1/admin/users/${id}`, { method: 'PUT', admin: true, body: { password: pw } });
    if (!r.ok) return json(502, { error: 'ما تغيّر الباسوورد، جرّب مرة ثانية' });
    await revokeSessions(cfg, id);   // the old password's logins end with it
    await audit(cfg, user, 'user_password_set', { target: { id, email: who.data[0]?.email } });
    return json(200, { ok: true });
  }),
};

// The company's modules: the owner switches off the ones the company does not need (locked for everyone in it)
export const modules = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner');
    const r = await sb<{ disabled_modules?: string[] }[]>(cfg, `/rest/v1/companies?id=eq.${user.co}&select=disabled_modules`, { admin: true });
    if (!r.ok) return json(500, { error: 'ما قدرت أقرأ الموديولات' });
    const off = r.data[0]?.disabled_modules || [];
    return json(200, { modules: MODULES.map(m => ({ key: m.key, ar: m.ar, en: m.en, icon: m.icon, status: m.status, on: !off.includes(m.key) })) });
  }),
  PATCH: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const body = await readJson(request);
    const off = [...new Set((Array.isArray(body.off) ? body.off : []).filter((k): k is string => typeof k === 'string' && isModule(k)))];
    const r = await sb(cfg, `/rest/v1/companies?id=eq.${user.co}`, { method: 'PATCH', admin: true, body: { disabled_modules: off } });
    if (!r.ok) return json(500, { error: 'ما انحفظ' });
    await audit(cfg, user, 'modules_changed', { after: { off } });
    return json(200, { ok: true, off });
  }),
};
