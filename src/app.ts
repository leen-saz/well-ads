import { Hono } from 'hono';
import { actions, middleware, notFound, pages, i18n } from 'astro/hono';
import { cf } from '@astrojs/cloudflare/hono';
import { api } from './api/index';
import { gate } from './lib/gate';
import type { AuthEnv } from './lib/auth';
import { withSecurityHeaders } from './lib/headers';
import { serveSite } from './lib/site';
import { versionAssets } from './lib/assets';
import { withWaiter } from './lib/usage';
import { dispatchRefresh, dispatchWorkflow, type CronEnv } from './lib/cron';
import { runWatchdog, type WatchdogEnv } from './lib/watchdog';
import { runListening, type ListenEnv } from './modules/listening/fetcher';
import { runSocial } from './modules/social/cron';
import { runTranscribe } from './modules/transcribe/service';
// Cloudflare Workflows: the class must be exported from the Worker entry
export { JourneyRun } from './modules/journeys/workflow';

type Bindings = Env & AuthEnv;
const SOCIAL_CRON = '*/5 * * * *';
const WATCHDOG_CRON = '37 * * * *';
// Sunday 02:17 UTC: the weekly encrypted backup. The 1st at 02:47 UTC: the monthly restore test (docs/runbook.md → Backups)
const BACKUP_CRON = '17 2 * * 0';
const RESTORE_CRON = '47 2 1 * *';

// Requests produced by a gateway rewrite (department or creative copy) skip the gateway the second time.
const REWRITTEN = new WeakSet<Request>();

// One Worker: the gateway runs first, then Hono serves /api/*, then the dashboards from R2, then Astro pages.
const app = new Hono<{ Bindings: Bindings }>();

app.use(async (c, next) => {
  await next();
  c.res = withSecurityHeaders(c.res);
});
// Cost records (src/lib/usage.ts) are written after the answer: this gives them the request's waitUntil
app.use(async (c, next) => {
  let wait: ((p: Promise<unknown>) => void) | undefined;
  try { const ctx = c.executionCtx; wait = p => ctx.waitUntil(p); } catch { /* no execution context (tests) */ }
  return wait ? withWaiter(wait, next) : next();
});
// Pages load our scripts and styles from their versioned, immutable copies
app.use(async (c, next) => {
  await next();
  c.res = versionAssets(c.res);
});
app.use(async (c, next) => {
  if (REWRITTEN.has(c.req.raw)) return next();
  const d = await gate(c.req.raw, c.env);
  if (d instanceof Response) return d;
  if (d.rewrite) {
    const req = new Request(d.rewrite, c.req.raw);
    REWRITTEN.add(req);
    const res = await app.fetch(req, c.env, c.executionCtx);
    if (!d.cookie) return res;
    const h = new Headers(res.headers); h.append('set-cookie', d.cookie);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }
  await next();
  if (d.cookie) {
    const h = new Headers(c.res.headers); h.append('set-cookie', d.cookie);
    c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers: h });
  }
  return;
});
app.route('/', api);
// Dashboards built by the pipeline, from R2 (phase 4.1)
app.use(async (c, next) => {
  let wait: ((p: Promise<unknown>) => void) | undefined;
  try { const ctx = c.executionCtx; wait = p => ctx.waitUntil(p); } catch { /* no execution context (tests) */ }
  return (await serveSite(c.req.raw, c.env.FILES, wait)) ?? next();
});
app.use(cf());
app.use(notFound());
app.use(actions());
app.use(middleware());
app.use(i18n());
app.use(pages());

export default {
  fetch: app.fetch,
  // Cloudflare Cron Triggers (production only): the hourly data refresh on GitHub Actions, and every 5 minutes the due social posts
  scheduled(event: ScheduledController, env: CronEnv & AuthEnv & WatchdogEnv, ctx: ExecutionContext) {
    // Minute 37: the outside watcher of the data age (src/lib/watchdog.ts). It must be matched here: anything else starts a refresh.
    if (event.cron === WATCHDOG_CRON) { ctx.waitUntil(runWatchdog(env).then(() => undefined, err => console.error('cron: watchdog failed', String(err).slice(0, 200)))); return; }
    // These two must be matched here: any other cron falls through to starting a data refresh
    if (event.cron === BACKUP_CRON) { ctx.waitUntil(dispatchWorkflow(env, 'db-backup.yml').then(() => undefined)); return; }
    if (event.cron === RESTORE_CRON) { ctx.waitUntil(dispatchWorkflow(env, 'db-restore-test.yml').then(() => undefined)); return; }
    // Every 5 minutes: due social posts, then one social-listening keyword that has not been fetched in a day
    withWaiter(p => ctx.waitUntil(p), () => ctx.waitUntil(event.cron === SOCIAL_CRON ? Promise.allSettled([runSocial(env), runListening(env as ListenEnv), runTranscribe(env as Parameters<typeof runTranscribe>[0])]).then(rs => rs.forEach((r, i) => { if (r.status === 'rejected') console.error('cron: job failed', ['social', 'listening', 'transcribe'][i], String(r.reason).slice(0, 200)); })) : dispatchRefresh(env)));
  },
};
