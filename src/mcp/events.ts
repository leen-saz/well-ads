// Outbound events and webhooks (docs/PRD.md §3.0, M11; tables in 043_events.sql). emit() records a fact Well already knows; the
// database queues one delivery per webhook of that company that asked for the type. deliverDue() (the 5-minute cron) sends them, signed per
// Standard Webhooks (webhook-id, webhook-timestamp, webhook-signature: v1,<base64 HMAC-SHA256 of "id.timestamp.body">), and retries
// with backoff. Payloads hold ids, platforms and codes only: never post text, a token, a person's details or a platform message.
import { sb, type Cfg } from '../lib/auth';
import { tokensOf, putToken, dropTokens } from './vault';

export const EVENT_TYPES = ['post.published', 'post.failed', 'ad_action.applied', 'ad_action.failed', 'account.disconnected', 'account.expiring', 'account.recovered'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const BACKOFF_MIN = [1, 5, 30, 120, 360, 720];   // minutes after attempt 1..6; then the delivery is 'failed'
export const BATCH = 3;                                  // deliveries per cron run: at most 1 + 1 per company + 2 each (the 5-minute run shares 50 subrequests)
export const TIMEOUT_MS = 10_000;
export const secretName = (id: number) => `WEBHOOK_SECRET_${id}`;

type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);

/** Records the event and queues its deliveries. Never throws: an event that cannot be stored must not undo what happened. */
export async function emit(cfg: Cfg, company: string, type: EventType, data: Record<string, unknown>): Promise<void> {
  try {
    // One request: the database queues the deliveries itself (trigger mcp_events_queue, 043_events.sql)
    await sb(cfg, '/rest/v1/mcp_events', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' }, body: { company_id: company, type, data } });
  } catch (e) { console.warn('event_emit_failed', type, e instanceof Error ? e.name : 'unknown'); }
}

// ---- where a webhook may point: a public https address by name, on the default port
const PRIVATE_HOST = /^(localhost|.*\.(local|localhost|internal|lan|home|corp|intranet|arpa))$/i;
export function cleanUrl(v: unknown): string | null {
  let u: URL;
  try { u = new URL(String(v || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.href.length > 500) return null;
  const h = u.hostname;
  if (!h.includes('.') || PRIVATE_HOST.test(h) || /^\[|^[\d.]+$/.test(h)) return null;   // no bare names, no IP literals
  return u.href;
}
export const cleanTypes = (v: unknown): EventType[] => [...new Set((Array.isArray(v) ? v : []).filter((t): t is EventType => (EVENT_TYPES as readonly string[]).includes(String(t))))];

function b64(bytes: Uint8Array): string { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
export const newSecret = () => 'whsec_' + b64(crypto.getRandomValues(new Uint8Array(24)));
export async function sign(secret: string, id: string, ts: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'v1,' + b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`))));
}

/** A new webhook for the company. The secret is returned once, here, and kept only in the company's Token Vault. */
export async function createWebhook(cfg: Cfg, company: string, by: string, url: string, types: EventType[]): Promise<{ id: number; secret: string } | null> {
  const r = await sb<Row[]>(cfg, '/rest/v1/webhooks', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: { company_id: company, url, types, created_by: by } });
  const id = r.ok ? Number(rows(r.data)[0]?.id) : NaN;
  if (!Number.isFinite(id)) return null;
  const secret = newSecret();
  try { await putToken(cfg, company, secretName(id), secret); }
  catch { await sb(cfg, `/rest/v1/webhooks?id=eq.${id}&company_id=eq.${company}`, { method: 'DELETE', admin: true }); return null; }
  return { id, secret };
}
export async function deleteWebhook(cfg: Cfg, company: string, id: number): Promise<boolean> {
  const r = await sb<Row[]>(cfg, `/rest/v1/webhooks?id=eq.${id}&company_id=eq.${company}`, { method: 'DELETE', admin: true, headers: { Prefer: 'return=representation' } });
  if (!r.ok || !rows(r.data).length) return false;
  await dropTokens(cfg, company, [secretName(id)]);
  return true;
}

/** Sends the deliveries that are due. Returns how many were tried. */
export async function deliverDue(cfg: Cfg, f: typeof fetch = fetch, now = Date.now()): Promise<number> {
  const iso = new Date(now).toISOString();
  const due = await sb<Row[]>(cfg, `/rest/v1/webhook_deliveries?status=eq.pending&next_at=lte.${iso}&order=next_at.asc&limit=${BATCH}&select=id,company_id,attempts,webhook:webhooks(id,url,active),event:mcp_events(id,type,data,created_at)`, { admin: true });
  if (!due.ok) return 0;
  const secrets = new Map<string, Record<string, string>>();
  let tried = 0;
  for (const d of rows(due.data)) {
    const hook = d.webhook as Row | null, ev = d.event as Row | null, co = String(d.company_id);
    const patch = (body: Row) => sb(cfg, `/rest/v1/webhook_deliveries?id=eq.${d.id}`, { method: 'PATCH', admin: true, body });
    if (!hook || !ev || hook.active === false || !cleanUrl(hook.url)) { await patch({ status: 'failed', last_code: 0 }); continue; }
    if (!secrets.has(co)) secrets.set(co, await tokensOf(cfg, co));
    const secret = secrets.get(co)![secretName(Number(hook.id))];
    if (!secret) { await patch({ status: 'failed', last_code: 0 }); continue; }
    const msgId = `evt_${ev.id}`, ts = Math.floor(now / 1000);
    const body = JSON.stringify({ id: msgId, type: ev.type, created_at: ev.created_at, data: ev.data });
    let code = 0;
    try {
      const r = await f(String(hook.url), { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'content-type': 'application/json', 'user-agent': 'Well-Webhooks/1', 'webhook-id': msgId, 'webhook-timestamp': String(ts), 'webhook-signature': await sign(secret, msgId, ts, body) }, body });
      code = r.status;
    } catch { code = 0; }
    tried++;
    const attempts = Number(d.attempts || 0) + 1;
    if (code >= 200 && code < 300) await patch({ status: 'delivered', attempts, last_code: code, delivered_at: iso });
    else if (attempts >= BACKOFF_MIN.length) await patch({ status: 'failed', attempts, last_code: code });
    else await patch({ attempts, last_code: code, next_at: new Date(now + BACKOFF_MIN[attempts - 1]! * 60_000).toISOString() });
  }
  return tried;
}
