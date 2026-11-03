// /api/design/brief: brief + headline variants from our best ads. Reads ads and metrics; writes nothing.
import { sb, json, readJson, handle, requireUser, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { type AiRun } from '../content/content';
import { generate, pick, type LlmEnv } from '../../lib/llm';
import { knowledgeFor, withKnowledge } from '../knowledge/knowledge';
import { SIZES, TYPES, VISION_MODEL, VISION_PROMPT, images, variantsFrom, prompt, stylePrompt, templates, winners, type AdIn, type MetIn } from './design';

// Vision stays on Workers AI (free); the copy is written by OpenAI when OPENAI_API_KEY is set (src/lib/llm.ts)
type AiEnv = Omit<LlmEnv, 'AI'> & { AI?: { run: AiRun & ((model: string, input: { image: number[]; prompt: string; max_tokens: number }) => Promise<unknown>) } };

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
  // Up to 5 small images (product + 4 references, each capped in images()) ride in this body
  const b = await readJson(request, 1_100_000);
  const input = { type: String(b.type || 'ad'), offer: String(b.offer || '').slice(0, 200), audience: String(b.audience || '').slice(0, 200), dept: String(b.dept || '').slice(0, 60) };
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [ads, metrics] = await Promise.all([
    pages<AdIn>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,name,format,goal,text:doc->>text&goal=eq.lead', user.co), 3),
    pages<MetIn>(cfg, `/rest/v1/ad_metrics?select=ad_key,spend,leads,clicks,impressions&day=gte.${since}`),
  ]);
  const ref = winners(ads, metrics);
  let variants = templates(input.offer, input.audience), engine = 'templates', style = '';
  // Product photo and references: described by Workers AI vision, then used by the copy model. Not stored anywhere.
  const pics = images(b.images), looks = { product: [] as string[], refs: [] as string[] };
  if (e.AI && pics.length) {
    const said = await Promise.all(pics.map(p => e.AI!.run(VISION_MODEL, { image: p.bytes, prompt: VISION_PROMPT, max_tokens: 90 })
      .then(o => String((o as { description?: unknown; response?: unknown })?.description ?? (o as { response?: unknown })?.response ?? '').trim()).catch(() => '')));
    pics.forEach((p, i) => { const t = (said[i] || '').slice(0, 300); if (t) (p.kind === 'product' ? looks.product : looks.refs).push(t); });
    if (looks.product.length || looks.refs.length) {
      try { style = (await generate(e, 'design', { messages: [{ role: 'user', content: stylePrompt(looks) }], max_tokens: 160 })).response.trim().slice(0, 400); } catch { /* notes are optional */ }
    }
  }
  if (pick(e, 'design')) {
    try {
      const out = await generate(e, 'design', { messages: withKnowledge([{ role: 'user', content: prompt(input, ref.hooks, looks) }], await knowledgeFor(cfg, user.co, 'design')), max_tokens: 700 });
      // parseVariants keeps only well-formed variants (length-capped, compliance-flagged) and falls back to the templates
      const got = variantsFrom(out.response);
      if (got.length) { variants = got; engine = out.engine === 'workers' ? 'workers-ai' : out.engine; }
    } catch { /* templates stay */ }
  }
  return json(200, { input, reference: ref, variants, engine, sizes: SIZES, style, images: { product: looks.product.length, refs: looks.refs.length, sent: pics.length } });
}) };
