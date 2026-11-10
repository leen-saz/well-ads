// How fresh the numbers are, read only from R2 (two tiny objects and one HEAD): no Supabase round trip, so it is cheap
// enough for every page and for /api/health. Codes only, never words: the pages turn a code into plain text.
//   site/dash.json            uploaded time = when the last refresh finished
//   site/data-status.json     {built_at, crm_present, crm_synced}, written by refresh.yml next to dash.json
//   site/refresh-status.json  {at, ok, status}, written by the hourly dispatch (src/lib/cron.ts), also when it fails
export interface StatusBucket {
  head?(key: string): Promise<{ uploaded: Date } | null>;
  get?(key: string): Promise<{ text(): Promise<string> } | null>;
  put?(key: string, value: string, o?: { httpMetadata?: { contentType: string } }): Promise<unknown>;
}
export type DataWarning = 'no_data' | 'data_old' | 'data_very_old' | 'crm_missing' | 'crm_old' | 'dispatch_failed';
export interface DataStatus {
  level: 'ok' | 'warn' | 'stale' | 'unknown';
  warnings: DataWarning[];
  dash_age_hours: number | null;
  crm_age_hours: number | null;
  dispatch: 'ok' | 'failed' | 'unknown';
  dispatch_at: string | null;
}

export const REFRESH_STATUS_KEY = 'site/refresh-status.json';
// The refresh runs hourly: 3 h means at least two runs were missed (warning), 6 h is a banner for everyone
export const WARN_HOURS = 3;
export const STALE_HOURS = 6;
const CRM_WARN_HOURS = 6;

const hours = (iso: string | null | undefined, now: number): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round(((now - t) / 36e5) * 10) / 10) : null;
};
async function json<T>(b: StatusBucket, key: string): Promise<T | null> {
  try { const o = await b.get?.(key); return o ? (JSON.parse(await o.text()) as T) : null; } catch { return null; }
}

export async function dataStatus(files: StatusBucket | undefined, now = Date.now()): Promise<DataStatus> {
  if (!files?.head) return { level: 'unknown', warnings: [], dash_age_hours: null, crm_age_hours: null, dispatch: 'unknown', dispatch_at: null };
  let uploaded: string | null = null;
  try { uploaded = (await files.head('site/dash.json'))?.uploaded.toISOString() ?? null; } catch { /* unreadable: treated as no data */ }
  const [st, disp] = await Promise.all([
    json<{ crm_present?: boolean; crm_synced?: string | null }>(files, 'site/data-status.json'),
    json<{ at?: string; ok?: boolean }>(files, REFRESH_STATUS_KEY),
  ]);
  const warnings: DataWarning[] = [];
  const dash = hours(uploaded, now);
  if (dash == null) warnings.push('no_data');
  else if (dash >= STALE_HOURS) warnings.push('data_very_old');
  else if (dash >= WARN_HOURS) warnings.push('data_old');
  // The status file is newer than this feature on old builds: without it nothing is said about the CRM
  const crm = hours(st?.crm_synced, now);
  if (st) {
    if (st.crm_present === false) warnings.push('crm_missing');
    else if (crm != null && crm >= CRM_WARN_HOURS) warnings.push('crm_old');
  }
  const dispatch = disp ? (disp.ok === false ? 'failed' : 'ok') : 'unknown';
  if (dispatch === 'failed') warnings.push('dispatch_failed');
  const level = warnings.includes('no_data') || warnings.includes('data_very_old') ? 'stale' : warnings.length ? 'warn' : 'ok';
  return { level, warnings, dash_age_hours: dash, crm_age_hours: crm, dispatch, dispatch_at: disp?.at ?? null };
}
