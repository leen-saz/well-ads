// /api/vitals/report: Core Web Vitals from real visits (UX audit, step 6: measure before optimising).
// The page sends one report per full load when it is hidden (public/assets/vitals.js). Signed-in users only;
// nothing is stored: one log line per report, read in Cloudflare → Workers → well-ads → Logs (search "web_vital").
import { json, readJson, handle, requireUser } from '../../lib/auth';
import { cleanVitals } from '../../lib/vitals';

export const report = { POST: handle(async (request, e) => {
  await requireUser(request, e, 'any');
  const v = cleanVitals(await readJson(request, 2000));
  if (!v) return json(400, { error: 'تقرير غير صالح' });
  console.log(JSON.stringify({ event: 'web_vital', ...v }));
  return json(200, { ok: true });
}) };
