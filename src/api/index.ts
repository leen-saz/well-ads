import { handleMcp } from '../mcp/http';
import { Hono } from 'hono';
import { json, requireUser, type AuthEnv, type Handler } from '../lib/auth';
import * as auth from './routes/auth';
import * as account from './routes/account';
import * as admin from './routes/admin';
import * as connectors from './routes/connectors';
import * as control from './routes/control';
import * as dash from './routes/dash';
import * as lessons from './routes/lessons';
import { list as libraryRoot, item as libraryItem, star as libraryStar, approve as libraryApprove } from './routes/library';
import * as today from './routes/today';
import * as campaigns from './routes/campaigns';
import * as buyer from './routes/buyer';
import * as vitals from './routes/vitals';
import * as approvals from './routes/approvals';
import * as webhooks from './routes/webhooks';
import { ROUTES } from '../modules/routes';
import { health, type HealthEnv } from '../lib/health';
import { dataStatus } from '../lib/datastatus';
import { handleV1 } from '../lib/apiv1';

type Group = Record<string, Partial<Record<string, Handler>>>;
const notFound = () => json(404, { error: 'غير موجود' });

// One route per group, dispatched by the last path segment and the method, as in the old /api/<group>/[action].js
const group = (routes: Group) => (c: { req: { raw: Request; method: string; param: (k: string) => string | undefined }; env: AuthEnv }) => {
  const name = c.req.param('action') || '';
  const h = Object.hasOwn(routes, name) ? routes[name]?.[c.req.method] : undefined;
  return h ? h(c.req.raw, c.env) : notFound();
};

export const api = new Hono<{ Bindings: AuthEnv }>().basePath('/api');

// Public: only `ok` and `version` (the deploy check and uptime watchers need nothing else). Always 200 when the Worker answers. Never cached.
api.get('/health', async c => { const h = await health((c.env ?? {}) as unknown as HealthEnv); return c.json({ ok: h.ok, version: h.version }, 200, { 'cache-control': 'no-store' }); });
// Owner only: dependencies, unapplied migrations, data age and the environment name (the gate asks for 'owner' too: src/lib/gate.ts)
api.get('/health/details', async c => {
  // requireUser throws the 401/403 Response; return it as the answer
  try { await requireUser(c.req.raw, c.env, 'owner'); } catch (e) { if (e instanceof Response) return e; throw e; }
  return c.json(await health((c.env ?? {}) as unknown as HealthEnv), 200, { 'cache-control': 'no-store' });
});
// Age of the numbers, codes only (the pages say it in words). Reads R2 only; kept 2 minutes by the browser.
api.get('/data-status', async c => c.json(await dataStatus((c.env as unknown as HealthEnv)?.FILES), 200, { 'cache-control': 'private, max-age=120' }));
// Read-only API for tools and agents: its own bearer-key auth inside (src/lib/apiv1.ts). The gate lets this prefix through without a session,
// so every path under it, known or not, goes through the key check first.
api.all('/v1', c => handleV1(c.req.raw, c.env as never));
api.all('/v1/*', c => handleV1(c.req.raw, c.env as never));
// The Well MCP (docs/PRD.md §3.0): JSON-RPC over POST, the same key check inside (src/mcp/http.ts)
api.all('/mcp', c => handleMcp(c.req.raw, c.env as never));
// Every route group: the core ones, then one per live module (src/modules/routes.ts). Exported for the error-behaviour test.
export const GROUPS: Record<string, Group> = { auth, admin, account, connectors, control, buyer, dash, lessons, approvals, webhooks, today, campaigns, vitals, library: { list: libraryRoot, item: libraryItem, star: libraryStar, approve: libraryApprove }, ...ROUTES };
for (const [key, routes] of Object.entries(GROUPS)) api.all(`/${key}/:action`, group(routes));
// The shared library also answers on the bare path: GET/POST /api/library
api.on(['GET', 'POST'], '/library', c => (libraryRoot[c.req.method as 'GET' | 'POST'] as Handler)(c.req.raw, c.env));

api.notFound(() => json(404, { ok: false, error: 'غير موجود' }));
// Anything that escapes a handler: JSON in Arabic, never a stack trace or the upstream's message
api.onError(err => {
  if (err instanceof Response) return err;
  console.error('api_unhandled', err instanceof Error ? err.message : String(err));
  return json(500, { ok: false, error: 'صار خطأ، جرّب مرة ثانية' });
});
