// /api/listening/demand: leads per source this week vs last week (CRM), a demand signal next to the organic analysis.
// The organic analysis itself runs in the browser (public/modules/listening/analyze.js). Read-only.
import { sb, json, handle, requireUser } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { weekly, type Lead } from './listening';

export const demand = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'listening');
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const out: Lead[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await sb<Lead[]>(cfg, scoped(`/rest/v1/crm_leads?select=source_platform,created_at&created_at=gte.${since}`, user.co),
      { admin: true, headers: { 'Range-Unit': 'items', Range: `${i * 1000}-${i * 1000 + 999}` } });
    if (!r.ok || !Array.isArray(r.data)) break; // no CRM table yet: the page still shows the organic side
    out.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return json(200, { sources: weekly(out) });
}) };
