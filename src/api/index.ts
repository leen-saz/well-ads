import { Hono } from 'hono';
import { json, type AuthEnv, type Handler } from '../lib/auth';
import * as auth from './routes/auth';
import * as account from './routes/account';
import * as admin from './routes/admin';
import * as connectors from './routes/connectors';

type Group = Record<string, Partial<Record<string, Handler>>>;
const notFound = () => json(404, { error: 'غير موجود' });

// One route per group, dispatched by the last path segment and the method, as in the old /api/<group>/[action].js
const group = (routes: Group) => (c: { req: { raw: Request; method: string; param: (k: string) => string | undefined }; env: AuthEnv }) => {
  const name = c.req.param('action') || '';
  const h = Object.hasOwn(routes, name) ? routes[name]?.[c.req.method] : undefined;
  return h ? h(c.req.raw, c.env) : notFound();
};

export const api = new Hono<{ Bindings: AuthEnv }>().basePath('/api');

api.get('/health', c => c.json({ ok: true }));
api.all('/auth/:action', group(auth));
api.all('/admin/:action', group(admin));
api.all('/account/:action', group(account));
api.all('/connectors/:action', group(connectors));

api.notFound(() => json(404, { ok: false, error: 'not_found' }));
