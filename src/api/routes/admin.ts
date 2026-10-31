// /api/admin/*: users and log (Leen only). Port of web/lib/routes/admin/*.js.
import { sb, json, readJson, handle, requireUser, audit, DASHBOARDS, DEPTS } from '../../lib/auth';

type Row = Record<string, unknown> & { email?: string };
const cleanDash = (d: unknown) => [...new Set((Array.isArray(d) ? d : []).filter((x): x is string => typeof x === 'string' && x in DASHBOARDS))];
const cleanDept = (d: unknown) => [...new Set((Array.isArray(d) ? d : []).filter((x): x is string => typeof x === 'string' && x in DEPTS))];

export const log = { GET: handle(async (request, e) => {
  const { cfg } = await requireUser(request, e, 'owner');
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
  const r = await sb(cfg, `/rest/v1/audit_log?select=*&order=at.desc&limit=${limit}`, { admin: true });
  return json(r.ok ? 200 : 500, r.ok ? { log: r.data } : { error: 'ما قدرت أقرأ السجل' });
}) };

export const users = {
  GET: handle(async (request, e) => {
    const { cfg } = await requireUser(request, e, 'owner');
    const r = await sb(cfg, '/rest/v1/profiles?select=id,email,name,role,dashboards,departments,active,created_at&order=created_at.asc', { admin: true });
    return json(r.ok ? 200 : 500, r.ok ? { users: r.data, dashboards: DASHBOARDS, departments: DEPTS } : { error: 'ما قدرت أقرأ المستخدمين' });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 80);
    const dashboards = cleanDash(body.dashboards);
    const departments = cleanDept(body.departments);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'الإيميل غير صحيح' });
    if (!dashboards.length) return json(400, { error: 'اختر لوحة وحدة على الأقل' });
    // The invite email has a link where the user sets their own password
    const to = new URL('/reset/', request.url).toString();
    const inv = await sb<{ id?: string }>(cfg, `/auth/v1/invite?redirect_to=${encodeURIComponent(to)}`, { method: 'POST', admin: true, body: { email, data: { name } } });
    if (!inv.ok || !inv.data || !inv.data.id) return json(400, { error: inv.status === 422 ? 'الإيميل مسجّل من قبل' : 'ما انرسلت الدعوة' });
    const p = await sb<Row[]>(cfg, '/rest/v1/profiles', { method: 'POST', admin: true, headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
      body: { id: inv.data.id, email, name, role: 'member', dashboards, departments, active: true } });
    if (!p.ok) return json(500, { error: 'انرسلت الدعوة بس ما انحفظ الملف' });
    await audit(cfg, user, 'user_invited', { target: { email, dashboards, departments } });
    return json(200, { ok: true, user: p.data[0] });
  }),
  PATCH: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const body = await readJson(request);
    const id = String(body.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'مستخدم غير معروف' });
    if (id === user.uid && body.active === false) return json(400, { error: 'ما تقدر توقف حسابك' });
    const patch: Record<string, unknown> = {};
    if ('dashboards' in body) patch.dashboards = cleanDash(body.dashboards);
    if ('departments' in body) patch.departments = cleanDept(body.departments);
    if ('name' in body) patch.name = String(body.name || '').trim().slice(0, 80);
    if ('active' in body) patch.active = !!body.active;
    const before = await sb<Row[]>(cfg, `/rest/v1/profiles?id=eq.${id}&select=*`, { admin: true });
    const r = await sb<Row[]>(cfg, `/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: patch });
    if (!r.ok || !r.data.length) return json(400, { error: 'ما انحفظ التعديل' });
    if ('active' in patch) {
      // Disabling also blocks login in Supabase itself, not only in the dashboard
      await sb(cfg, `/auth/v1/admin/users/${id}`, { method: 'PUT', admin: true, body: { ban_duration: patch.active ? 'none' : '876000h' } });
    }
    await audit(cfg, user, 'user_updated', { target: { id, email: r.data[0]?.email }, before: before.ok ? before.data[0] : null, after: r.data[0] });
    return json(200, { ok: true, user: r.data[0] });
  }),
};
