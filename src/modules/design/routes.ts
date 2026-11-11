// /api/design/brief: brief + headline variants from our best ads, and a ChatGPT background when no photo is given. Writes nothing.
// /api/design/videos|videofile|video|videoedit|videoapprove: the «موشن جرافيك» type (motion projects and their versions).
import { json, readJson, handle, requireUser, type Cfg, type Session } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { readAll } from '../../lib/paging';
import { type AiRun } from '../content/content';
import { generate, imageOf, pick, type LlmEnv } from '../../lib/llm';
import { usageCtx } from '../../lib/usage';
import { knowledgeFor, withKnowledge } from '../knowledge/knowledge';
import { brandFor, serveFile } from '../knowledge/brand';
import { SIZES, TYPES, VISION_MODEL, VISION_PROMPT, backgroundPrompt, imageMiss, imageSize, images, productPhoto, variantsFrom, prompt, stylePrompt, templates, winners, type AdIn, type MetIn } from './design';

// Vision stays on Workers AI (free); the copy is written by OpenAI when OPENAI_API_KEY is set (src/lib/llm.ts)
type AiEnv = Omit<LlmEnv, 'AI'> & { AI?: { run: AiRun & ((model: string, input: { image: number[]; prompt: string; max_tokens: number }) => Promise<unknown>) } };

type Input = { type: string; offer: string; audience: string; dept: string };
const inputOf = (b: Record<string, unknown>): Input => ({ type: String(b.type || 'ad'), offer: String(b.offer || '').slice(0, 200), audience: String(b.audience || '').slice(0, 200), dept: String(b.dept || '').slice(0, 60) });
// ChatGPT draws the picture (OpenAI Images, PAID per image): the product photo put in a new scene when one is given,
// else a new background, in the shape that suits the chosen sizes, under the Design tab's monthly cap
async function backgroundFor(e: LlmEnv, cfg: Cfg, user: Session, input: Input, colors: string[], style: string, b: Record<string, unknown>) {
  const hd = productPhoto(b.product);
  const out = await imageOf(e, backgroundPrompt(input, colors, style, !!hd), fetch, hd ?? undefined, usageCtx(cfg, user), imageSize(b.sizes));
  return { image: out.image, imageError: imageMiss(out, user) };
}

// The company's active brand (المعرفة ← الهوية والبصريات) comes with the options, so the page uses it without uploads
export const options = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'design');
  return json(200, { sizes: SIZES, types: TYPES, brand: await brandFor(cfg, user.co) });
}) };

// An active brand file (logo, font, reference image) for the design page; inactive ones stay hidden here
export const brandfile = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'design');
  return serveFile(cfg, user.co, parseInt(new URL(request.url).searchParams.get('id') || '', 10) || 0, (e as { FILES?: R2Bucket }).FILES, true);
}) };

export const brief = { POST: handle(async (request, e: AiEnv & Parameters<typeof requireUser>[1]) => {
  const { cfg, user } = await requireUser(request, e, 'design', { write: true });
  // Up to 5 small images (product + 4 references, each capped in images()) and the product at 1024 px ride in this body
  const b = await readJson(request, 3_200_000);
  const input = inputOf(b);
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [ads, metrics] = await Promise.all([
    readAll<AdIn>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,name,format,goal,text:doc->>text&goal=eq.lead', user.co), 'ad_key.asc', 3),
    readAll<MetIn>(cfg, `/rest/v1/ad_metrics?select=ad_key,spend,leads,clicks,impressions&day=gte.${since}`, 'ad_key.asc,day.asc', 8),
  ]);
  const ref = winners(ads.rows, metrics.rows);
  let variants = templates(input.offer, input.audience), engine = 'templates', style = '';
  // Product photo and references: described by Workers AI vision, then used by the copy model. Not stored anywhere.
  const pics = images(b.images), looks = { product: [] as string[], refs: [] as string[] };
  if (e.AI && pics.length) {
    const said = await Promise.all(pics.map(p => e.AI!.run(VISION_MODEL, { image: p.bytes, prompt: VISION_PROMPT, max_tokens: 90 })
      .then(o => String((o as { description?: unknown; response?: unknown })?.description ?? (o as { response?: unknown })?.response ?? '').trim()).catch(() => '')));
    pics.forEach((p, i) => { const t = (said[i] || '').slice(0, 300); if (t) (p.kind === 'product' ? looks.product : looks.refs).push(t); });
  }
  // No references sent this time: the brand's approved reference images (described once, at upload) and colours
  const brand = await brandFor(cfg, user.co);
  if (!looks.refs.length) looks.refs.push(...brand.notes);
  if (brand.colors.length) looks.refs.push(`ألوان العلامة: ${brand.colors.join(' ')}`);
  if (pick(e, 'design') && (looks.product.length || looks.refs.length)) {
    try { style = (await generate(e, 'design', { messages: [{ role: 'user', content: stylePrompt(looks) }], max_tokens: 160 }, fetch, usageCtx(cfg, user))).response.trim().slice(0, 400); } catch { /* notes are optional */ }
  }
  // The picture is drawn while the text is written
  const drawing = backgroundFor(e, cfg, user, input, brand.colors, style, b);
  if (pick(e, 'design')) {
    try {
      const out = await generate(e, 'design', { messages: withKnowledge([{ role: 'user', content: prompt(input, ref.hooks, looks) }], await knowledgeFor(cfg, user.co, 'design')), max_tokens: 700 }, fetch, usageCtx(cfg, user));
      // parseVariants keeps only well-formed variants (length-capped, compliance-flagged) and falls back to the templates
      const got = variantsFrom(out.response);
      if (got.length) { variants = got; engine = out.engine === 'workers' ? 'workers-ai' : out.engine; }
    } catch { /* templates stay */ }
  }
  const { image, imageError } = await drawing;
  return json(200, { input, reference: ref, variants, engine, sizes: SIZES, style, image, imageError, images: { product: looks.product.length, refs: looks.refs.length, sent: pics.length } });
}) };

// «جرّب مرة ثانية» for the picture only: the same brief, no new copy (one paid image)
export const background = { POST: handle(async (request, e: LlmEnv & Parameters<typeof requireUser>[1]) => {
  const { cfg, user } = await requireUser(request, e, 'design', { write: true });
  const b = await readJson(request, 3_200_000);
  const brand = await brandFor(cfg, user.co);
  return json(200, await backgroundFor(e, cfg, user, inputOf(b), brand.colors, String(b.style || '').slice(0, 400), b));
}) };

// «موشن جرافيك»: the video projects of this tab (src/modules/design/video.ts)
export { videos, videofile, video, videoedit, videoapprove } from './video';
