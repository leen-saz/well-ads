// Motion graphics (the Design tab's «موشن جرافيك» type): the plan is cleaned before it is stored, the frames follow the voice's clock, and the routes keep every
// version (an edit adds one, never changes one), need approve to approve, and only take this company's files.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { pick } from '../../lib/llm';
import { checkUpload, cleanSpec, editPrompt, fileKey, ownKey, parseSpec, specPrompt, templateSpec, type Spec } from './motion';
import { videoapprove, videoedit, video, videos } from './video';
// The page's own frame logic (public/modules/design/frame.js), so the preview tested here is the one drawn
import { frame } from '../../../public/modules/design/frame.js';

const CO = '00000000-0000-0000-0000-000000000001';
const KEY = (x: string, ext: string) => `motion/${CO}/${x.repeat(32)}.${ext}`;

describe('the plan', () => {
  it('clamps times to the voice, sorts, trims overlaps and replaces unknown values', () => {
    const s = cleanSpec({ move: 'spin', colors: { text: 'red', band: '#112233' }, scenes: [
      { from: 4, to: 99, text: 'ثاني', anim: 'explode', pos: 'side', size: 'xl' },
      { from: 0, to: 5, text: '<b>أول</b>', anim: 'type', pos: 'top', size: 'l' },
      { from: 1, to: 1.2, text: 'قصير' }, { from: 2, to: 3, text: '' },
    ], cta: { text: 'احجز', from: 50 } }, 10, '9:16', ['#ABCDEF'])!;
    expect(s.move).toBe('in');
    expect(s.colors).toEqual({ text: '#FFFFFF', band: '#112233', accent: '#E9A23B' });
    expect(s.scenes).toEqual([
      { from: 0, to: 4, text: 'b أول /b', anim: 'type', pos: 'top', size: 'l' },
      { from: 4, to: 10, text: 'ثاني', anim: 'fade', pos: 'center', size: 'm' },
    ]);
    expect(s.cta).toEqual({ text: 'احجز', from: 9 });
    expect(cleanSpec({ scenes: [] }, 10, '1:1')).toBeNull();
    expect(cleanSpec('nope', 10, '1:1')).toBeNull();
  });

  it('builds v1 from a template without a model, spread over the voice, in brand colours', () => {
    const s = templateSpec({ headline: 'المحاليل في بيتك', script: 'نجيك البيت. ممرضة مرخصة؟ احجز اليوم.', seconds: 12, ratio: '1:1', colors: ['#7E57FD'] })!;
    expect(s.scenes.map(x => x.text)).toEqual(['المحاليل في بيتك', 'نجيك البيت.', 'ممرضة مرخصة؟', 'احجز اليوم.']);
    expect(s.scenes.at(-1)!.to).toBeLessThanOrEqual(12);
    expect(s.cta?.text).toBe('احجز الحين');
    expect(s.colors.band).toBe('#7E57FD');
  });

  it('reads JSON from a fenced answer and puts the current plan and the request in the edit prompt', () => {
    expect(parseSpec('هذي الخطة:\n```json\n{"move":"out"}\n```')).toEqual({ move: 'out' });
    expect(parseSpec('ما فيه')).toBeNull();
    const cur = templateSpec({ headline: 'عنوان', script: '', seconds: 6, ratio: '9:16' })!;
    const p = editPrompt(cur, 'كبّر العنوان')[0]!.content;
    expect(p).toContain('«كبّر العنوان»');
    expect(p).toContain('"text":"عنوان"');
    expect(specPrompt({ headline: 'ع', script: 'ن', seconds: 20, ratio: '16:9', colors: [] })[0]!.content).toContain('20 ثانية');
  });

  it("the motion plan is written by ChatGPT (OpenAI), Workers AI when the key is missing", () => {
    expect(pick({ OPENAI_API_KEY: 'k', XAI_API_KEY: 'k' }, 'motion')?.provider).toBe('openai');
    expect(pick({ AI: { run: vi.fn() } }, 'motion')?.provider).toBe('workers');
  });

  it('accepts only image/audio uploads under the limits, keyed under the company', () => {
    expect(checkUpload('design', 'image/png', 100).ext).toBe('png');
    expect(checkUpload('design', 'image/svg+xml', 100).error).toBeTruthy();
    expect(checkUpload('voice', 'audio/wav', 30_000_000).error).toContain('الحد');
    expect(checkUpload('voice', 'audio/mpeg', 0).error).toBeTruthy();
    const k = fileKey(CO, 'wav', () => 'a'.repeat(32));
    expect(k).toBe(KEY('a', 'wav'));
    expect(ownKey(CO, k)).toBe(true);
    expect(ownKey('00000000-0000-0000-0000-000000000002', k)).toBe(false);
    expect(ownKey(CO, `motion/${CO}/../x.wav`)).toBe(false);
  });
});

describe('frames', () => {
  const spec = cleanSpec({ move: 'in', scenes: [{ from: 1, to: 4, text: 'مرحبا بك', anim: 'type' }, { from: 4, to: 8, text: 'ثاني', anim: 'pop' }], cta: { text: 'احجز', from: 8 } }, 10, '9:16')!;
  it('shows only the scene of the moment, types it in, then the CTA', () => {
    expect(frame(spec, 0.5).layers).toEqual([]);
    const typing = frame(spec, 1.5).layers[0];
    expect(typing.chars).toBeGreaterThan(0);
    expect(typing.chars).toBeLessThan('مرحبا بك'.length);
    expect(frame(spec, 3).layers[0].chars).toBe('مرحبا بك'.length);
    const pop = frame(spec, 6).layers;
    expect(pop.map((l: { text: string }) => l.text)).toEqual(['ثاني']);
    expect(pop[0].scale).toBeCloseTo(1, 2);
    expect(frame(spec, 7.9).cta).toBeNull();
    expect(frame(spec, 9.5).cta?.alpha).toBeCloseTo(1, 2);
  });
  it('zooms the design in over the whole video', () => {
    expect(frame(spec, 0).bg.scale).toBe(1);
    expect(frame(spec, 10).bg.scale).toBeCloseTo(1.12);
  });
});

// ---- routes, with Supabase, OpenAI and the session stood in
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const OWNER: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true, company_id: CO };
const EDITOR: A.Profile = { id: '33333333-3333-3333-3333-333333333333', email: 'sara@example.com', active: true, company_id: CO, access: { design: 'edit' } };
const req = async (who: A.Profile, path: string, body?: unknown) => new Request('https://well.example' + path, {
  method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(who, cfg), cfg.secret))}`, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } });

const PLAN = { move: 'out', scenes: [{ from: 0, to: 5, text: 'من ChatGPT', anim: 'rise', pos: 'bottom', size: 'l' }], cta: { text: 'اطلب زيارة', from: 7 } };
function world(who: A.Profile) {
  const db = { project: null as Record<string, unknown> | null, versions: [] as Record<string, unknown>[], patches: [] as Record<string, unknown>[], openai: [] as string[] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const m = init.method || 'GET', body = init.body ? JSON.parse(String(init.body)) : null;
    const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
    if (url.startsWith('https://api.openai.com/')) { db.openai.push(String(init.body)); return ok({ output_text: JSON.stringify(PLAN) }); }
    if (url.includes('/profiles?')) return ok([who]);
    if (url.includes('/companies?')) return ok([{ id: CO, name: 'Well', paperclip_company_id: null }]);
    if (url.includes('/motion_projects')) {
      if (m === 'POST') { db.project = { ...body, id: 7, status: 'draft', approved_version: null }; return ok([db.project]); }
      if (m === 'PATCH') { db.patches.push(body); Object.assign(db.project!, body); return ok([]); }
      expect(url).toContain(`company_id=eq.${CO}`);
      return ok(db.project ? [db.project] : []);
    }
    if (url.includes('/motion_versions')) {
      if (m === 'POST') { db.versions.push({ ...body, created_at: '2026-11-03' }); return ok([body]); }
      expect(url).toContain(`company_id=eq.${CO}`);
      return ok(db.versions);
    }
    return ok([]);
  }));
  return db;
}
afterEach(() => { vi.unstubAllGlobals(); });

const NEW = { title: 'محاليل', headline: 'المحاليل في بيتك', script: 'نجيك البيت. احجز اليوم.', ratio: '9:16', design_key: KEY('a', 'png'), design_mime: 'image/png', voice_key: KEY('b', 'wav'), voice_mime: 'audio/wav', voice_seconds: 10 };

describe('video routes', () => {
  it('creates a project and v1 from ChatGPT, then an edit adds v2 and keeps v1 as it was', async () => {
    const db = world(OWNER);
    const env = { ...E, OPENAI_API_KEY: 'sk-test' };
    const r = await video.POST(await req(OWNER, '/api/design/video', NEW), env);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, id: 7, engine: 'openai' });
    expect(db.versions).toHaveLength(1);
    expect(db.versions[0]).toMatchObject({ version: 1, project_id: 7, engine: 'openai', company_id: CO });
    expect((db.versions[0]!.spec as Spec).scenes[0]!.text).toBe('من ChatGPT');
    const v1 = JSON.stringify(db.versions[0]);

    db.project!.status = 'approved'; db.project!.approved_version = 1;
    const e = await videoedit.POST(await req(OWNER, '/api/design/videoedit', { id: 7, from: 1, change: 'خل الزر «اطلب زيارة»' }), env);
    expect(e.status).toBe(200);
    expect(await e.json()).toMatchObject({ ok: true, version: 2 });
    expect(db.versions).toHaveLength(2);
    expect(JSON.stringify(db.versions[0])).toBe(v1);
    expect(db.versions[1]).toMatchObject({ version: 2, parent_version: 1, change_request: 'خل الزر «اطلب زيارة»', engine: 'openai' });
    expect(db.openai.at(-1)).toContain('اطلب زيارة');
    // an edit after approval sends the project back to draft
    expect(db.project).toMatchObject({ status: 'draft', approved_version: null });

    const list = await (await videos.GET(await req(OWNER, '/api/design/videos?id=7'), env)).json() as { versions: unknown[]; ready: boolean };
    expect(list.versions).toHaveLength(2);
    expect(list.ready).toBe(true);
  });

  it('falls back to the template without a key, and refuses edits then', async () => {
    const db = world(OWNER);
    const r = await video.POST(await req(OWNER, '/api/design/video', NEW), E);
    expect(await r.json()).toMatchObject({ engine: 'templates' });
    expect(db.openai).toEqual([]);
    const e = await videoedit.POST(await req(OWNER, '/api/design/videoedit', { id: 7, change: 'أي شي' }), E);
    expect(e.status).toBe(503);
    expect(db.versions).toHaveLength(1);
  });

  it("refuses another company's files and a missing voice length", async () => {
    world(OWNER);
    const other = `motion/00000000-0000-0000-0000-000000000002/${'c'.repeat(32)}.png`;
    expect((await video.POST(await req(OWNER, '/api/design/video', { ...NEW, design_key: other }), E)).status).toBe(400);
    expect((await video.POST(await req(OWNER, '/api/design/video', { ...NEW, voice_seconds: 1 }), E)).status).toBe(400);
  });

  it('approving needs approve on Design, and only an existing version', async () => {
    const db = world(EDITOR);
    await video.POST(await req(EDITOR, '/api/design/video', NEW), E);
    expect((await videoapprove.POST(await req(EDITOR, '/api/design/videoapprove', { id: 7, version: 1 }), E)).status).toBe(403);
    expect(db.patches).toEqual([]);

    const db2 = world(OWNER);
    await video.POST(await req(OWNER, '/api/design/video', NEW), E);
    expect((await videoapprove.POST(await req(OWNER, '/api/design/videoapprove', { id: 7, version: 3 }), E)).status).toBe(404);
    expect((await videoapprove.POST(await req(OWNER, '/api/design/videoapprove', { id: 7, version: 1 }), E)).status).toBe(200);
    expect(db2.project).toMatchObject({ status: 'approved', approved_version: 1, approved_by: 'leen@example.com' });
  });
});
