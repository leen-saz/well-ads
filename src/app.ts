import { Hono } from 'hono';
import { actions, middleware, notFound, pages, i18n } from 'astro/hono';
import { cf } from '@astrojs/cloudflare/hono';
import { api } from './api/index';
import { withSecurityHeaders } from './lib/headers';

// One Worker: Hono serves /api/*, Astro renders every page.
const app = new Hono<{ Bindings: Env }>();

app.use(async (c, next) => {
  await next();
  c.res = withSecurityHeaders(c.res);
});
app.route('/', api);
app.use(cf());
app.use(notFound());
app.use(actions());
app.use(middleware());
app.use(i18n());
app.use(pages());

export default app;
