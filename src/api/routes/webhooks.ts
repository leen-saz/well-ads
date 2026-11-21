// /api/webhooks/*: the company's outbound webhooks (src/mcp/events.ts). The owner only. The signing secret is shown once, on create.
import { json, readJson, handle, requireUser, audit, missingSchema, sb } from '../../lib/auth';
import { EVENT_TYPES, cleanTypes, cleanUrl, createWebhook, deleteWebhook } from '../../mcp/events';

type Row = Record<string, unknown>;
const SETUP = 'روابط الأحداث تحتاج تجهيز القاعدة. بلّغ الإدارة.';

export const list = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner');
    const r = await sb<Row[]>(cfg, `/rest/v1/webhooks?company_id=eq.${user.co}&select=id,url,types,active,created_by,created_at&order=id`, { admin: true });
    if (!r.ok) return missingSchema(r) ? json(200, { webhooks: [], types: EVENT_TYPES, missing: true }) : json(500, { error: 'ما قدرت أقرأ روابط الأحداث' });
    return json(200, { webhooks: r.data, types: EVENT_TYPES });
  }),
};

export const create = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const b = await readJson(request);
    const url = cleanUrl(b.url), types = cleanTypes(b.types);
    if (!url) return json(400, { error: 'الرابط لازم يكون عنوان آمن عام باسم موقع، بدون رقم جهاز أو منفذ' });
    if (!types.length) return json(400, { error: 'اختر نوع حدث واحد على الأقل' });
    const w = await createWebhook(cfg, user.co, user.email, url, types).catch(() => null);
    if (!w) return json(503, { error: SETUP });
    await audit(cfg, user, 'webhook_created', { target: { id: w.id, url: new URL(url).host, types } });
    // The secret appears in this answer only: the page shows it once
    return json(200, { ok: true, id: w.id, secret: w.secret });
  }),
};

export const remove = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const id = Number((await readJson(request)).id);
    if (!Number.isInteger(id) || id < 1) return json(400, { error: 'حدد الرابط' });
    if (!(await deleteWebhook(cfg, user.co, id))) return json(404, { error: 'الرابط مو موجود' });
    await audit(cfg, user, 'webhook_removed', { target: { id } });
    return json(200, { ok: true });
  }),
};
