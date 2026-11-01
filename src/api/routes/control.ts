// /api/control/*. Port of web/lib/routes/control/*.js (decisions board), same behaviour and guards:
// reads need the `control` dashboard, writes are same-origin, owner-only actions stay owner-only,
// nothing here touches an ad platform (the executor in pipeline/modules/execute does, behind its guards).
import { check } from '../../lib/rules';
import { sb, json, readJson, handle, requireUser, audit, isOwner, DEPTS, type Cfg, type Session } from '../../lib/auth';

type Row = Record<string, unknown>;
const PLATFORMS = ['meta', 'snap', 'tiktok', 'google'];
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
const now = () => new Date().toISOString();
const MERGE = { Prefer: 'return=representation,resolution=merge-duplicates' };

// ---- suggestions: read, decide (approve / reject / modify, one or up to 50), revert an executed Meta pause
const DECISIONS: Record<string, string> = { approve: 'approved', reject: 'rejected', modify: 'modified' };

async function revert(cfg: Cfg, user: Session, body: Row): Promise<Response> {
  const id = parseInt(String(body.id), 10);
  const note = String(body.note || '').trim().slice(0, 2000);
  if (!id || !note) return json(400, { error: 'اكتب سبب التراجع' });
  const o = await sb(cfg, `/rest/v1/suggestions?id=eq.${id}&select=*`, { admin: true });
  const s = o.ok ? rows(o.data)[0] : undefined;
  if (!s || s.status !== 'executed' || s.kind !== 'pause' || s.platform !== 'meta') return json(409, { error: 'التراجع بس على إيقاف تنفّذ' });
  const dup = await sb(cfg, `/rest/v1/suggestions?kind=eq.resume&target_id=eq.${encodeURIComponent(String(s.target_id))}&status=eq.approved&select=id`, { admin: true });
  if (dup.ok && rows(dup.data).length) return json(409, { error: 'فيه طلب تراجع ينتظر التنفيذ' });
  const at = now();
  const result = (s.result || {}) as Row;
  const r = await sb(cfg, '/rest/v1/suggestions', {
    method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: {
      platform: 'meta', level: s.level, target_id: s.target_id, target_name: s.target_name, campaign: s.campaign, kind: 'resume',
      params: { of: id, ...(result.via_adset ? { adset: result.via_adset } : {}) },
      reason: `تراجع عن إيقاف #${id}`, evidence: {}, priority: 100, source: 'manual', requested_by: user.email,
      status: 'approved', note, decided_by: user.email, decided_at: at,
    },
  });
  if (!r.ok) return json(500, { error: 'ما انحفظ التراجع' });
  await audit(cfg, user, 'suggestion_revert', { target: { id, platform: 'meta', kind: 'resume', target_id: s.target_id, target_name: s.target_name }, note });
  const done = rows(r.data);
  return json(200, { ok: true, done, skipped: [], suggestion: done[0] });
}

export const suggestions = {
  GET: handle(async (request, e) => {
    const { cfg } = await requireUser(request, e, 'control');
    const p = new URL(request.url).searchParams.get('platform') || '';
    const filter = PLATFORMS.includes(p) ? `&platform=eq.${p}` : '';
    const open = await sb(cfg, `/rest/v1/suggestions?select=*&status=eq.open${filter}&order=priority.desc,created_at.desc&limit=300`, { admin: true });
    const done = await sb(cfg, `/rest/v1/suggestions?select=*&status=neq.open${filter}&order=decided_at.desc&limit=100`, { admin: true });
    if (!open.ok || !done.ok) return json(500, { error: 'ما قدرت أقرأ الاقتراحات' });
    return json(200, { open: open.data, done: done.data });
  }),
  POST: handle(async (request, e) => {
    // Deciding suggestions is an approval: it needs the approve level on the decisions board
    const { cfg, user } = await requireUser(request, e, 'control', { write: true, approve: true });
    const body = await readJson(request);
    if (body.decision === 'revert') return revert(cfg, user, body);
    const status = DECISIONS[String(body.decision)];
    const note = String(body.note || '').trim().slice(0, 2000);
    const raw = Array.isArray(body.ids) ? body.ids : [body.id];
    const ids = [...new Set(raw.map(x => parseInt(String(x), 10)).filter(Boolean))];
    if (!ids.length || ids.length > 50 || !status) return json(400, { error: 'قرار غير معروف' });
    if ((status === 'modified' || status === 'rejected') && !note)
      return json(400, { error: status === 'rejected' ? 'اكتب سبب الرفض' : 'اكتب وش التعديل المطلوب' });
    const done: Row[] = [], skipped: number[] = [];
    for (const id of ids) {
      const before = await sb(cfg, `/rest/v1/suggestions?id=eq.${id}&select=*`, { admin: true });
      const b = before.ok ? rows(before.data)[0] : undefined;
      if (!b || b.status !== 'open') { skipped.push(id); continue; }
      // A new campaign: only Leen approves it, even in Auto
      if (b.kind === 'new_campaign' && status !== 'rejected' && !isOwner(user, cfg)) { skipped.push(id); continue; }
      // Approve only what passed the critic (Leen reviews new campaigns herself)
      const c = b.critic as { ok?: boolean } | null;
      if (status !== 'rejected' && b.kind !== 'new_campaign' && !(c && c.ok)) { skipped.push(id); continue; }
      const r = await sb(cfg, `/rest/v1/suggestions?id=eq.${id}&status=eq.open`, {
        method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' },
        body: { status, note: note || null, decided_by: user.email, decided_at: now() },
      });
      const a = r.ok ? rows(r.data)[0] : undefined;
      if (!a) { skipped.push(id); continue; }
      await audit(cfg, user, `suggestion_${status}`, {
        target: { id, platform: a.platform, kind: a.kind, target_id: a.target_id, target_name: a.target_name },
        before: b, after: a, note: note || null,
      });
      done.push(a);
    }
    if (!done.length) return json(409, { error: 'ما انحفظ: إما انحسمت من قبل، أو المراجع ما قبلها' });
    return json(200, { ok: true, done, skipped, suggestion: done[0] });
  }),
};

// ---- settings: manual / auto per platform. Only Leen changes the mode.
export const settings = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control');
    const r = await sb(cfg, '/rest/v1/control_settings?select=*', { admin: true });
    const by = Object.fromEntries((r.ok ? rows(r.data) : []).map(x => [String(x.platform), x]));
    return json(200, { owner: isOwner(user, cfg), settings: PLATFORMS.map(p => by[p] || { platform: p, mode: 'manual', guardrails: {} }) });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const body = await readJson(request);
    const platform = String(body.platform || ''), mode = String(body.mode || '');
    if (!PLATFORMS.includes(platform) || !['manual', 'auto'].includes(mode)) return json(400, { error: 'قيمة غير صحيحة' });
    const before = await sb(cfg, `/rest/v1/control_settings?platform=eq.${platform}&select=*`, { admin: true });
    const r = await sb(cfg, '/rest/v1/control_settings', {
      method: 'POST', admin: true, headers: MERGE, body: { platform, mode, updated_by: user.email, updated_at: now() },
    });
    if (!r.ok) return json(500, { error: 'ما انحفظ الوضع' });
    const setting = rows(r.data)[0];
    await audit(cfg, user, 'mode_changed', { target: { platform }, before: before.ok ? rows(before.data)[0] || null : null, after: setting });
    return json(200, { ok: true, setting });
  }),
};

// ---- history: actions on one ad (details panel). No login emails or user details beyond the decider.
export const history = {
  GET: handle(async (request, e) => {
    const { cfg } = await requireUser(request, e, 'control');
    const t = new URL(request.url).searchParams.get('target') || '';
    if (!/^[\w.:|-]{1,120}$/.test(t)) return json(400, { error: 'هدف غير معروف' });
    const r = await sb(cfg, `/rest/v1/audit_log?select=at,email,action,note&action=like.suggestion_*&target->>target_id=eq.${encodeURIComponent(t)}&order=at.desc&limit=30`, { admin: true });
    return json(r.ok ? 200 : 500, r.ok ? { log: r.data } : { error: 'ما قدرت أقرأ السجل' });
  }),
};

// ---- kill: emergency stop for any execution. Anyone with the board can turn it on; only Leen turns it off.
// Canary campaigns: the only campaigns execution may touch. Only Leen sets them; an empty list executes nothing.
async function current(cfg: Cfg) {
  const r = await sb(cfg, '/rest/v1/control_settings?platform=eq.global&select=*', { admin: true });
  const row = (r.ok ? rows(r.data)[0] : undefined) || { guardrails: {} };
  const g = (row.guardrails || {}) as Row;
  return {
    kill: !!g.kill, canary: Array.isArray(g.canary) ? (g.canary as unknown[]) : [],
    by: (row.updated_by as string | undefined) || null, at: (row.updated_at as string | undefined) || null, guardrails: g,
  };
}

async function setCanary(cfg: Cfg, user: Session, list: unknown[]): Promise<Response> {
  if (!isOwner(user, cfg)) return json(403, { error: 'لين بس تحدد حملات التجربة' });
  const canary = [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 20);
  const before = await current(cfg);
  const r = await sb(cfg, '/rest/v1/control_settings', {
    method: 'POST', admin: true, headers: MERGE,
    body: { platform: 'global', mode: 'manual', guardrails: { ...before.guardrails, canary }, updated_by: user.email, updated_at: now() },
  });
  if (!r.ok) return json(500, { error: 'ما انحفظ' });
  await audit(cfg, user, 'canary_changed', { target: { platform: 'global' }, before: { canary: before.canary }, after: { canary } });
  return json(200, { kill: before.kill, canary, by: before.by, at: before.at });
}

export const kill = {
  GET: handle(async (request, e) => {
    const { cfg } = await requireUser(request, e, 'control');
    const c = await current(cfg);
    return json(200, { kill: c.kill, canary: c.canary, by: c.by, at: c.at });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control', { write: true });
    const body = await readJson(request);
    if (Array.isArray(body.canary)) return setCanary(cfg, user, body.canary);
    const on = !!body.on;
    if (!on && !isOwner(user, cfg)) return json(403, { error: 'لين بس تقدر توقف الطوارئ' });
    const before = await current(cfg);
    const r = await sb(cfg, '/rest/v1/control_settings', {
      method: 'POST', admin: true, headers: MERGE,
      body: { platform: 'global', mode: 'manual', guardrails: { ...before.guardrails, kill: on }, updated_by: user.email, updated_at: now() },
    });
    if (!r.ok) return json(500, { error: 'ما انحفظ' });
    await audit(cfg, user, on ? 'kill_on' : 'kill_off', { target: { platform: 'global' }, before: { kill: before.kill }, after: { kill: on } });
    return json(200, { kill: on, canary: before.canary, by: user.email, at: rows(r.data)[0]?.updated_at });
  }),
};

// ---- learning tab: active lessons, media buyer moves inside the platforms (7 days), decision outcomes
export const learning = {
  GET: handle(async (request, e) => {
    const { cfg } = await requireUser(request, e, 'control');
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const [l, a, o] = await Promise.all([
      sb(cfg, '/rest/v1/lessons?select=platform,kind,lesson,evidence,confidence,block,created_at&active=eq.true&order=block.desc,confidence.desc&limit=100', { admin: true }),
      sb(cfg, `/rest/v1/platform_activity?select=platform,at,actor,event,object_type,object_name,detail&at=gte.${since}&order=at.desc&limit=200`, { admin: true }),
      sb(cfg, '/rest/v1/outcomes?select=suggestion_id,day,metrics,vs_expect,at&order=at.desc&limit=100', { admin: true }),
    ]);
    return json(200, { lessons: l.ok ? l.data : [], activity: a.ok ? a.data : [], outcomes: o.ok ? o.data : [], ready: l.ok && a.ok && o.ok });
  }),
};

// ---- campaigns: a new-campaign request from the form. Checks Leen's rules and files it on the board
// (kind = new_campaign). Launches nothing on a platform; a new campaign always needs Leen's approval.
const MOH = ['الأفضل', 'الوحيد', 'الأكثر', 'الخبير', 'مضمون', 'مضمونة', 'علاج فوري', 'نتائج مثبتة', 'تجارب المرضى', 'تجربة مريض', 'شفاء تام', '100%'];
const AI_FIELDS = ['budget', 'end', 'wa_message', 'primary', 'headline', 'cta', 'qualify', 'keywords', 'negatives', 'headlines', 'descriptions'];

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function digest(o: unknown): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(o)))).slice(0, 32);
}
const clean = (v: unknown): unknown =>
  typeof v === 'string' ? v.slice(0, 4000)
    : Array.isArray(v) ? v.slice(0, 20).map(x => String(x).slice(0, 60))
      : typeof v === 'boolean' || typeof v === 'number' ? v : null;

export const campaigns = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control', { write: true });
    const body = await readJson(request, 40000);
    const platform = String(body.platform || '');
    if (!PLATFORMS.includes(platform)) return json(400, { error: 'منصة غير معروفة' });
    const raw = body.fields && typeof body.fields === 'object' ? (body.fields as Row) : {};
    const f: Row = Object.fromEntries(Object.entries(raw).filter(([k]) => /^[a-z_]{1,30}$/.test(k)).map(([k, v]) => [k, clean(v)]));
    const dept = String(f.dept);
    if (!Object.hasOwn(DEPTS, dept)) return json(400, { error: 'اختر القسم' });
    const start = typeof f.start === 'string' ? f.start : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return json(400, { error: 'تاريخ البداية ناقص' });
    if (!/^https?:\/\//i.test(typeof f.creative === 'string' ? f.creative : '')) return json(400, { error: 'رابط الكرييتف لازم يبدأ بـ http' });
    const issues = check(f);
    const text = [f.primary, f.headline, f.wa_message, f.headlines, f.descriptions].join(' ');
    const moh = MOH.filter(w => text.includes(w));
    if (moh.length) issues.push(`كلمات تخالف تعليمات وزارة الصحة: ${moh.join('، ')}`);
    const aiPending = AI_FIELDS.filter(k => k in f && (f[k] === '' || f[k] == null));
    const name = (typeof f.name === 'string' && f.name) || `${platform}_${dept}_${start.slice(8, 10)}${start.slice(5, 7)}`;
    const after = { status: 'PAUSED', note: 'تنطلق موقوفة، وتتشغّل بعد موافقة لين' };
    const s: Row = {
      platform, level: 'campaign', target_id: 'draft-' + Date.now().toString(36), target_name: name, campaign: name, kind: 'new_campaign',
      params: { ...f, objective: f.objective, platform }, reason: `طلب حملة جديدة لقسم ${DEPTS[dept as keyof typeof DEPTS]} من ${user.email}`,
      evidence: { moh, ai_pending: aiPending, dept }, priority: 70, source: 'manual', status: 'open',
      before: null, after, risk: [...(moh.length ? ['وزارة الصحة'] : []), ...(aiPending.length ? ['يحتاج تعبئة كلود'] : [])],
      expect: {}, measure_plan: 'أول 3 أيام: الصرف وتكلفة الليد مقابل هدف المنصة، وبعد 7 أيام القرار: تكمل أو تتوقف.',
      reversal_plan: 'إيقاف الحملة (pause_campaign).', revision: 1, requested_by: user.email,
    };
    s.digest = await digest({ platform, level: s.level, target_id: s.target_id, kind: s.kind, params: s.params, after });
    s.critic = { ok: !issues.length, issues: [...issues, 'حملة جديدة: تحتاج موافقة لين'], at: now() };
    const r = await sb(cfg, '/rest/v1/suggestions', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: s });
    const saved = r.ok ? rows(r.data)[0] : undefined;
    if (!saved) return json(500, { error: 'ما انحفظ الطلب' });
    await audit(cfg, user, 'campaign_requested', { target: { id: saved.id, platform, target_name: name, dept }, after: s.params });
    return json(200, { ok: true, id: saved.id });
  }),
};
