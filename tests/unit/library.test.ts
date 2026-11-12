// The shared library: saving with the compliance result, filters, favourites per user, edit and approve rules, company isolation
// and the audit trail. A small in-memory fake stands in for Supabase. Synthetic companies, users and texts only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { need } from '../../src/lib/gate';
import { clean, cleanEdit, KINDS } from '../../src/lib/library';
import { list as root, item, star, approve } from '../../src/api/routes/library';

const CO_A = '11111111-1111-1111-1111-111111111111', CO_B = '22222222-2222-2222-2222-222222222222';
const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com' };
const cfg = A.env(E);
const uid = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
const P = (n: number, email: string, co: string, access: Record<string, string>, role = 'member'): A.Profile => ({ id: uid(n), email, role, active: true, access, company_id: co } as A.Profile);
const owner = P(1, 'boss@example.com', CO_A, {}, 'owner');
const writer = P(2, 'w@example.com', CO_A, { copy: 'edit', design: 'edit' });
const writer2 = P(3, 'w2@example.com', CO_A, { copy: 'edit' });
const viewer = P(4, 'v@example.com', CO_A, { copy: 'view' });
const copyOnly = P(5, 'c@example.com', CO_A, { copy: 'edit' });
const otherCo = P(6, 'x@example.com', CO_B, { copy: 'edit', design: 'edit' });
const PROFILES = [owner, writer, writer2, viewer, copyOnly, otherCo];

type Row = Record<string, unknown> & { id: number; company_id: string };
let items: Row[], favs: Row[], audits: { action: string; target?: unknown }[], writes: string[], nextId: number;
const eq = (v: string | null) => (v?.startsWith('eq.') ? v.slice(3) : null);

beforeEach(() => {
  items = []; favs = []; audits = []; writes = []; nextId = 1;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url), q = u.searchParams, m = init.method || 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    const ok = (d: unknown) => new Response(JSON.stringify(d));
    if (u.pathname.endsWith('/profiles')) return ok(PROFILES.filter(p => p.id === eq(q.get('id'))));
    if (u.pathname.endsWith('/audit_log')) { audits.push(body); return ok([]); }
    if (u.pathname.endsWith('/library_items')) {
      if (m === 'POST') { writes.push('items'); const row = { review_status: 'draft', reviewed_by: null, approved_by: null, created_at: '2026-11-06T09:00:00Z', updated_at: '2026-11-06T09:00:00Z', ...body, id: nextId++ }; items.push(row); return ok([row]); }
      const co = eq(q.get('company_id')), id = eq(q.get('id'));
      const hit = items.filter(i => i.company_id === co && (!id || String(i.id) === id));
      if (m === 'PATCH') { writes.push('items'); hit.forEach(i => Object.assign(i, body)); return ok(hit); }
      const mods = /^in\.\((.*)\)$/.exec(q.get('module') || '')?.[1]?.split(','), kind = eq(q.get('kind')), ids = /^in\.\((.*)\)$/.exec(q.get('id') || '')?.[1]?.split(',');
      return ok(hit.filter(i => (!mods || mods.includes(String(i.module))) && (!kind || i.kind === kind) && (!ids || ids.includes(String(i.id)))));
    }
    if (u.pathname.endsWith('/library_favorites')) {
      if (m === 'POST') { if (!favs.some(f => f.item_id === body.item_id && f.user_id === body.user_id)) favs.push(body); return ok([]); }
      const co = eq(q.get('company_id')), user = eq(q.get('user_id')), id = eq(q.get('item_id'));
      if (m === 'DELETE') { favs = favs.filter(f => !(f.company_id === co && f.user_id === user && String(f.item_id) === id)); return ok([]); }
      return ok(favs.filter(f => f.company_id === co && f.user_id === user));
    }
    return ok([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const call = async (h: (r: Request, e: A.AuthEnv) => Response | Promise<Response>, who: A.Profile, body?: unknown, query = '') => {
  const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(who, cfg), cfg.secret))}`;
  return h(new Request('https://well.example/api/library' + query, { method: body === undefined ? 'GET' : body === null ? 'PATCH' : 'POST', ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } }), E);
};
const patch = (h: Parameters<typeof call>[0], who: A.Profile, body: unknown) => {
  return (async () => h(new Request('https://well.example/api/library/item', { method: 'PATCH', body: JSON.stringify(body),
    headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(who, cfg), cfg.secret))}`, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } }), E))();
};
const BAD = 'علاج نهائي ومضمون بسعر رخيص';
const save = async (who: A.Profile, extra: Record<string, unknown> = {}) =>
  (await call(root.POST, who, { module: 'copy', kind: 'text', title: 'عنوان', content: BAD, platform: 'meta', service: 'محاليل', ...extra })).json() as Promise<{ ok?: boolean; error?: string; item: { id: number; starred: boolean; review_status: string; compliance_result: { hits: { rule: string }[] } } }>;

describe('cleaning', () => {
  it('needs a known tab, kind and text; the title falls back to the start of the text; fields are cut', () => {
    expect(clean({ module: 'nope', content: 'x' }, ['copy'])).toEqual({ error: 'اختر الموديول اللي طلع منه الناتج' });
    expect(clean({ module: 'copy', kind: 'zip', content: 'x' }, ['copy'])).toEqual({ error: 'نوع الناتج غير معروف' });
    expect(clean({ module: 'copy', content: '   ' }, ['copy'])).toEqual({ error: 'ما فيه شي تحفظه' });
    const c = clean({ module: 'copy', content: 'ن'.repeat(100), platform: 'p'.repeat(90) }, ['copy']);
    expect(c).toMatchObject({ kind: 'text', title: 'ن'.repeat(60) });
    expect((c as { platform: string }).platform.length).toBe(40);
    expect(Object.keys(KINDS)).toEqual(['text', 'design', 'script', 'video']);
  });
  it('an edit takes only what is sent, and not an empty title or text', () => {
    expect(cleanEdit({ title: 'جديد' })).toEqual({ title: 'جديد' });
    expect(cleanEdit({ title: ' ' })).toEqual({ error: 'اكتب عنوان' });
    expect(cleanEdit({ content: '' })).toEqual({ error: 'النص فاضي' });
    expect(cleanEdit({})).toEqual({ error: 'ما فيه تعديل' });
  });
  it('the gate lets any signed-in user reach the library, and the routes check each tab', () => {
    expect(need('/library/', '')).toBe('any');
    expect(need('/api/library', '')).toBe('any');
    expect(need('/api/library/star', '')).toBe('any');
  });
});

describe('saving', () => {
  it('stores the text for the saver\'s company with its compliance result, as a draft, and audits it without the text', async () => {
    const r = await save(writer);
    expect(r.ok).toBe(true);
    expect(r.item).toMatchObject({ review_status: 'draft', starred: false });
    expect(r.item.compliance_result.hits.map(h => h.rule)).toEqual(expect.arrayContaining(['cure', 'guarantee']));
    expect(items[0]).toMatchObject({ company_id: CO_A, module: 'copy', kind: 'text', created_by: 'w@example.com', created_by_id: uid(2), approved_by: null });
    expect(audits).toEqual([{ user_id: uid(2), email: 'w@example.com', company_id: CO_A, action: 'library_saved', target: { id: 1, module: 'copy', kind: 'text' } }]);
    expect(JSON.stringify(audits)).not.toContain('مضمون');
  });
  it('the star on the output saves and favourites in one go', async () => {
    const r = await save(writer, { star: true });
    expect(r.item.starred).toBe(true);
    expect(favs).toEqual([{ company_id: CO_A, item_id: 1, user_id: uid(2) }]);
    expect(audits.map(a => a.action)).toEqual(['library_saved', 'library_starred']);
  });
  it('needs edit on the tab the output came from: a viewer, or a tab the person has no access to, saves nothing', async () => {
    expect((await call(root.POST, viewer, { module: 'copy', content: 'x' })).status).toBe(400);
    expect((await call(root.POST, copyOnly, { module: 'design', content: 'x' })).status).toBe(400);
    expect((await call(root.POST, writer, { module: 'maestro', content: 'x' })).status).toBe(400);
    expect(writes).toEqual([]);
  });
  it('a missing table says which migration to run', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/profiles') ? [writer] : { code: 'PGRST205' }), { status: url.includes('/profiles') ? 200 : 404 })));
    const r = await call(root.GET, writer);
    expect(r.status).toBe(503);
    // A normal user is told to ask the owner: no file name, no Supabase
    const said = ((await r.json()) as { error: string }).error;
    expect(said).not.toMatch(/020_library|Supabase|SQL/);
    expect(said).toContain('بلّغ الإدارة');
  });
  it('the owner is pointed to the Data health page, with no file name', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/profiles') ? [owner] : { code: 'PGRST205' }), { status: url.includes('/profiles') ? 200 : 404 })));
    const r = await call(root.GET, owner);
    expect(((await r.json()) as { error: string }).error).not.toMatch(/020_library|Supabase|SQL/);
  });
});

describe('reading and favourites', () => {
  it('lists the items of the tabs the user may open, with their own stars, and filters', async () => {
    await save(writer); await save(writer, { module: 'design', kind: 'design', title: 'تصميم' });
    const all = await (await call(root.GET, writer)).json() as { items: { id: number; module: string; starred: boolean }[]; modules: { key: string; ok: boolean; save: boolean }[]; owner: boolean };
    expect(all.items.map(i => i.module).sort()).toEqual(['copy', 'design']);
    expect(all.owner).toBe(false);
    expect(all.modules.find(m => m.key === 'copy')).toMatchObject({ ok: true, save: true });
    expect((await (await call(root.GET, writer, undefined, '?module=design')).json() as { items: unknown[] }).items.length).toBe(1);
    expect((await (await call(root.GET, writer, undefined, '?kind=design')).json() as { items: unknown[] }).items.length).toBe(1);
    // a person with only the copy tab never sees the design item, even when asking for it
    expect((await (await call(root.GET, copyOnly)).json() as { items: { module: string }[] }).items.map(i => i.module)).toEqual(['copy']);
    expect((await (await call(root.GET, copyOnly, undefined, '?module=design')).json() as { items: unknown[] }).items).toEqual([]);
  });
  it('favourites are per user: one person\'s star is not another\'s, and «المفضلة» filters to the caller\'s', async () => {
    const { item: it } = await save(writer);
    expect(((await (await call(star.POST, writer, { id: it.id })).json()) as { starred: boolean }).starred).toBe(true);
    const mine = await (await call(root.GET, writer)).json() as { items: { starred: boolean }[] };
    const theirs = await (await call(root.GET, writer2)).json() as { items: { starred: boolean }[] };
    expect([mine.items[0]!.starred, theirs.items[0]!.starred]).toEqual([true, false]);
    expect((await (await call(root.GET, writer, undefined, '?starred=1')).json() as { items: unknown[] }).items.length).toBe(1);
    expect((await (await call(root.GET, writer2, undefined, '?starred=1')).json() as { items: unknown[] }).items).toEqual([]);
    expect(((await (await call(star.POST, writer, { id: it.id, on: false })).json()) as { starred: boolean }).starred).toBe(false);
    expect(favs).toEqual([]);
    expect(audits.map(a => a.action)).toEqual(['library_saved', 'library_starred', 'library_unstarred']);
  });
});

describe('company isolation', () => {
  it('another company never sees, stars, edits or approves an item', async () => {
    const { item: it } = await save(writer);
    expect((await (await call(root.GET, otherCo)).json() as { items: unknown[] }).items).toEqual([]);
    expect((await call(star.POST, otherCo, { id: it.id })).status).toBe(404);
    expect((await patch(item.PATCH, otherCo, { id: it.id, title: 'x' })).status).toBe(404);
    const ownerB = P(7, 'boss2@example.com', CO_B, {}, 'owner');
    PROFILES.push(ownerB);
    expect((await call(approve.POST, ownerB, { id: it.id })).status).toBe(404);
    expect(items[0]).toMatchObject({ review_status: 'draft', title: 'عنوان' });
    expect(favs).toEqual([]);
  });
  it('a saved item carries the saver\'s company, never a company from the request body', async () => {
    await call(root.POST, otherCo, { module: 'copy', content: 'نص', company_id: CO_A });
    expect(items[0]!.company_id).toBe(CO_B);
  });
});

describe('edit and approve', () => {
  it('the saver edits their own draft, not another person\'s item; the owner edits anything', async () => {
    const { item: it } = await save(writer);
    expect((await patch(item.PATCH, writer2, { id: it.id, title: 'غيره' })).status).toBe(403);
    expect((await patch(item.PATCH, viewer, { id: it.id, title: 'غيره' })).status).toBe(403);
    expect((await patch(item.PATCH, writer, { id: it.id, title: 'عنواني' })).status).toBe(200);
    expect((await patch(item.PATCH, owner, { id: it.id, platform: 'snap' })).status).toBe(200);
    expect(items[0]).toMatchObject({ title: 'عنواني', platform: 'snap' });
    expect(audits.filter(a => a.action === 'library_edited').length).toBe(2);
  });
  it('only the owner approves; a member, even with edit, cannot', async () => {
    const { item: it } = await save(writer);
    expect((await call(approve.POST, writer, { id: it.id })).status).toBe(403);
    expect(items[0]!.review_status).toBe('draft');
    const r = await call(approve.POST, owner, { id: it.id });
    expect(r.status).toBe(200);
    expect(items[0]).toMatchObject({ review_status: 'approved', approved_by: 'boss@example.com', reviewed_by: 'boss@example.com' });
    expect(audits.at(-1)).toMatchObject({ action: 'library_approved', target: { id: it.id, module: 'copy' } });
  });
  it('once approved, only the owner edits it, and a changed text is checked again and goes back to draft', async () => {
    const { item: it } = await save(writer);
    await call(approve.POST, owner, { id: it.id });
    expect((await patch(item.PATCH, writer, { id: it.id, title: 'x' })).status).toBe(403);
    const r = await patch(item.PATCH, owner, { id: it.id, content: 'نص هادي بدون ادعاءات' });
    expect(r.status).toBe(200);
    expect(items[0]).toMatchObject({ review_status: 'draft', approved_by: null, reviewed_by: null });
    expect((items[0]!.compliance_result as { hits: unknown[] }).hits).toEqual([]);
    expect(audits.at(-1)).toMatchObject({ action: 'library_edited', target: { reset: true, fields: ['content'] } });
    expect(JSON.stringify(audits)).not.toContain('هادي');
  });
  it('a title-only edit by the owner keeps the approval', async () => {
    const { item: it } = await save(writer);
    await call(approve.POST, owner, { id: it.id });
    await patch(item.PATCH, owner, { id: it.id, title: 'عنوان جديد' });
    expect(items[0]).toMatchObject({ review_status: 'approved', title: 'عنوان جديد' });
  });
});
