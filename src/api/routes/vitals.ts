// /api/vitals/report: Core Web Vitals from real visits (UX audit, step 6: measure before optimising).
// The page sends one report per full load when it is hidden (public/assets/vitals.js). Signed-in users only.
// Each report is one log line (Cloudflare → Workers → well-ads → Logs, search "web_vital") and one row in web_vitals
// (path and numbers only, kept 7 days) that the owner reads on the data-health page (/api/maestro/vitals).
import { json, readJson, handle, requireUser, sb } from '../../lib/auth';
import { cleanVitals } from '../../lib/vitals';

export const report = { POST: handle(async (request, e) => {
  const { cfg } = await requireUser(request, e, 'any');
  const v = cleanVitals(await readJson(request, 2000));
  if (!v) return json(400, { error: 'تقرير غير صالح' });
  console.log(JSON.stringify({ event: 'web_vital', ...v }));
  // A table that is not created yet (or a failed write) must never fail the page: the log line above is the fallback
  await sb(cfg, '/rest/v1/web_vitals', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' }, body: v }).catch(() => {});
  return json(200, { ok: true });
}) };
