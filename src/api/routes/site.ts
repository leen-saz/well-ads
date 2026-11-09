// /api/site/*: requests from the public Apipeline pages.
//   POST   /api/site/request   public (src/lib/gate.ts): the request form on /welcome/, /security/ and /profile/
//   GET    /api/site/requests  owner: the inbox (Settings → Website requests)
//   PATCH  /api/site/requests  owner: { id, status } new → contacted → closed
//   DELETE /api/site/requests  owner: { id } removes the row for good (a visitor asking to be forgotten, PDPL)
// The public route guards itself: same-origin only, a honeypot and a minimum fill time, consent required, and at most
// LIMIT_PER_HOUR requests per visitor per hour (counted by a daily keyed hash, never the address itself).
// If REQUESTS_WEBHOOK is set (a Worker secret: Slack, Teams or any automation URL), the owner gets a short note with
// no phone or email in it, only what was asked and where to read it.
import { json, readJson, handle, requireUser, sb, env, sameOrigin, missingSchema, notApplied, type AuthEnv, type Cfg } from '../../lib/auth';
import { cleanRequest, ipKey, LIMIT_PER_HOUR, KIND_AR, type SiteRequest } from '../../lib/site-request';

type SiteEnv = AuthEnv & { REQUESTS_WEBHOOK?: string };
const FILE = '027_site_requests.sql';
const STATUSES = ['new', 'contacted', 'closed'];

async function notify(hook: string | undefined, r: SiteRequest, origin: string) {
  if (!hook || !/^https:\/\//.test(hook)) return;
  const text = `طلب جديد من موقع Apipeline: ${KIND_AR[r.kind]}${r.company ? ` · ${r.company}` : ''}${r.scope.length ? ` · ${r.scope.join('، ')}` : ''}\n${origin}/admin/requests/`;
  await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(4000) })
    .catch(() => { console.warn('site_request_notify_failed'); });
}

async function tooMany(cfg: Cfg, key: string): Promise<boolean> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const r = await sb<unknown[]>(cfg, `/rest/v1/site_requests?ip_key=eq.${key}&at=gte.${encodeURIComponent(since)}&select=id&limit=${LIMIT_PER_HOUR}`, { admin: true });
  return r.ok && Array.isArray(r.data) && r.data.length >= LIMIT_PER_HOUR;
}

export const request = { POST: handle(async (req, e) => {
  let cfg: Cfg;
  try { cfg = env(e); } catch { return json(503, { error: 'الإرسال متوقف مؤقتًا، تواصل معنا واتساب' }); }
  if (!sameOrigin(req)) return json(403, { error: 'طلب مرفوض' });
  let body: Record<string, unknown>;
  try { body = await readJson(req, 6000); } catch { return json(400, { error: 'الطلب غير صالح' }); }
  const c = cleanRequest(body);
  if (!c.ok && 'bot' in c) return json(200, { ok: true });
  if (!c.ok) return json(400, { error: 'راجع الحقول المظللة', fields: c.errors });
  const key = await ipKey(req.headers.get('cf-connecting-ip') || 'unknown', cfg.secret);
  if (await tooMany(cfg, key)) return json(429, { error: 'وصلنا طلبك قبل شوي. بنتواصل معك قريب' });
  const w = await sb(cfg, '/rest/v1/site_requests', {
    method: 'POST', admin: true, headers: { Prefer: 'return=minimal' },
    body: { ...c.data, consent_at: new Date().toISOString(), ip_key: key },
  });
  if (!w.ok) {
    console.error('site_request_store_failed', JSON.stringify({ status: w.status, missing: missingSchema(w) }));
    return json(503, { error: 'ما قدرنا نحفظ الطلب الحين، تواصل معنا واتساب' });
  }
  // What was asked, never who asked: the log is not a place for phone numbers
  console.log(JSON.stringify({ event: 'site_request', kind: c.data.kind, page: c.data.page, scope: c.data.scope.length }));
  await notify((e as SiteEnv).REQUESTS_WEBHOOK, c.data, new URL(req.url).origin);
  return json(200, { ok: true });
}) };

export const requests = {
  GET: handle(async (req, e) => {
    const { cfg, user } = await requireUser(req, e, 'owner');
    const status = new URL(req.url).searchParams.get('status');
    const filter = status && STATUSES.includes(status) ? `&status=eq.${status}` : '';
    const r = await sb<unknown[]>(cfg, `/rest/v1/site_requests?select=id,at,kind,name,company,phone,email,scope,message,page,lang,status,handled_at${filter}&order=at.desc&limit=200`, { admin: true });
    if (missingSchema(r)) return json(200, { requests: [], missing: notApplied(user, FILE) });
    if (!r.ok) return json(502, { error: 'ما قدرنا نقرا الطلبات' });
    return json(200, { requests: r.data });
  }),
  PATCH: handle(async (req, e) => {
    const { cfg } = await requireUser(req, e, 'owner', { write: true });
    const b = await readJson(req, 500);
    const id = Number(b.id);
    if (!Number.isInteger(id) || id < 1 || !STATUSES.includes(String(b.status))) return json(400, { error: 'طلب غير صالح' });
    const r = await sb(cfg, `/rest/v1/site_requests?id=eq.${id}`, {
      method: 'PATCH', admin: true, headers: { Prefer: 'return=minimal' },
      body: { status: b.status, handled_at: b.status === 'new' ? null : new Date().toISOString() },
    });
    return r.ok ? json(200, { ok: true }) : json(502, { error: 'ما انحفظ التعديل' });
  }),
  DELETE: handle(async (req, e) => {
    const { cfg } = await requireUser(req, e, 'owner', { write: true });
    const id = Number((await readJson(req, 200)).id);
    if (!Number.isInteger(id) || id < 1) return json(400, { error: 'طلب غير صالح' });
    const r = await sb(cfg, `/rest/v1/site_requests?id=eq.${id}`, { method: 'DELETE', admin: true, headers: { Prefer: 'return=minimal' } });
    return r.ok ? json(200, { ok: true }) : json(502, { error: 'ما انحذف الطلب' });
  }),
};
