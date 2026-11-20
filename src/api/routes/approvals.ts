// /api/approvals/{counts,list}: the approvals center (docs/PRD.md §3.1, src/lib/approvals.ts). Read-only, any signed-in
// user; each user sees and counts only what they may approve. Deciding stays on each item's own route.
import { json, handle, requireUser } from '../../lib/auth';
import { collect, KINDS, type Kind } from '../../lib/approvals';
import { MODULES } from '../../modules/registry';

const tabName = (k: string) => k === 'ads' ? 'لوحة القرارات' : MODULES.find(m => m.key === k)?.ar ?? k;
const fail = () => json(500, { error: 'ما قدرنا نجيب القائمة. جرّب مرة ثانية' });

// The sidebar's number: kept 30 seconds by the browser, never shared
export const counts = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any');
    try {
      const r = await collect(cfg, user, tabName);
      return json(200, { counts: r.counts }, { 'cache-control': 'private, max-age=30' });
    } catch { return fail(); }
  }),
};

export const list = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any');
    const kind = new URL(request.url).searchParams.get('kind') || '';
    if (kind && !KINDS.includes(kind as Kind)) return json(400, { error: 'نوع غير معروف' });
    try {
      const r = await collect(cfg, user, tabName);
      return json(200, { items: kind ? r.items.filter(i => i.kind === kind) : r.items, counts: r.counts,
        can: { social: r.rights.social, ads: r.rights.ads, lessons: r.rights.lessonModules.length > 0 } }, { 'cache-control': 'private, no-store' });
    } catch { return fail(); }
  }),
};
