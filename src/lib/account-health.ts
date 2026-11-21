// Health of the connected accounts (docs/PRD.md §3.4, milestone M5), separate from connecting them.
//   - every hour (the hourly Cron Trigger) each connected account is checked with ONE read-only request;
//   - the first failure makes it «degraded» and opens a one-hour grace (grace_until); the 5-minute trigger looks again once the
//     grace is over; still failing = «disconnected» and ONE alert. Back to working = one «recovered» alert;
//   - a token that expires within 7 days = «expiring» (one alert); an expired one = «disconnected» at once (no grace: it is certain);
//   - a platform's own outage (5xx, timeout) is not the account's fault: the state stays as it was.
// Stored: status, times, a short error code. Never a key, a token, an account name or the platform's message.
// Connections are Well's only today (connections has no company column: docs/migrations.md), so this runs for Well.
import { emit } from '../mcp/events';
import { tokensOf } from '../mcp/vault';
import { sb, type Cfg } from './auth';
import { WELL_COMPANY } from './tenant';
import { postizStatus } from '../mcp/adapters/postiz';
import { graphProbe } from '../mcp/adapters/meta-graph';
import { sendAlert, type WatchdogEnv } from './watchdog';

export type Status = 'ok' | 'degraded' | 'expiring' | 'disconnected';
export type Probe = 'ok' | 'fail' | 'error' | 'none';   // error = the platform itself failed (not the account); none = no read-only check exists
export interface Row {
  platform: string; account_ref: string; status: Status; probed: boolean; last_check_at: string | null; first_failed_at: string | null;
  grace_until: string | null; error_code: string | null; expires_at: string | null; alerted_status: string | null;
}
export const GRACE_MS = 60 * 60 * 1000;
export const EXPIRING_MS = 7 * 864e5;

/** The next state of one account. Pure. `alert` is set only on a change the owner must hear about. */
export function step(prev: Row | null, probe: Probe, code: string | null, expiresAt: string | null, now: number, platform: string): { row: Row; alert: 'disconnected' | 'expiring' | 'recovered' | null } {
  const iso = new Date(now).toISOString();
  const base: Row = { platform, account_ref: prev?.account_ref ?? '', status: prev?.status ?? 'ok', probed: probe !== 'none' ? true : prev?.probed ?? false,
    last_check_at: iso, first_failed_at: prev?.first_failed_at ?? null, grace_until: prev?.grace_until ?? null, error_code: prev?.error_code ?? null,
    expires_at: expiresAt, alerted_status: prev?.alerted_status ?? null };
  const exp = expiresAt ? Date.parse(expiresAt) : NaN;
  const was = prev?.status ?? 'ok';
  const done = (status: Status, extra: Partial<Row> = {}) => {
    const row = { ...base, ...extra, status };
    // one alert per change of the alerted state; recovering from an alerted problem says so once
    let alert: 'disconnected' | 'expiring' | 'recovered' | null = null;
    if ((status === 'disconnected' || status === 'expiring') && row.alerted_status !== status) { alert = status; row.alerted_status = status; }
    else if (status === 'ok' && (row.alerted_status === 'disconnected' || row.alerted_status === 'expiring')) { alert = row.alerted_status === 'disconnected' ? 'recovered' : null; row.alerted_status = null; }
    return { row, alert };
  };
  if (Number.isFinite(exp) && exp <= now) return done('disconnected', { error_code: 'expired', grace_until: null });
  if (probe === 'error') return { row: { ...base, status: was }, alert: null };   // the platform is down, not the account
  if (probe === 'fail') {
    if (was === 'disconnected') return done('disconnected', { error_code: code });
    if (was === 'degraded' && prev?.grace_until && now >= Date.parse(prev.grace_until)) return done('disconnected', { error_code: code, grace_until: null });
    if (was === 'degraded') return done('degraded', { error_code: code });
    return done('degraded', { error_code: code, first_failed_at: iso, grace_until: new Date(now + GRACE_MS).toISOString() });
  }
  // ok, or nothing to probe: the expiry decides
  const clear = { first_failed_at: null, grace_until: null, error_code: null };
  if (Number.isFinite(exp) && exp - now <= EXPIRING_MS) return done('expiring', clear);
  return done('ok', clear);
}

type Values = Record<string, string>;
// One read per platform, the token in the Authorization header (never in the address). Answers: ok / fail (the account) / error (the platform).
export async function probe(platform: string, v: Values, f: typeof fetch = fetch): Promise<[Probe, string | null]> {
  if (platform === 'meta') return graphProbe(v.META_ACCESS_TOKEN, f);
  if (platform === 'meta_pages') return graphProbe(v.META_PAGE_ACCESS_TOKEN, f);
  if (platform === 'meta_capi') return graphProbe(v.META_CAPI_TOKEN, f);
  if (platform === 'postiz') {
    const s = await postizStatus(v, f).catch(() => ({ code: 'down' as const, channels: [] }));
    if (s.code === 'off') return ['none', null];
    if (s.code === 'ok') return ['ok', null];
    return s.code === 'down' ? ['error', null] : ['fail', `postiz_${s.code}`];
  }
  return ['none', null];
}

const MSG: Record<'disconnected' | 'expiring' | 'recovered', (n: string) => { subject: string; text: string }> = {
  disconnected: n => ({ subject: `Well: ربط ${n} وقف`, text: `حساب ${n} ما يستجيب من أكثر من ساعة. افتح صفحة الربط واضغط «أعد الربط».` }),
  expiring: n => ({ subject: `Well: ربط ${n} ينتهي قريب`, text: `صلاحية ربط ${n} تنتهي خلال أقل من 7 أيام. أعد الربط من صفحة الربط قبل ما ينتهي.` }),
  recovered: n => ({ subject: `Well: ربط ${n} رجع يشتغل`, text: `حساب ${n} رجع يستجيب. ما يلزم أي إجراء.` }),
};

export type HealthEnv = WatchdogEnv;
type Conn = { platform: string; expires_at: string | null };

/** The hourly check of every connected account (all = true), or only the degraded ones whose grace is over (the 5-minute trigger). */
export async function runAccountHealth(cfg: Cfg, e: HealthEnv, { all, names }: { all: boolean; names: Record<string, string> }, f: typeof fetch = fetch, now = Date.now()): Promise<{ checked: number; alerts: number }> {
  const co = WELL_COMPANY;
  const prevR = await sb<Row[]>(cfg, `/rest/v1/account_health?company_id=eq.${co}&select=*`, { admin: true });
  if (!prevR.ok) return { checked: 0, alerts: 0 };   // 038 not applied yet: nothing to do
  const prev = new Map((Array.isArray(prevR.data) ? prevR.data : []).map(r => [`${r.platform}|${r.account_ref}`, r]));
  let targets: Conn[];
  if (all) {
    const c = await sb<Conn[]>(cfg, '/rest/v1/connections?select=platform,expires_at', { admin: true });
    targets = c.ok && Array.isArray(c.data) ? c.data : [];
  } else {
    targets = [...prev.values()].filter(r => r.status === 'degraded' && r.grace_until && Date.parse(r.grace_until) <= now).map(r => ({ platform: r.platform, expires_at: r.expires_at }));
  }
  if (!targets.length) return { checked: 0, alerts: 0 };
  const values: Values = await tokensOf(cfg, WELL_COMPANY);
  let alerts = 0;
  const out: (Row & { company_id: string; updated_at: string })[] = [];
  for (const t of targets) {
    const [p, code] = await probe(t.platform, values, f);
    const { row, alert } = step(prev.get(`${t.platform}|`) ?? null, p, code, t.expires_at, now, t.platform);
    out.push({ ...row, company_id: co, updated_at: new Date(now).toISOString() });
    if (alert) { alerts++; await sendAlert(e, MSG[alert](names[t.platform] || t.platform), f); await emit(cfg, co, `account.${alert}`, { platform: t.platform, status: row.status, code: row.error_code ?? null }); }
  }
  await sb(cfg, '/rest/v1/account_health?on_conflict=company_id,platform,account_ref', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates' }, body: out });
  return { checked: out.length, alerts };
}
