// /api/dash/data. Phase 4.2 (docs/phase-4.md): the dashboards' data as JSON for the Astro pages that replace the
// pipeline page. Each user gets the same copy their page carries today (build.py): department managers their
// department, creative-only users the creative copy, everyone else with analytics the full data.
import { json, handle, requireUser } from '../../lib/auth';
import { dataCopy, dataKey } from '../../lib/dash';

type FilesEnv = { FILES?: R2Bucket };

export const data = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any');
    const copy = dataCopy(user, cfg, new URL(request.url).searchParams.get('d'));
    if (!copy) return json(403, { error: 'ما عندك صلاحية' });
    const files = (e as unknown as FilesEnv).FILES;
    if (!files) return json(503, { error: 'الملفات مو مفعّلة في هالبيئة' });
    const obj = await files.get(dataKey(user.co, copy), { onlyIf: request.headers });
    if (!obj) return json(404, { error: 'ما فيه بيانات للحين' });
    // A minute fresh, then the browser shows its copy while it checks for a new one (304 when nothing changed)
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8', etag: obj.httpEtag,
      'cache-control': 'private, max-age=60, stale-while-revalidate=600', vary: 'cookie',
    });
    if (!('body' in obj)) return new Response(null, { status: 304, headers });
    return new Response(obj.body, { headers });
  }),
};
