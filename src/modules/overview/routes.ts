// /api/overview/data: the dashboard numbers (site/dash.json in R2, built by the pipeline) for the overview tab.
// Same reach as the analytics page: it needs analytics too, and a department manager sees only their department's page.
// dash.json is Well's own numbers (one file, not per company), so other companies get nothing.
import { json, handle, requireUser, can, isOwner } from '../../lib/auth';
import { WELL_COMPANY } from '../../lib/tenant';
import type { Dash } from './numbers';
import { dataSpan } from './span';

type FilesEnv = { FILES?: R2Bucket };

export const data = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'overview');
  if (user.co !== WELL_COMPANY) return json(404, { error: 'ما فيه أرقام لشركتك للحين' });
  if (!can(user, 'ceo', cfg)) return json(403, { error: 'ما عندك صلاحية على أرقام التحليلات' });
  if (Array.isArray(user.depts) && user.depts.length) return json(403, { error: 'ملخص الأداء لكل الأقسام. أرقام قسمك في صفحة الحملات والمنصات' });
  const files = (e as unknown as FilesEnv).FILES;
  const obj = files ? await files.get('site/dash.json') : null;
  if (!obj) return json(404, { error: 'ما فيه أرقام للحين' });
  return new Response(obj.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-cache' } });
}) };

// /api/overview/span: how much history the judge sees (span.ts), for the owner only. Counts and dates, no amounts, and
// nothing about it is logged. Tells whether a later media-mix model (about two years of daily spend per channel) is feasible.
export const span = { GET: handle(async (request, e) => {
  // The overview tab first (a company that switched it off is locked out, the owner included), then the owner only
  const { cfg, user } = await requireUser(request, e, 'overview');
  if (!isOwner(user, cfg)) return json(403, { error: 'هذي للمالك بس' });
  if (user.co !== WELL_COMPANY) return json(404, { error: 'ما فيه أرقام لشركتك للحين' });
  const files = (e as unknown as FilesEnv).FILES;
  const obj = files ? await files.get('site/dash.json') : null;
  if (!obj) return json(404, { error: 'ما فيه أرقام للحين' });
  return json(200, dataSpan(await new Response(obj.body).json() as Dash), { 'cache-control': 'private, no-cache' });
}) };
