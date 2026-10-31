// /api/account/password. Port of web/api/account/password.js: changing the password needs the current one.
import { sb, json, readJson, handle, requireUser, audit, PASSWORD_MIN } from '../../lib/auth';

export const password = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any', { write: true });
    const body = await readJson(request);
    const current = String(body.current || ''), pw = String(body.password || '');
    if (pw.length < PASSWORD_MIN) return json(400, { error: `الباسوورد لازم ${PASSWORD_MIN} أحرف أو أكثر` });
    const r = await sb<{ access_token?: string }>(cfg, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email: user.email, password: current } });
    if (!r.ok || !r.data || !r.data.access_token) return json(400, { error: 'الباسوورد الحالي غلط' });
    const u = await sb(cfg, '/auth/v1/user', { method: 'PUT', token: r.data.access_token, body: { password: pw } });
    if (!u.ok) return json(400, { error: 'ما تغيّر الباسوورد، جرّب مرة ثانية' });
    await audit(cfg, user, 'password_changed');
    return json(200, { ok: true });
  }),
  GET: handle(async (request, e) => {
    const { user } = await requireUser(request, e, 'any');
    return json(200, { email: user.email, name: user.name, role: user.role, dashboards: user.dash, departments: user.depts || [] });
  }),
};
