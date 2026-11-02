// /api/social/*: the post calendar of the user's company. Reads need the `social` dashboard, writes are same-origin.
// Publishing itself runs from the Worker cron (src/modules/social/cron.ts), never from the browser.
import { sb, json, readJson, handle, requireUser, audit, atLeast, NO_APPROVE } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { SOCIAL, validate } from './social';
import { MEDIA_TYPES, MEDIA_MAX, mediaKey } from './media';

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
    if (act === 'approve' && !atLeast(user, 'social', 'approve', cfg)) return json(403, { error: NO_APPROVE });
    if (!id || !['approve', 'cancel'].includes(act)) return json(400, { error: 'طلب غير صحيح' });
    const patch = act === 'approve' ? { approved_by: user.email, approved_at: new Date().toISOString() } : { status: 'cancelled' };
    const r = await sb<Row[]>(cfg, scoped(`/rest/v1/social_posts?id=eq.${id}&status=eq.scheduled`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: patch });
    if (!r.ok || !rows(r.data).length) return json(409, { error: 'المنشور انتشر أو انلغى' });
    await audit(cfg, user, act === 'approve' ? 'social_approved' : 'social_cancelled', { target: { id } });
    return json(200, { ok: true, post: rows(r.data)[0] });
  }),
};

// Upload a photo or video for a post: stored in R2 under social/<company>/<random>.<ext> and served at /m/… (public,
// unguessable name) so Meta can fetch it when the post goes out. The body is the raw file; its type is the content-type.
type FilesEnv = { FILES?: R2Bucket };
export const upload = { POST: handle(async (request, e) => {
  const { user } = await requireUser(request, e, 'social', { write: true });
  const files = (e as unknown as FilesEnv).FILES;
  if (!files) return json(503, { error: 'رفع الملفات مو مفعّل في هالبيئة' });
  const type = (request.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
  const ext = MEDIA_TYPES[type];
  if (!ext) return json(415, { error: 'الملف لازم صورة (JPG / PNG / WebP) أو فيديو (MP4 / MOV)' });
  const size = Number(request.headers.get('content-length') || 0);
  if (size > MEDIA_MAX) return json(413, { error: 'الملف أكبر من 95 ميقا' });
  const body = await request.arrayBuffer();
  if (!body.byteLength) return json(400, { error: 'الملف فاضي' });
  if (body.byteLength > MEDIA_MAX) return json(413, { error: 'الملف أكبر من 95 ميقا' });
  const key = mediaKey(user.co, ext);
  await files.put(key, body, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
  const url = new URL('/m/' + key.slice('social/'.length), request.url).toString();
  return json(200, { ok: true, url, type: type.startsWith('video/') ? 'video' : 'image' });
}) };
