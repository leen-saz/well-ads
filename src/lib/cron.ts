// Hourly trigger for the data refresh. GitHub never fired the `schedule` of this repo, so a Cloudflare Cron
// Trigger (production only, minute 7) starts .github/workflows/refresh.yml through the GitHub API instead.
// Needs the Worker secret GH_DISPATCH_TOKEN: a fine-grained token on leen-saz/well-ads with Actions: Read and write.
import { REFRESH_STATUS_KEY, type StatusBucket } from './datastatus';
export interface CronEnv { GH_DISPATCH_TOKEN?: string; FILES?: StatusBucket }

export const dispatchUrl = (workflow: string) => `https://api.github.com/repos/leen-saz/well-ads/actions/workflows/${workflow}/dispatches`;
export const DISPATCH_URL = dispatchUrl('refresh.yml');

// The result is also written to R2 (a few bytes) so «صحة الداتا» and /api/data-status can show a failed dispatch:
// a console line alone is seen by nobody.
async function note(e: CronEnv, ok: boolean, status: number): Promise<void> {
  try { await e.FILES?.put?.(REFRESH_STATUS_KEY, JSON.stringify({ at: new Date().toISOString(), ok, status }), { httpMetadata: { contentType: 'application/json' } }); }
  catch { console.error('cron: could not save the dispatch status'); }
}

export async function dispatchRefresh(e: CronEnv, f: typeof fetch = fetch): Promise<number> {
  const token = (e.GH_DISPATCH_TOKEN || '').trim();
  if (!token) { console.error('cron: GH_DISPATCH_TOKEN missing, refresh not started'); await note(e, false, 0); return 0; }
  let status = 0;
  try {
    const res = await f(DISPATCH_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28', 'user-agent': 'well-ads-cron', 'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    status = res.status;
  } catch { console.error('cron: dispatch request failed'); }
  if (status !== 204) console.error('cron: dispatch failed', status);
  else console.log('cron: refresh started');
  await note(e, status === 204, status);
  return status;
}

// The weekly backup and the monthly restore test (db-backup.yml, db-restore-test.yml) are started the same way. Their result is
// only logged: refresh-status.json belongs to the hourly refresh and must not be overwritten by them.
export async function dispatchWorkflow(e: CronEnv, file: string, f: typeof fetch = fetch): Promise<number> {
  const token = (e.GH_DISPATCH_TOKEN || '').trim();
  if (!token) { console.error('cron: GH_DISPATCH_TOKEN missing,', file, 'not started'); return 0; }
  let status = 0;
  try {
    status = (await f(dispatchUrl(file), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'well-ads-cron', 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    })).status;
  } catch { console.error('cron:', file, 'dispatch request failed'); }
  if (status !== 204) console.error('cron:', file, 'dispatch failed', status);
  else console.log('cron:', file, 'started');
  return status;
}
