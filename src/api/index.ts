import { Hono } from 'hono';

// JSON API under /api/*. Auth, data and control routes land here in later phases.
export const api = new Hono().basePath('/api');

api.get('/health', (c) => c.json({ ok: true }));

api.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404));
