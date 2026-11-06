import { Hono } from 'hono';
import { json, type AuthEnv, type Handler } from '../lib/auth';
import * as auth from './routes/auth';
import * as account from './routes/account';
import * as admin from './routes/admin';
import * as connectors from './routes/connectors';
import * as control from './routes/control';
import * as dash from './routes/dash';
import * as lessons from './routes/lessons';
import { list as libraryRoot, item as libraryItem, star as libraryStar, approve as libraryApprove } from './routes/library';
import * as today from './routes/today';
import * as vitals from './routes/vitals';
import { ROUTES } from '../modules/routes';
import { health, type HealthEnv } from '../lib/health';

type Group = Record<string, Partial<Record<string, Handler>>>;
const notFound = () => json(404, { error: 'غير موجود' });

// One route per group, dispatched by the last path segment and the method, as in the old /api/<group>/[action].js
const group = (routes: Group) => (c: { req: { raw: Request; method: string; param: (k: string) => string | undefined }; env: AuthEnv }) => {
  const name = c.req.param('action') || '';
  const h = Object.hasOwn(routes, name) ? routes[name]?.[c.req.method] : undefined;
  return h ? h(c.req.raw, c.env) : notFound();
};

export const api = new Hono<{ Bindings: AuthEnv }>().basePath('/api');

// Always 200 when the Worker answers: `ok` and `checks` say what is down. Never cached.
api.get('/health', async c => c.json(await health((c.env ?? {}) as unknown as HealthEnv), 200, { 'cache-control': 'no-store' }));
// Every route group: the core ones, then one per live module (src/modules/routes.ts). Exported for the error-behaviour test.
export const GROUPS: Record<string, Group> = { auth, admin, account, connectors, control, dash, lessons, today, vitals, library: { list: libraryRoot, item: libraryItem, star: libraryStar, approve: libraryApprove }, ...ROUTES };
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
