// /api/library: the company's shared library of outputs (docs/library.md). Anyone signed in reads the items of the tabs
// they may open; saving needs edit on the tab the output came from. The owner edits and approves everything. Every write
// goes to audit_log (ids and tab names only, never the text). Each item keeps the compliance result of its text.
import { sb, json, readJson, handle, requireUser, audit, isOwner, can, atLeast, missingSchema, notApplied, type Cfg, type Session } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { MODULES } from '../../modules/registry';
import { rulesFor } from '../../modules/knowledge/knowledge';
import { check } from '../../modules/compliance/compliance';
import { KINDS, clean, cleanEdit, complianceOf, type Item } from '../../lib/library';

const MIGRATION = 'migration 020_library.sql';
// The tabs whose outputs are saved here
const SOURCES = ['copy', 'content', 'design', 'voice', 'social', 'journeys', 'transcribe', 'vision', 'voiceover'];
const TABS = MODULES.filter(m => m.status === 'live' && SOURCES.includes(m.key));
const readable = (u: Session, cfg: Cfg) => TABS.filter(m => can(u, m.key, cfg)).map(m => m.key);
const writable = (u: Session, cfg: Cfg) => TABS.filter(m => can(u, m.key, cfg) && atLeast(u, m.key, 'edit', cfg)).map(m => m.key);
const rows = (d: unknown): Item[] => (Array.isArray(d) ? (d as Item[]) : []);
const view = (i: Item, stars: Set<number>, uid: string) => { const { created_by_id, ...rest } = i; return { ...rest, starred: stars.has(i.id), mine: !!created_by_id && created_by_id === uid }; };
const fail = (user: Session, r: { status: number; data: unknown; ok: boolean }, say: string) => json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(user, MIGRATION) : say });
const safe = (s: string | null, n: number) => (s || '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, n);

async function stars(cfg: Cfg, co: string, uid: string): Promise<Set<number>> {
  const r = await sb<{ item_id: number }[]>(cfg, scoped(`/rest/v1/library_favorites?select=item_id&user_id=eq.${encodeURIComponent(uid)}&limit=1000`, co), { admin: true });
  return new Set(Array.isArray(r.data) ? r.data.map(x => Number(x.item_id)) : []);
}
// One item of this company, if the user may open its tab
async function one(cfg: Cfg, u: Session, id: number): Promise<Item | null> {
  if (!(id > 0)) return null;
  const r = await sb<Item[]>(cfg, scoped(`/rest/v1/library_items?id=eq.${id}&select=*`, u.co), { admin: true });
  const it = rows(r.data)[0];
  return it && readable(u, cfg).includes(it.module) ? it : null;
}

export const list = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any');
    const allowed = readable(user, cfg), q = new URL(request.url).searchParams;
    const meta = { modules: TABS.map(m => ({ key: m.key, ar: m.ar, ok: allowed.includes(m.key), save: writable(user, cfg).includes(m.key) })), kinds: KINDS, owner: isOwner(user, cfg) };
    if (!allowed.length) return json(200, { items: [], ...meta });
    const mod = q.get('module'), want = mod ? (allowed.includes(mod) ? [mod] : []) : allowed;
    if (!want.length) return json(200, { items: [], ...meta });
    const mine = await stars(cfg, user.co, user.uid);
    let path = `/rest/v1/library_items?select=*&order=created_at.desc&limit=300&module=in.(${want.join(',')})`;
    const kind = q.get('kind'); if (kind && kind in KINDS) path += `&kind=eq.${kind}`;
    const platform = safe(q.get('platform'), 40); if (platform) path += `&platform=eq.${encodeURIComponent(platform)}`;
    const service = safe(q.get('service'), 120); if (service) path += `&service=ilike.${encodeURIComponent(`*${service}*`)}`;
    const text = safe(q.get('q'), 40); if (text) path += `&or=${encodeURIComponent(`(title.ilike.*${text}*,content.ilike.*${text}*)`)}`;
    if (q.get('starred') === '1') { if (!mine.size) return json(200, { items: [], ...meta }); path += `&id=in.(${[...mine].join(',')})`; }
    const r = await sb<Item[]>(cfg, scoped(path, user.co), { admin: true });
    if (!r.ok) return fail(user, r, 'ما قدرت أقرأ المكتبة');
    return json(200, { items: rows(r.data).map(i => view(i, mine, user.uid)), ...meta });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any', { write: true });
    const b = await readJson(request, 60_000);
    const c = clean(b, writable(user, cfg));
    if ('error' in c) return json(400, { error: c.error });
    const hits = check(c.content, await rulesFor(cfg, user.co));
    const r = await sb<Item[]>(cfg, '/rest/v1/library_items', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { ...c, company_id: user.co, compliance_result: complianceOf(hits), created_by: user.email, created_by_id: user.uid } });
    const item = rows(r.data)[0];
    if (!r.ok || !item) return fail(user, r, 'ما انحفظ');
    await audit(cfg, user, 'library_saved', { target: { id: item.id, module: c.module, kind: c.kind } });
    let starred = false;
    if (b.star === true) {
      const f = await sb(cfg, '/rest/v1/library_favorites?on_conflict=item_id,user_id', { method: 'POST', admin: true, headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: { company_id: user.co, item_id: item.id, user_id: user.uid } });
      starred = f.ok;
      if (starred) await audit(cfg, user, 'library_starred', { target: { id: item.id } });
    }
    return json(200, { ok: true, item: view(item, new Set(starred ? [item.id] : []), user.uid) });
  }),
};

// Edit: the owner anything; the person who saved it, while it is not yet approved. A changed text is checked again and
// sends an approved item back to draft.
export const item = { PATCH: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  const b = await readJson(request, 60_000);
  const it = await one(cfg, user, parseInt(String(b.id), 10));
  if (!it) return json(404, { error: 'العنصر مو موجود' });
  const owner = isOwner(user, cfg);
  if (!owner && !(it.created_by_id === user.uid && it.review_status !== 'approved' && writable(user, cfg).includes(it.module))) return json(403, { error: 'ما عندك صلاحية تعدّل هالعنصر' });
  const c = cleanEdit(b);
  if ('error' in c) return json(400, { error: c.error });
  const changedText = c.content !== undefined && c.content !== it.content;
  const reset = changedText && it.review_status !== 'draft' && it.review_status !== 'returned';
  const patch: Record<string, unknown> = { ...c, updated_at: new Date().toISOString() };
  if (changedText) patch.compliance_result = complianceOf(check(c.content!, await rulesFor(cfg, user.co)));
  if (reset) Object.assign(patch, { review_status: 'draft', approved_by: null, reviewed_by: null });
  const r = await sb<Item[]>(cfg, scoped(`/rest/v1/library_items?id=eq.${it.id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: patch });
  const out = rows(r.data)[0];
  if (!r.ok || !out) return fail(user, r, 'ما انحفظ التعديل');
  await audit(cfg, user, 'library_edited', { target: { id: it.id, module: it.module, fields: Object.keys(c), reset } });
  return json(200, { ok: true, item: view(out, await stars(cfg, user.co, user.uid), user.uid) });
}) };

export const star = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  const b = await readJson(request, 2000);
  const it = await one(cfg, user, parseInt(String(b.id), 10));
  if (!it) return json(404, { error: 'العنصر مو موجود' });
  const have = (await stars(cfg, user.co, user.uid)).has(it.id);
  const on = typeof b.on === 'boolean' ? b.on : !have;
  const r = on
    ? await sb(cfg, '/rest/v1/library_favorites?on_conflict=item_id,user_id', { method: 'POST', admin: true, headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: { company_id: user.co, item_id: it.id, user_id: user.uid } })
    : await sb(cfg, scoped(`/rest/v1/library_favorites?item_id=eq.${it.id}&user_id=eq.${encodeURIComponent(user.uid)}`, user.co), { method: 'DELETE', admin: true });
  if (!r.ok) return fail(user, r, 'ما تغيّرت النجمة');
  await audit(cfg, user, on ? 'library_starred' : 'library_unstarred', { target: { id: it.id } });
  return json(200, { ok: true, starred: on });
}) };

// The owner approves any item. Reviewing by Anas and Shakib's approval are phase 4; until then the owner holds both.
export const approve = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
  const it = await one(cfg, user, parseInt(String((await readJson(request, 2000)).id), 10));
  if (!it) return json(404, { error: 'العنصر مو موجود' });
  const r = await sb<Item[]>(cfg, scoped(`/rest/v1/library_items?id=eq.${it.id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' },
    body: { review_status: 'approved', approved_by: user.email, reviewed_by: it.reviewed_by || user.email, updated_at: new Date().toISOString() } });
  const out = rows(r.data)[0];
  if (!r.ok || !out) return fail(user, r, 'ما انعمّد');
  await audit(cfg, user, 'library_approved', { target: { id: it.id, module: it.module } });
  return json(200, { ok: true, item: view(out, await stars(cfg, user.co, user.uid), user.uid) });
}) };
