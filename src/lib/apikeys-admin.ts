// /api/admin/keys and /api/admin/keyrevoke: the owner's page for the dashboard's read-only API keys (src/lib/apikeys.ts, docs/api-v1.md).
// Owner only (the gate asks for 'owner' on everything under /api/admin). A key is shown once, in the answer to its creation.
import { sb, json, readJson, handle, requireUser, audit, missingSchema, notApplied, notEnabled } from './auth';
import { scoped } from './tenant';
import { createKey, expiryFrom, isScope, pepperOf, LIST_COLUMNS, MAX_DAYS, DEFAULT_DAYS, MAX_NAME, SCOPES, type KeyEnv, type KeyListItem, type Scope } from './apikeys';

const MIGRATION = 'migration 037_api_keys.sql';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const keys = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner');
    const r = await sb<KeyListItem[]>(cfg, scoped(`/rest/v1/api_keys?select=${LIST_COLUMNS}&order=created_at.desc&limit=200`, user.co), { admin: true });
    if (missingSchema(r)) return json(503, { error: notApplied(user, MIGRATION) });
    if (!r.ok || !Array.isArray(r.data)) return json(500, { error: 'ما قدرت أقرأ المفاتيح' });
    return json(200, { keys: r.data, scopes: SCOPES, default_days: DEFAULT_DAYS, max_days: MAX_DAYS, ready: !!pepperOf(e as KeyEnv) });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const pepper = pepperOf(e as KeyEnv);
    if (!pepper) return json(503, { error: notEnabled(user, 'مفاتيح الـ API', 'API_KEY_PEPPER') });
    const body = await readJson(request);
    const name = String(body.name ?? '').trim();
    if (!name || name.length > MAX_NAME) return json(400, { error: `اكتب اسم المفتاح (حتى ${MAX_NAME} حرف)` });
    const raw = Array.isArray(body.scopes) ? body.scopes : [];
    const scopes = [...new Set(raw.filter(isScope))] as Scope[];
    if (!scopes.length || scopes.length !== new Set(raw).size) return json(400, { error: 'اختر صلاحية قراءة وحدة على الأقل من القائمة' });
    const exp = expiryFrom(body.days);
    if (!exp.ok) return json(400, { error: `مدة المفتاح من يوم إلى ${MAX_DAYS} يوم` });
    const made = await createKey(cfg, pepper, user, { name, scopes, expires_at: exp.at });
    if (!made.ok) return json(made.missing ? 503 : 500, { error: made.missing ? notApplied(user, MIGRATION) : 'ما انحفظ المفتاح' });
    return json(201, { ok: true, key: made.key, item: made.item, shown_once: true });
  }),
};

export const keyrevoke = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const body = await readJson(request);
    const id = typeof body.id === 'string' && UUID.test(body.id) ? body.id.toLowerCase() : null;
    if (!id) return json(400, { error: 'مفتاح غير معروف' });
    const r = await sb<KeyListItem[]>(cfg, scoped(`/rest/v1/api_keys?id=eq.${id}&revoked_at=is.null`, user.co), {
      method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { revoked_at: new Date().toISOString() },
    });
    if (missingSchema(r)) return json(503, { error: notApplied(user, MIGRATION) });
    if (!r.ok) return json(500, { error: 'ما انلغى المفتاح' });
    const item = Array.isArray(r.data) ? r.data[0] : undefined;
    if (!item) return json(404, { error: 'المفتاح غير موجود أو ملغى من قبل' });
    await audit(cfg, user, 'api_key_revoked', { target: { id, name: item.name, prefix: item.prefix } });
    return json(200, { ok: true });
  }),
};
