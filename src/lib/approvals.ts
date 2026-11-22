// The approvals center (docs/PRD.md §3.1, milestone M3): everything waiting for THIS user's approval, in one list, and
// its counts for the sidebar. It only reads. Approving or rejecting stays on each item's own route, with its own checks
// (social: the named approvers; ads: approve on the decisions board, Well only, the second confirmation; lessons: the
// tab's approve level), so nothing here can approve anything the original page would refuse.
// Items the user cannot approve are not listed or counted. No post text, campaign name or reason goes into a count.
import { sb, isOwner, atLeast, can, missingSchema, type Cfg, type Session } from './auth';
import { scoped, WELL_COMPANY } from './tenant';
import { canApprove } from '../modules/social/social';
import { needOf } from './lessons';
import { isModule } from '../modules/registry';

export type Kind = 'social' | 'ads' | 'lessons';
export const KINDS: readonly Kind[] = ['social', 'ads', 'lessons'];

export interface Item {
  kind: Kind;
  id: string;
  title: string;          // one short line: the post's first words, the action, the lesson
  detail: string;         // the second line: platforms and time, the reason, the tab
  at: string;             // when it was created (or is due, for a post)
  by: string | null;      // who proposed it (an email, shown to approvers only)
  href: string;           // where it is decided in full
  money: boolean;         // changes spend: the page asks for the second confirmation there
  meta: Record<string, unknown>;
}
export type Counts = Record<Kind, number> & { total: number };

type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
const s = (v: unknown) => (v == null ? '' : String(v));
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

/** What this user may approve, by kind. Pure: decided from the session alone (plus the company's social approvers). */
export function rights(user: Session, cfg: Cfg, socialApprovers: string[]): { social: boolean; ads: boolean; lessonModules: string[] } {
  const owner = isOwner(user, cfg);
  const social = can(user, 'social', cfg) && atLeast(user, 'social', 'approve', cfg) && canApprove(user.email, socialApprovers, owner);
  // Ad actions are Well's decision board only (the execution layer refuses other companies)
  const ads = user.co === WELL_COMPANY && can(user, 'control', cfg) && atLeast(user, 'control', 'approve', cfg);
  const keys = ['ads', ...Object.keys(user.lvl ?? {}).filter(isModule)];
  if (owner) keys.push(...(user.dash ?? []).filter(k => isModule(k as string)) as string[]);
  const lessonModules = [...new Set(keys)].filter(m => { const need = needOf(m); return !!need && can(user, need, cfg) && atLeast(user, need, 'approve', cfg); });
  return { social, ads, lessonModules };
}

async function approversOf(cfg: Cfg, company: string): Promise<string[]> {
  const r = await sb<{ social_approvers?: string[] | null }[]>(cfg, `/rest/v1/companies?id=eq.${company}&select=social_approvers`, { admin: true });
  return r.ok && Array.isArray(r.data) ? (r.data[0]?.social_approvers || []).map(x => String(x).toLowerCase()) : [];
}

/** A table that is not created yet (its migration not run) counts as nothing waiting, never as an error. */
async function read(cfg: Cfg, path: string): Promise<Row[]> {
  const r = await sb<Row[]>(cfg, path, { admin: true });
  if (!r.ok) { if (missingSchema(r)) return []; throw new Error('approvals_read_failed'); }
  return rows(r.data);
}

const PLATFORM: Record<string, string> = { facebook: 'فيسبوك', instagram: 'انستقرام', tiktok: 'تيك توك', x: 'X', linkedin: 'لينكدإن', snapchat: 'سناب', meta: 'ميتا', google: 'قوقل' };
const plat = (p: unknown) => PLATFORM[s(p)] ?? s(p);
const KIND_AR: Record<string, string> = { budget: 'تعديل ميزانية', pause: 'إيقاف', resume: 'تشغيل', scale_up: 'رفع ميزانية', reduce: 'تخفيض ميزانية' };

export function socialItem(r: Row): Item {
  const platforms = Array.isArray(r.platforms) ? (r.platforms as unknown[]).map(plat) : [];
  return { kind: 'social', id: s(r.id), title: cut(s(r.body).replace(/\s+/g, ' ').trim() || 'منشور بدون نص', 90), detail: platforms.join('، '),
    at: s(r.publish_at), by: (r.created_by as string) ?? null, href: `/social/?post=${s(r.id)}`, money: false, meta: { publish_at: r.publish_at, platforms: r.platforms } };
}
export function adsItem(r: Row): Item {
  const what = KIND_AR[s(r.kind)] ?? s(r.kind);
  const name = s(r.entity_name);
  return { kind: 'ads', id: s(r.id), title: cut(`${what}${name ? ': ' + name : ''}`, 90), detail: `${plat(r.platform)} · ${cut(s(r.reason), 120)}`,
    at: s(r.created_at), by: (r.created_by as string) ?? null, href: `/control/?tab=buyer&action=${s(r.id)}`, money: r.mode !== 'manual',
    meta: { platform: r.platform, level: r.level, mode: r.mode, change: r.change } };
}
export function lessonItem(r: Row, tabName: (k: string) => string): Item {
  const m = s(r.module);
  return { kind: 'lessons', id: s(r.id), title: cut(s(r.lesson), 120), detail: tabName(m), at: s(r.created_at), by: null,
    href: m === 'ads' ? '/control/?tab=learn' : `/${m}/`, money: false, meta: { module: m, confidence: r.confidence } };
}

export async function collect(cfg: Cfg, user: Session, tabName: (k: string) => string = k => k): Promise<{ items: Item[]; counts: Counts; rights: ReturnType<typeof rights> }> {
  const r = rights(user, cfg, await approversOf(cfg, user.co));
  const [social, ads, lessons] = await Promise.all([
    r.social ? read(cfg, scoped('/rest/v1/social_posts?select=id,body,platforms,publish_at,created_by,created_at&status=eq.scheduled&approved_at=is.null&order=publish_at.asc&limit=100', user.co)) : Promise.resolve([]),
    r.ads ? read(cfg, scoped('/rest/v1/buyer_actions?select=id,platform,level,entity_name,kind,reason,mode,change,created_by,created_at&status=eq.proposed&order=created_at.asc&limit=100', user.co)) : Promise.resolve([]),
    r.lessonModules.length ? read(cfg, scoped(`/rest/v1/lessons?select=id,module,lesson,confidence,created_at&active=eq.true&status=in.(new,reviewed)&module=in.(${r.lessonModules.join(',')})&order=created_at.asc&limit=100`, user.co)) : Promise.resolve([]),
  ]);
  const items = [...social.map(socialItem), ...ads.map(adsItem), ...lessons.map(x => lessonItem(x, tabName))];
  const counts: Counts = { social: social.length, ads: ads.length, lessons: lessons.length, total: items.length };
  return { items, counts, rights: r };
}
