// /api/social/*: the post calendar of the user's company. Reads need the `social` dashboard, writes are same-origin.
// Publishing itself runs from the Worker cron (src/lib/social-cron.ts), never from the browser.
import { sb, json, readJson, handle, requireUser, audit } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { SOCIAL, validate } from '../../lib/social';

type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
const day = (s: string | null, fallback: number) => { const t = Date.parse(s || ''); return new Date(Number.isFinite(t) ? t : fallback).toISOString(); };

export const posts = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'social');
    const q = new URL(request.url).searchParams;
    const from = day(q.get('from'), Date.now() - 7 * 864e5), to = day(q.get('to'), Date.now() + 31 * 864e5);
    const r = await sb(cfg, scoped(`/rest/v1/social_posts?select=*&publish_at=gte.${from}&publish_at=lte.${to}&order=publish_at.asc&limit=500`, user.co), { admin: true });
    return r.ok ? json(200, { posts: r.data, platforms: SOCIAL }) : json(500, { error: 'ما قدرت أقرأ المنشورات' });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'social', { write: true });
    const v = validate(await readJson(request));
    if (!v.draft) return json(400, { error: v.error, notices: v.notices });
    const r = await sb<Row[]>(cfg, '/rest/v1/social_posts', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { ...v.draft, company_id: user.co, status: 'scheduled', created_by: user.email } });
    if (!r.ok) return json(500, { error: 'ما انحفظ المنشور' });
    const post = rows(r.data)[0];
    await audit(cfg, user, 'social_scheduled', { target: { id: post?.id, platforms: v.draft.platforms, mode: v.draft.mode, publish_at: v.draft.publish_at } });
    return json(200, { ok: true, post, notices: v.notices });
  }),
  // approve (manual mode) or cancel. Only posts that have not gone out yet.
  PATCH: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'social', { write: true });
    const body = await readJson(request);
    const id = parseInt(String(body.id), 10);
    const act = String(body.action || '');
    if (!id || !['approve', 'cancel'].includes(act)) return json(400, { error: 'طلب غير صحيح' });
    const patch = act === 'approve' ? { approved_by: user.email, approved_at: new Date().toISOString() } : { status: 'cancelled' };
    const r = await sb<Row[]>(cfg, scoped(`/rest/v1/social_posts?id=eq.${id}&status=eq.scheduled`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: patch });
    if (!r.ok || !rows(r.data).length) return json(409, { error: 'المنشور انتشر أو انلغى' });
    await audit(cfg, user, act === 'approve' ? 'social_approved' : 'social_cancelled', { target: { id } });
    return json(200, { ok: true, post: rows(r.data)[0] });
  }),
};
