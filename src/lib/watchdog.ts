// Outside watcher for the hourly refresh (docs/system-workflow-review.md, gap 1.1 and 1.3). The health step inside refresh.yml
// cannot warn when the workflow never starts, hangs or fails before it. This runs from the hourly Cron Trigger (minute 7, with
// the refresh dispatch), reads how old site/dash.json is, and sends ONE alert when it is older than 3 hours.
// Channels, all optional Worker secrets (nothing is stored in the repo): ALERT_WEBHOOK_URL (any endpoint taking a JSON POST: Slack,
// Discord, ntfy, Zapier) and/or RESEND_API_KEY + ALERT_EMAIL_FROM + ALERT_EMAIL_TO (email through Resend). With none set the problem
// is still saved for the health page and logged. The message holds hours only: no business figures, no keys.
import { WARN_HOURS, dataStatus, type DataStatus, type StatusBucket } from './datastatus';

export const WATCHDOG_STATE_KEY = 'site/watchdog-state.json';
// While the data stays stale the alert repeats at most this often (hours), so a long outage is not a flood
export const REPEAT_HOURS = 6;

export interface WatchdogEnv {
  FILES?: StatusBucket;
  ALERT_WEBHOOK_URL?: string;
  RESEND_API_KEY?: string; ALERT_EMAIL_FROM?: string; ALERT_EMAIL_TO?: string;
}
interface State { stale: boolean; alerted_at: string | null }

async function readState(b: StatusBucket | undefined): Promise<State> {
  try { const o = await b?.get?.(WATCHDOG_STATE_KEY); const s = o ? JSON.parse(await o.text()) : null; if (s && typeof s.stale === 'boolean') return { stale: s.stale, alerted_at: typeof s.alerted_at === 'string' ? s.alerted_at : null }; } catch { /* first run or unreadable */ }
  return { stale: false, alerted_at: null };
}
async function writeState(b: StatusBucket | undefined, s: State): Promise<void> {
  try { await b?.put?.(WATCHDOG_STATE_KEY, JSON.stringify(s), { httpMetadata: { contentType: 'application/json' } }); } catch { console.error('watchdog: could not save its state'); }
}

// Plain text, Arabic like the rest of the product, hours only
export function message(st: DataStatus, recovered: boolean): { subject: string; text: string } {
  if (recovered) return { subject: 'Well ads: البيانات رجعت تتحدّث', text: 'البيانات رجعت محدّثة. ما يلزم أي إجراء.' };
  const age = st.dash_age_hours == null ? 'غير معروف' : `${st.dash_age_hours} ساعة`;
  const why = st.dispatch === 'failed' ? 'آخر تشغيل تلقائي ما انطلق (تحقق من GH_DISPATCH_TOKEN).' : 'التحديث الساعي ما اكتمل أو ما بدأ (تحقق من تشغيلات refresh في GitHub Actions).';
  return { subject: 'Well ads: البيانات قديمة', text: `عمر آخر تحديث للبيانات: ${age} (الحد ${WARN_HOURS} ساعات). ${why}` };
}

async function send(e: WatchdogEnv, m: { subject: string; text: string }, f: typeof fetch): Promise<number> {
  let sent = 0;
  const hook = (e.ALERT_WEBHOOK_URL || '').trim();
  if (hook) {
    try {
      // `text` is Slack's field, `content` Discord's: one body fits both; ntfy and others read the raw JSON
      const r = await f(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `${m.subject}\n${m.text}`, content: `${m.subject}\n${m.text}`, title: m.subject, message: m.text }) });
      if (r.ok) sent++; else console.error('watchdog: webhook answered', r.status);
    } catch { console.error('watchdog: webhook request failed'); }
  }
  const key = (e.RESEND_API_KEY || '').trim(), from = (e.ALERT_EMAIL_FROM || '').trim(), to = (e.ALERT_EMAIL_TO || '').trim();
  if (key && from && to) {
    try {
      const r = await f('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: to.split(',').map(s => s.trim()).filter(Boolean), subject: m.subject, text: m.text }) });
      if (r.ok) sent++; else console.error('watchdog: email answered', r.status);
    } catch { console.error('watchdog: email request failed'); }
  }
  return sent;
}

export type WatchdogResult = 'ok' | 'recovered' | 'alerted' | 'quiet' | 'no_channel';

export async function runWatchdog(e: WatchdogEnv, f: typeof fetch = fetch, now = Date.now()): Promise<WatchdogResult> {
  const st = await dataStatus(e.FILES, now);
  // The bucket binding is missing (local dev): there is nothing to judge
  if (st.level === 'unknown') return 'ok';
  const stale = st.warnings.includes('no_data') || st.warnings.includes('data_old') || st.warnings.includes('data_very_old');
  const prev = await readState(e.FILES);
  if (!stale) {
    if (!prev.stale) return 'ok';
    await send(e, message(st, true), f);
    await writeState(e.FILES, { stale: false, alerted_at: null });
    return 'recovered';
  }
  const since = prev.alerted_at ? (now - Date.parse(prev.alerted_at)) / 36e5 : Infinity;
  if (prev.stale && since < REPEAT_HOURS) return 'quiet';
  console.error('watchdog: dash.json is stale', st.dash_age_hours);
  const sent = await send(e, message(st, false), f);
  // Without a working channel the alert is retried on the next run instead of being marked as done
  await writeState(e.FILES, { stale: true, alerted_at: sent ? new Date(now).toISOString() : prev.alerted_at });
  return sent ? 'alerted' : 'no_channel';
}
