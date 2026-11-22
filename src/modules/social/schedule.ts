// Scheduling a post, outside the route table so the Well MCP (src/mcp/tools/social.ts) can call it too.
// Every post waits for its approver whoever writes it (person, agent or outside client): nothing here publishes.
import { sb, audit, missingSchema, notApplied, type Cfg } from '../../lib/auth';
import { nextSlot, HORIZON_DAYS, type Slot } from './slots';
import { scoped, WELL_COMPANY } from '../../lib/tenant';
import { SOCIAL, readiness, validate, type SocialPlatform } from './social';
import { rulesFor } from '../knowledge/knowledge';
import { tokensOf } from '../../mcp/vault';
import { cachedStatus, withEngineSecrets, type EngineStatus } from '../../mcp/adapters/postiz';

type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);

// The connected accounts, as the publisher sees them (src/modules/social/cron.ts): Well's vault today
export async function tokensFor(cfg: Cfg, co: string, e?: unknown): Promise<Record<string, string>> {
  // The Postiz engine set in the Worker's own variables is Well's: another company never gets it
  const t = await tokensOf(cfg, co);
  return co === WELL_COMPANY ? withEngineSecrets(t, e) : t;
}
// What the extra publishing engine reports (asked at most once a minute per Worker). A platform it carries is "ready" only when
// the engine is set up AND that account is connected there. Not asked at all when no Postiz platform is involved or none is set up.
export const engineState = (t: Record<string, string>): Promise<EngineStatus> => cachedStatus(t);
// Per platform: '' when it can go out, else why not (no token values leave the server)
export const readyOf = (t: Record<string, string>, s: EngineStatus | null) => Object.fromEntries((Object.keys(SOCIAL) as SocialPlatform[]).map(p => [p, readiness(p, t, s)]));
// The first free queue slot (docs/PRD.md §3.2, M6)
async function queueTime(cfg: Cfg, co: string): Promise<{ ok: true; iso: string } | { ok: false; status: number; error: string }> {
  const sl = await sb<Slot[]>(cfg, scoped('/rest/v1/social_slots?select=weekday,at_local', co), { admin: true });
  if (!sl.ok) return { ok: false, status: missingSchema(sl) ? 503 : 500, error: missingSchema(sl) ? 'مواعيد الطابور تحتاج تجهيز القاعدة. بلّغ الإدارة.' : 'ما قدرت أقرأ مواعيد الطابور' };
  const slots = rows(sl.data) as unknown as Slot[];
  if (!slots.length) return { ok: false, status: 400, error: 'ما فيه مواعيد طابور. أضفها من «مواعيد الطابور» أو حدّد وقت بنفسك' };
  const now = Date.now(), to = new Date(now + (HORIZON_DAYS + 1) * 864e5).toISOString();
  const tk = await sb<Row[]>(cfg, scoped(`/rest/v1/social_posts?select=publish_at&status=in.(scheduled,publishing,published,partial)&publish_at=gte.${new Date(now).toISOString()}&publish_at=lte.${to}&limit=1000`, co), { admin: true });
  const iso = nextSlot(slots, rows(tk.data).map(x => String(x.publish_at)), now);
  return iso ? { ok: true, iso } : { ok: false, status: 409, error: `كل مواعيد الطابور في الـ ${HORIZON_DAYS} يوم الجاية محجوزة. أضف مواعيد أو حدّد وقت بنفسك` };
}

// The Social tab's «جدول» and the MCP tool social.post.create
export async function schedulePost(cfg: Cfg, user: { co: string; email: string; role?: string }, e: unknown, input: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const tk = await tokensFor(cfg, user.co, e), ready = readyOf(tk, await engineState(tk));
  // «أضف للطابور»: the server picks the first free slot (the browser sends no time)
  if (input.queue === true) {
    const at = await queueTime(cfg, user.co);
    if (!at.ok) return { status: at.status, body: { error: at.error, notices: [] } };
    input.publish_at = at.iso;
  }
  const v = validate(input, Date.now(), await rulesFor(cfg, user.co), p => SOCIAL[p].live && !ready[p]!.startsWith('غير متاح'));
  if (!v.draft) return { status: 400, body: { error: v.error, notices: v.notices } };
  // A platform whose account is not connected would fail at its time: said now, while it can still be fixed
  for (const pl of v.draft.platforms) if (ready[pl] && SOCIAL[pl].live && !ready[pl].startsWith('غير متاح')) v.notices.push(`${SOCIAL[pl].name}: ${ready[pl]}`);
  const r = await sb<Row[]>(cfg, '/rest/v1/social_posts', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { ...v.draft, company_id: user.co, status: 'scheduled', created_by: user.email } });
  if (!r.ok) return missingSchema(r) && v.draft.overrides ? { status: 503, body: { error: notApplied(user as never, '040_social_v2.sql') } } : { status: 500, body: { error: 'ما انحفظ المنشور' } };
  const post = rows(r.data)[0];
  await audit(cfg, user, 'social_scheduled', { target: { id: post?.id, platforms: v.draft.platforms, mode: v.draft.mode, publish_at: v.draft.publish_at } });
  return { status: 200, body: { ok: true, post, notices: v.notices } };
}
