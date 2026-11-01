// /api/design/brief: brief + headline variants from our best ads. Reads ads and metrics; writes nothing.
import { sb, json, readJson, handle, requireUser, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { AI_MODEL, type AiRun } from '../content/content';
import { SIZES, TYPES, parseVariants, prompt, templates, winners, type AdIn, type MetIn } from './design';

type AiEnv = { AI?: { run: AiRun } };

async function pages<T>(cfg: Cfg, path: string, max = 8): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    const r = await sb<T[]>(cfg, path, { admin: true, headers: { 'Range-Unit': 'items', Range: `${i * 1000}-${i * 1000 + 999}` } });
    if (!r.ok || !Array.isArray(r.data)) break;
    out.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return out;
}

export const options = { GET: handle(async (request, e) => {
  await requireUser(request, e, 'design');
  return json(200, { sizes: SIZES, types: TYPES });
}) };

export const brief = { POST: handle(async (request, e: AiEnv & Parameters<typeof requireUser>[1]) => {
  const { cfg, user } = await requireUser(request, e, 'design', { write: true });
  const b = await readJson(request);
  const input = { type: String(b.type || 'ad'), offer: String(b.offer || '').slice(0, 200), audience: String(b.audience || '').slice(0, 200), dept: String(b.dept || '').slice(0, 60) };
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [ads, metrics] = await Promise.all([
    pages<AdIn>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,name,format,goal,text:doc->>text&goal=eq.lead', user.co), 3),
    pages<MetIn>(cfg, `/rest/v1/ad_metrics?select=ad_key,spend,leads,clicks,impressions&day=gte.${since}`),
  ]);
  const ref = winners(ads, metrics);
  let variants = templates(input.offer, input.audience), engine = 'templates';
  if (e.AI) {
    try {
      const out = await e.AI.run(AI_MODEL, { messages: [{ role: 'user', content: prompt(input, ref.hooks) }], max_tokens: 700 });
      variants = parseVariants(String((out as { response?: unknown })?.response ?? ''), input.offer, input.audience);
      engine = 'workers-ai';
    } catch { /* templates stay */ }
  }
  return json(200, { input, reference: ref, variants, engine, sizes: SIZES });
}) };
