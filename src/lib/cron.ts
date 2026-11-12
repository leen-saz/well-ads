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

// The cron runs inside ctx.waitUntil, which Cloudflare cuts after 30 seconds. A GitHub call that hangs must give up well before
// that, so the failure is still saved to R2 and shown in the health page instead of vanishing with the killed invocation.
export const DISPATCH_TIMEOUT_MS = 10_000;

async function post(file: string, token: string, f: typeof fetch): Promise<number> {
  try {
    return (await f(dispatchUrl(file), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28', 'user-agent': 'well-ads-cron', 'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    })).status;
  } catch (err) {
    console.error('cron:', file, (err as Error)?.name === 'TimeoutError' ? 'dispatch timed out' : 'dispatch request failed');
    return 0;
  }
}

export async function dispatchRefresh(e: CronEnv, f: typeof fetch = fetch): Promise<number> {
  const token = (e.GH_DISPATCH_TOKEN || '').trim();
  if (!token) { console.error('cron: GH_DISPATCH_TOKEN missing, refresh not started'); await note(e, false, 0); return 0; }
  const status = await post('refresh.yml', token, f);
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
  const status = await post(file, token, f);
  if (status !== 204) console.error('cron:', file, 'dispatch failed', status);
  else console.log('cron:', file, 'started');
  return status;
}
