// /api/social/*: the post calendar of the user's company. Reads need the `social` dashboard, writes are same-origin.
// Publishing itself runs from the Worker cron (src/modules/social/cron.ts), never from the browser.
import { sb, json, readJson, handle, requireUser, audit, isOwner, type Cfg } from '../../lib/auth';
import { scoped, WELL_COMPANY } from '../../lib/tenant';
import { SOCIAL, readiness, validate, canApprove, cleanApprovers, suggestPrompt, cleanSuggestion, retryPlan, checkConnection, type SocialPlatform, type Results } from './social';
import { saveValues } from '../../lib/vault';
import { META_PENDING, pageValues, type PageCand } from '../../lib/connectors';
import { check } from '../compliance/compliance';
import { knowledgeFor, rulesFor, withKnowledge } from '../knowledge/knowledge';
import { generate, pick, type LlmEnv } from '../../lib/llm';
import { usageCtx } from '../../lib/usage';
import { MEDIA_TYPES, limitOf, tooBig, sniff, mediaKey } from './media';
import { cachedStatus, postizPlatforms, withEngineSecrets, type EngineStatus } from './postiz';

type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
// The company's named approvers (companies.social_approvers); empty = the owner only
async function approversOf(cfg: Cfg, company: string): Promise<string[]> {
  const r = await sb<{ social_approvers?: string[] | null }[]>(cfg, `/rest/v1/companies?id=eq.${company}&select=social_approvers`, { admin: true });
  return r.ok && Array.isArray(r.data) ? (r.data[0]?.social_approvers || []).map(x => x.toLowerCase()) : [];
}
const ONLY = (names: string[]) => names.length ? `الاعتماد لـ ${names.join('، ')} بس` : 'الاعتماد للمالك بس، أو للمعتمد اللي يحدده';
const day = (s: string | null, fallback: number) => { const t = Date.parse(s || ''); return new Date(Number.isFinite(t) ? t : fallback).toISOString(); };

// The connected accounts, as the publisher sees them (src/modules/social/cron.ts): Well's vault today
async function tokensFor(cfg: Cfg, co: string, e?: unknown): Promise<Record<string, string>> {
  if (co !== WELL_COMPANY) return {};
  const v = await sb<{ name: string; value: string }[]>(cfg, '/rest/v1/rpc/connector_env', { method: 'POST', admin: true, body: {} });
  return withEngineSecrets(Object.fromEntries((v.ok && Array.isArray(v.data) ? v.data : []).map(x => [x.name, x.value])), e);
}
// What the extra publishing engine reports (asked at most once a minute per Worker). A platform it carries is "ready" only when
// the engine is set up AND that account is connected there. Not asked at all when no Postiz platform is involved or none is set up.
const engineState = (t: Record<string, string>): Promise<EngineStatus> => cachedStatus(t);
// Per platform: '' when it can go out, else why not (no token values leave the server)
const readyOf = (t: Record<string, string>, s: EngineStatus | null) => Object.fromEntries((Object.keys(SOCIAL) as SocialPlatform[]).map(p => [p, readiness(p, t, s)]));
// The platform list the page gets: `live` = can go out by itself right now (nothing says which engine does it)
const platformsView = (ready: Record<string, string>) => Object.fromEntries((Object.entries(SOCIAL) as [SocialPlatform, (typeof SOCIAL)[SocialPlatform]][]).map(([k, s]) =>
  [k, { name: s.name, max: s.max, ...('needsMedia' in s && s.needsMedia ? { needsMedia: true } : {}), live: s.live && !ready[k]!.startsWith('غير متاح') }]));

// What each platform did, for the page: a code the page words in plain language. The platform's own message
// (and the ids and Instagram container, which only matter to the server) go to the owner alone.
function shownResults(v: unknown, owner: boolean): Results {
  const out: Results = {};
  for (const [k, r] of Object.entries((v && typeof v === 'object' ? v : {}) as Results)) {
    out[k] = { ok: !!r?.ok, ...(r?.code ? { code: r.code } : {}), ...(r?.state ? { state: r.state } : {}), ...(owner && r?.detail ? { detail: r.detail } : {}), ...(r?.ok && r.id ? { id: r.id } : {}) };
  }
  return out;
}
// The connected Facebook page and Instagram account: names only (never a token). Well's connection today.
async function accountOf(cfg: Cfg, co: string): Promise<{ page: string | null; instagram: string | null; pick: boolean } | null> {
  if (co !== WELL_COMPANY) return null;
  const r = await sb<{ shown?: Record<string, string>; names?: string[] }[]>(cfg, '/rest/v1/connections?platform=eq.meta_pages&select=shown,names', { admin: true });
  const c = r.ok && Array.isArray(r.data) ? r.data[0] : undefined;
  if (!c) return { page: null, instagram: null, pick: false };
  const sh = c.shown || {}, names = c.names || [];
  const hasPage = names.includes('META_PAGE_ID');
  return { page: hasPage ? sh.META_PAGE_NAME || (sh.META_PAGE_ID ? `#${sh.META_PAGE_ID}` : null) : null,
    instagram: names.includes('IG_USER_ID') ? sh.IG_ACCOUNT_NAME || (sh.IG_USER_ID ? `#${sh.IG_USER_ID}` : null) : null, pick: names.includes(META_PENDING) };
}

export const posts = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'social');
    const q = new URL(request.url).searchParams;
    const from = day(q.get('from'), Date.now() - 7 * 864e5), to = day(q.get('to'), Date.now() + 31 * 864e5);
    // The posts and everything the page needs beside them are asked together, not one after the other (each is a subrequest and a
    // round trip). Rows are small (media is a list of links, never the file) and capped by the date window and the limit.
    const owner = isOwner(user, cfg);
    const [r, extra, tk] = await Promise.all([
      sb(cfg, scoped(`/rest/v1/social_posts?select=*&publish_at=gte.${from}&publish_at=lte.${to}&order=publish_at.asc&limit=300`, user.co), { admin: true }),
      rulesFor(cfg, user.co), tokensFor(cfg, user.co, e)]);
    if (!r.ok) return json(500, { error: 'ما قدرت أقرأ المنشورات' });
    const [state, account] = await Promise.all([engineState(tk), accountOf(cfg, user.co)]);
    const ready = readyOf(tk, state);
    return json(200, { posts: rows(r.data).map(p => ({ ...p, results: shownResults(p.results, owner), compliance: check(String(p.body || ''), extra) })), platforms: platformsView(ready),
      ready, account });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'social', { write: true });
    const tk = await tokensFor(cfg, user.co, e), ready = readyOf(tk, await engineState(tk));
    const v = validate(await readJson(request), Date.now(), await rulesFor(cfg, user.co), p => SOCIAL[p].live && !ready[p]!.startsWith('غير متاح'));
    if (!v.draft) return json(400, { error: v.error, notices: v.notices });
    // A platform whose account is not connected would fail at its time: said now, while it can still be fixed
    for (const pl of v.draft.platforms) if (ready[pl] && SOCIAL[pl].live && !ready[pl].startsWith('غير متاح')) v.notices.push(`${SOCIAL[pl].name}: ${ready[pl]}`);
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
    if (!id || !['approve', 'cancel', 'retry'].includes(act)) return json(400, { error: 'طلب غير صحيح' });
    if (act === 'approve' || act === 'retry') {
      const list = await approversOf(cfg, user.co);
      if (!canApprove(user.email, list, isOwner(user, cfg))) return json(403, { error: ONLY(list) });
    }
    if (act === 'retry') {
      // One retry, only of the platforms that failed. The retrier is an approver, so the post is approved by them again and goes out at the next run.
      const cur = await sb<Row[]>(cfg, scoped(`/rest/v1/social_posts?id=eq.${id}&select=status,platforms,results,retried_at`, user.co), { admin: true });
      const post = cur.ok ? rows(cur.data)[0] : undefined;
      if (!post) return json(404, { error: 'المنشور مو موجود' });
      const plan = retryPlan(post as Parameters<typeof retryPlan>[0]);
      if ('error' in plan) return json(409, { error: { not_failed: 'المنشور مو فاشل', retried: 'انعادت المحاولة مرة. لو تبي تنشر ثاني، سوّ منشور جديد', nothing: 'ما فيه منصة تنعاد لها المحاولة' }[plan.error] });
      const now = new Date().toISOString();
      const r = await sb<Row[]>(cfg, scoped(`/rest/v1/social_posts?id=eq.${id}&status=eq.${post.status}&retried_at=is.null`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' },
        body: { status: 'scheduled', results: plan.results, retried_at: now, claimed_at: null, approved_by: user.email, approved_at: now } });
      if (!r.ok || !rows(r.data).length) return json(409, { error: 'المنشور تغيّر. حدّث الصفحة' });
      await audit(cfg, user, 'social_retried', { target: { id, platforms: (post.platforms as string[]).filter(k => !plan.results[k]) } });
      return json(200, { ok: true, post: rows(r.data)[0] });
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

// Which Facebook page (and its Instagram account) the Social tab publishes to. Connecting with several pages binds none
// of them (src/lib/connectors.ts): the owner chooses here. Names only come back; the page tokens stay in the vault.
async function pendingPages(cfg: Cfg): Promise<PageCand[]> {
  const v = await sb<{ name: string; value: string }[]>(cfg, '/rest/v1/rpc/connector_env', { method: 'POST', admin: true, body: {} });
  const raw = (v.ok && Array.isArray(v.data) ? v.data : []).find(x => x.name === META_PENDING)?.value;
  try {
    const j = JSON.parse(raw || '') as { at?: number; pages?: PageCand[] };
    return j.at && Date.now() - j.at < 3600e3 && Array.isArray(j.pages) ? j.pages : []; // a choice left for over an hour is asked again
  } catch { return []; }
}
export const pages = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'social', { well: true });
    if (!isOwner(user, cfg)) return json(403, { error: 'اختيار الصفحة للمالك بس' });
    const list = await pendingPages(cfg);
    return json(200, { account: await accountOf(cfg, user.co), choices: list.map(p => ({ id: p.id, name: p.name, instagram: p.ig?.name || null })) });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'social', { write: true, well: true });
    if (!isOwner(user, cfg)) return json(403, { error: 'اختيار الصفحة للمالك بس' });
    const id = String((await readJson(request)).id || '');
    const page = (await pendingPages(cfg)).find(p => p.id === id);
    if (!page) return json(409, { error: 'انتهت صلاحية القائمة. اربط ميتا من جديد وبتطلع لك الصفحات' });
    const got = pageValues(page);
    try { await saveValues(cfg, user, { id: 'meta_pages' }, 'oauth', got.values, { shown: got.shown, drop: got.drop, checked: 'اختار المالك الصفحة' }); }
    catch { return json(500, { error: 'ما انحفظت الصفحة' }); }
    return json(200, { ok: true, account: await accountOf(cfg, user.co) });
  }),
};

// "Test post" without posting: reads the page, the Instagram link and the token's permissions, and says what would stop a post.
export const connection = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'social', { well: true });
  if (!isOwner(user, cfg)) return json(403, { error: 'فحص الربط للمالك بس' });
  return json(200, await checkConnection(await tokensFor(cfg, user.co, e)));
}) };

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
  // The size is judged from the header before the body is touched; the body then goes to R2 as a stream (R2 stops at the
  // declared length, so a client that lies about it fails the put). Nothing is ever held in memory: a big video used to be
  // read whole by arrayBuffer(), which could take the Worker's 128 MB and every other request on that isolate with it.
  const size = Number(request.headers.get('content-length') || 0);
  if (request.headers.get('content-length') === '0') return json(400, { error: 'الملف فاضي' });
  if (!(size > 0) || !request.body) return json(411, { error: 'ما قدرنا نعرف حجم الملف، جرّب ترفعه مرة ثانية' });
  if (size > limitOf(type)) return json(413, { error: tooBig(type) });
  const key = mediaKey(user.co, ext);
  try { await files.put(key, request.body, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } }); }
  catch { return json(502, { error: 'انقطع الرفع، جرّب مرة ثانية' }); }
  // The first bytes must be what the type says (a renamed file is not a photo or video); a mismatch is deleted again
  const head = await files.get(key, { range: { offset: 0, length: 16 } }).catch(() => null);
  const real = head?.body ? sniff(new Uint8Array(await new Response(head.body).arrayBuffer())) : null;
  if (!real || (real !== type && !(real.startsWith('video/') && type.startsWith('video/')))) { await files.delete(key).catch(() => {}); return json(415, { error: 'محتوى الملف ما يطابق نوعه. ارفع صورة أو فيديو سليم' }); }
  const url = new URL('/m/' + key.slice('social/'.length), request.url).toString();
  return json(200, { ok: true, url, type: type.startsWith('video/') ? 'video' : 'image' });
}) };

// A post written by the social model (Grok when XAI_API_KEY is set, else Workers AI), checked before it is shown
export const suggest = { POST: handle(async (request, e: Parameters<typeof requireUser>[1] & LlmEnv) => {
  const { cfg, user } = await requireUser(request, e, 'social', { write: true });
  const b = await readJson(request);
  const brief = String(b.brief || '').trim().slice(0, 1000);
  const platforms = [...new Set(Array.isArray(b.platforms) ? b.platforms : [])].filter((p): p is SocialPlatform => typeof p === 'string' && p in SOCIAL);
  if (!brief) return json(400, { error: 'اكتب الفكرة في خانة النص أول' });
  if (!platforms.length) return json(400, { error: 'اختر منصة وحدة على الأقل' });
  if (!pick(e, 'social')) return json(503, { error: 'الكتابة بالذكاء الاصطناعي غير مفعّلة في هالبيئة' });
  let out;
  try { out = await generate(e, 'social', { messages: withKnowledge([{ role: 'user', content: suggestPrompt(brief, platforms) }], await knowledgeFor(cfg, user.co, 'social')), max_tokens: 600 }, fetch, usageCtx(cfg, user)); }
  catch { return json(503, { error: 'الذكاء الاصطناعي ما رد الحين، جرّب بعد دقيقة' }); }
  const text = cleanSuggestion(out.response, platforms);
  if (text.length < 20) return json(502, { error: 'ما طلع نص واضح، جرّب مرة ثانية' });
  return json(200, { body: text, engine: out.engine, compliance: check(text, await rulesFor(cfg, user.co)) });
}) };

// Owner only: is the extra publishing engine reachable, is its key valid, and which platforms have a connected account there.
// Reads only (nothing is posted); channel names only, never a key. Asked fresh every time (the page caches nothing).
export const engine = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'social', { well: true });
  if (!isOwner(user, cfg)) return json(403, { error: 'فحص النشر للمالك بس' });
  const s = await cachedStatus(await tokensFor(cfg, user.co, e), fetch, Date.now(), true);
  return json(200, { status: s.code, channels: s.channels, platforms: postizPlatforms.map(p => ({ key: p, name: SOCIAL[p].name })) });
}) };
