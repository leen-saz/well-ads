// Every 5 minutes (Worker cron): publish the posts that are due. Each post is claimed first
// (scheduled -> publishing) so two runs never publish it twice. What each platform has done is written down as it
// happens (social_posts.results), which is what makes three things safe:
//  - a video that Instagram is still preparing comes back 'scheduled' and the next run continues it (bounded: social.ts VIDEO_WAIT_MS);
//  - a post stuck in 'publishing' (the Worker died mid-way) is re-claimed after STALE_MS and finished from its stored results:
//    what went out is never repeated, what never started starts, what may have gone out is marked 'unconfirmed' for a person to decide;
//  - a retry of the failed platforms (routes.ts) goes through the same path with the failed entries cleared.
import { env, sb, type AuthEnv, type Cfg } from '../../lib/auth';
import { WELL_COMPANY } from '../../lib/tenant';
import { due, pending, publishPost, stale, type Draft, type Results } from './social';
import { withEngineSecrets } from './postiz';

type Row = Draft & { id: number; company_id: string; status: string; claimed_at?: string | null; results?: Results | null; approved_at?: string | null; approved_by?: string | null; company?: { social_approvers?: string[] | null } | null };

async function work(cfg: Cfg, p: Row, tokens: Record<string, string>, f: typeof fetch, now: number): Promise<void> {
  const patch = (body: Record<string, unknown>) => sb(cfg, `/rest/v1/social_posts?id=eq.${p.id}`, { method: 'PATCH', admin: true, body });
  // A save that the database refused must throw: before a platform is called, progress that was not stored means the call
  // is not made (nothing goes out that recovery could not see); after it, the platform is marked 'unsaved' (social.ts)
  const out = await publishPost(p, p.company_id === WELL_COMPANY ? tokens : {}, f, p.results || {}, { now, save: async results => { if (!(await patch({ results })).ok) throw new Error('save'); } });
  // pending = Instagram is still preparing a video: back to 'scheduled' (still approved, still due) and the next run goes on
  const final = { status: out.status === 'pending' ? 'scheduled' : out.status, results: out.results, claimed_at: null };
  if (!(await patch(final)).ok && !(await patch(final)).ok) {
    // Still refused: the row stays 'publishing' and is recovered later from what was stored; the 'unsaved' mark keeps it from going out twice
    console.error('social: could not save the result of a post', p.id);
  }
}

// One run never takes more than this: a Worker invocation may make only 50 subrequests on the free plan (1000 on Paid), and
// one post costs about 10-15 of them (claim, a save per step, the platform calls, the final write). So a run starts at most
// FRESH_MAX new posts and PENDING_MAX posts that are only waiting for Instagram to finish a video (those cost ~4 each: claim,
// poll, write), and stops starting more once TICK_MS has passed. Whatever is left is simply due again five minutes later.
// Fresh and waiting posts have separate slots, so a few slow videos can never starve a post that is due, nor the reverse.
export const FRESH_MAX = 2;
export const PENDING_MAX = 3;
export const STUCK_MAX = 2;
export const TICK_MS = 3 * 60_000;
const waiting = (p: Row) => Object.values(p.results || {}).some(r => pending(r));

export async function runSocial(e: AuthEnv, now = Date.now(), f: typeof fetch = fetch, clock: () => number = Date.now): Promise<number> {
  let cfg;
  try { cfg = env(e); } catch { console.error('social: setup incomplete'); return 0; }
  const iso = new Date(now).toISOString();
  const sel = 'select=*,company:companies(social_approvers)';
  // Only APPROVED posts are fetched. An unapproved post that is overdue is not claimed or sent (it waits for a person), and because
  // it is left out of the query it can no longer fill the 50-row window and hide the approved posts behind it.
  const list = await sb<Row[]>(cfg, `/rest/v1/social_posts?${sel}&status=eq.scheduled&approved_at=not.is.null&publish_at=lte.${iso}&order=publish_at.asc&limit=50`, { admin: true });
  if (!list.ok || !Array.isArray(list.data)) return 0;
  // Stuck in 'publishing' (a Worker that died): found by age, re-claimed by the old claim time so two runs never both take it
  const stuck = await sb<Row[]>(cfg, `/rest/v1/social_posts?${sel}&status=eq.publishing&publish_at=lte.${iso}&order=publish_at.asc&limit=20`, { admin: true });
  // Platform tokens: the vault holds Well's today; per-company vault names come with ADR-0006's next step
  const vault = await sb<{ name: string; value: string }[]>(cfg, '/rest/v1/rpc/connector_env', { method: 'POST', admin: true, body: {} });
  const wellTokens = withEngineSecrets(Object.fromEntries((vault.ok && Array.isArray(vault.data) ? vault.data : []).map(x => [x.name, x.value])), e);
  let done = 0;
  const dueNow = list.data.filter(x => due(x, x.company?.social_approvers || [], now));
  // waiting videos and fresh posts each take their own slots, oldest first
  const batch = [...dueNow.filter(waiting).slice(0, PENDING_MAX), ...dueNow.filter(x => !waiting(x)).slice(0, FRESH_MAX)];
  const started = clock();
  for (const p of batch) {
    if (done && clock() - started > TICK_MS) break;
    const claim = await sb<Row[]>(cfg, `/rest/v1/social_posts?id=eq.${p.id}&status=eq.scheduled&approved_at=not.is.null`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { status: 'publishing', claimed_at: iso } });
    if (!claim.ok || !Array.isArray(claim.data) || !claim.data.length) continue;
    await work(cfg, p, wellTokens, f, now);
    done++;
  }
  for (const p of (stuck.ok && Array.isArray(stuck.data) ? stuck.data : []).filter(x => stale(x, now)).slice(0, STUCK_MAX)) {
    if (done && clock() - started > TICK_MS) break;
    const old = p.claimed_at ? `claimed_at=eq.${encodeURIComponent(p.claimed_at)}` : 'claimed_at=is.null';
    const claim = await sb<Row[]>(cfg, `/rest/v1/social_posts?id=eq.${p.id}&status=eq.publishing&approved_at=not.is.null&${old}`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { claimed_at: iso } });
    if (!claim.ok || !Array.isArray(claim.data) || !claim.data.length) continue;
    // Whatever path got a post here, it was approved when it was claimed; a row without an approval is never sent to any engine
    if (!p.approved_at) { console.error('social: a post in publishing without an approval was not sent', p.id); continue; }
    console.error('social: recovering a post stuck in publishing', p.id);
    await work(cfg, p, wellTokens, f, now);
    done++;
  }
  return done;
}
