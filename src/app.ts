import { Hono } from 'hono';
import { actions, middleware, notFound, pages, i18n } from 'astro/hono';
import { cf } from '@astrojs/cloudflare/hono';
import { api } from './api/index';
import { gate } from './lib/gate';
import type { AuthEnv } from './lib/auth';
import { withSecurityHeaders } from './lib/headers';

type Bindings = Env & AuthEnv;

// Requests produced by a gateway rewrite (department or creative copy) skip the gateway the second time.
const REWRITTEN = new WeakSet<Request>();

// One Worker: the gateway runs first, then Hono serves /api/*, then Astro renders every page.
const app = new Hono<{ Bindings: Bindings }>();

app.use(async (c, next) => {
  await next();
  c.res = withSecurityHeaders(c.res);
});
app.use(async (c, next) => {
  if (REWRITTEN.has(c.req.raw)) return next();
  const d = await gate(c.req.raw, c.env);
  if (d instanceof Response) return d;
  if (d.rewrite) {
    const req = new Request(d.rewrite, c.req.raw);
    REWRITTEN.add(req);
    return app.fetch(req, c.env, c.executionCtx);
  }
  return next();
});
app.route('/', api);
app.use(cf());
app.use(notFound());
app.use(actions());
app.use(middleware());
app.use(i18n());
app.use(pages());

export default app;
