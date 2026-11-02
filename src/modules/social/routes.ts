// /api/social/*: the post calendar of the user's company. Reads need the `social` dashboard, writes are same-origin.
// Publishing itself runs from the Worker cron (src/modules/social/cron.ts), never from the browser.
import { sb, json, readJson, handle, requireUser, audit, isOwner, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { SOCIAL, validate, canApprove, cleanApprovers } from './social';
import { MEDIA_TYPES, MEDIA_MAX, mediaKey } from './media';

type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
// The company's named approvers (companies.social_approvers); empty = the owner only
async function approversOf(cfg: Cfg, company: string): Promise<string[]> {
  const r = await sb<{ social_approvers?: string[] | null }[]>(cfg, `/rest/v1/companies?id=eq.${company}&select=social_approvers`, { admin: true });
  return r.ok && Array.isArray(r.data) ? (r.data[0]?.social_approvers || []).map(x => x.toLowerCase()) : [];
}
const ONLY = (names: string[]) => names.length ? `الاعتماد لـ ${names.join('، ')} بس` : 'الاعتماد للمالك بس، أو للمعتمد اللي يحدده';
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
    if (act === 'approve') {
      const list = await approversOf(cfg, user.co);
      if (!canApprove(user.email, list, isOwner(user, cfg))) return json(403, { error: ONLY(list) });
    }
    const patch = act === 'approve' ? { approved_by: user.email, approved_at: new Date().toISOString() } : { status: 'cancelled' };
    const r = await sb<Row[]>(cfg, scoped(`/rest/v1/social_posts?id=eq.${id}&status=eq.scheduled`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: patch });
    if (!r.ok || !rows(r.data).length) return json(409, { error: 'المنشور انتشر أو انلغى' });
    await audit(cfg, user, act === 'approve' ? 'social_approved' : 'social_cancelled', { target: { id } });
    return json(200, { ok: true, post: rows(r.data)[0] });
  }),
};

// Who approves posts. Everyone in the tab reads it (the form says who will approve); only the owner changes it,
// and only to people of the same company.
export const approvers = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'social');
    const list = await approversOf(cfg, user.co);
    const owner = isOwner(user, cfg);
    let people: { email: string; name: string }[] = [];
    if (owner) {
      const r = await sb<{ email: string; name?: string | null }[]>(cfg, scoped('/rest/v1/profiles?select=email,name&active=eq.true&order=name.asc', user.co), { admin: true });
      people = r.ok && Array.isArray(r.data) ? r.data.map(p => ({ email: String(p.email || '').toLowerCase(), name: p.name || '' })) : [];
    }
    return json(200, { approvers: list, canApprove: canApprove(user.email, list, owner), owner, people });
  }),
  PUT: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'social', { write: true });
    if (!isOwner(user, cfg)) return json(403, { error: 'تحديد المعتمد للمالك بس' });
    const want = cleanApprovers((await readJson(request)).approvers);
    // Only people of this company
    const r = await sb<{ email: string }[]>(cfg, scoped('/rest/v1/profiles?select=email&active=eq.true', user.co), { admin: true });
    const mine = new Set(r.ok && Array.isArray(r.data) ? r.data.map(p => String(p.email || '').toLowerCase()) : []);
    const bad = want.filter(x => !mine.has(x));
    if (bad.length) return json(400, { error: `مو من يوزرز الشركة: ${bad.join('، ')}` });
    const u = await sb(cfg, `/rest/v1/companies?id=eq.${user.co}`, { method: 'PATCH', admin: true, body: { social_approvers: want } });
    if (!u.ok) return json(500, { error: 'ما انحفظ المعتمد' });
    await audit(cfg, user, 'social_approvers_set', { target: { approvers: want } });
    return json(200, { ok: true, approvers: want });
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
