// /api/overview/data: the dashboard numbers (site/dash.json in R2, built by the pipeline) for the overview tab.
// Same reach as the analytics page: it needs analytics too, and a department manager sees only their department's page.
import { json, handle, requireUser, can } from '../../lib/auth';

type FilesEnv = { FILES?: R2Bucket };

export const data = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'overview');
  if (!can(user, 'ceo', cfg)) return json(403, { error: 'ما عندك صلاحية على أرقام التحليلات' });
  if (Array.isArray(user.depts) && user.depts.length) return json(403, { error: 'نظرة عامة لكل الأقسام. أرقام قسمك في صفحة التحليلات' });
  const files = (e as unknown as FilesEnv).FILES;
  const obj = files ? await files.get('site/dash.json') : null;
  if (!obj) return json(404, { error: 'ما فيه أرقام للحين' });
  return new Response(obj.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-cache' } });
}) };
