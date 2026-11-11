// Optional LLM critic of a verdict: a DRAFT second opinion, never the check itself (the rules in audit.ts need no key).
// It runs on Claude (Anthropic), a different model family from whatever wrote the verdict, as the Debugger does. PAID: every
// call is recorded in ai_usage (usage.ts). It sees only what the owner page shows: the verdict's fields and the auditor's findings,
// as a short structured list (never prose, so a longer verdict cannot win by length), in an order fixed by a hash of the
// content (so position cannot favour either side), with an explicit rubric and a reason written BEFORE each score.
import Anthropic from '@anthropic-ai/sdk';
import type { Claim, Finding } from './contract';
import { record, type UsageCtx } from '../../lib/usage';
import { generate, viaOpenRouter, withoutFallback, type LlmEnv } from '../../lib/llm';

export interface CriticEnv extends LlmEnv { ANTHROPIC_API_KEY?: string; ANTHROPIC_MODEL?: string }
export const CRITIC_MODEL = 'claude-sonnet-5-5';
export const CRITERIA = ['evidence', 'alternatives', 'attribution', 'actionable'] as const;
export type Criterion = (typeof CRITERIA)[number];
export interface Critique { draft: true; model: string; scores: { criterion: Criterion; reason: string; score: number }[]; overall: number; summary: string }

const RUBRIC = `Rubric (score each 1 to 5; 1 = the verdict fails it, 5 = fully met):
- evidence: do the quoted numbers, the sample size and the rule that fired support the verdict?
- alternatives: have timing, mix across platforms and chance been ruled out, or does a simpler explanation fit?
- attribution: is the attribution gap smaller than the effect the verdict claims?
- actionable: would the named owner know what to do, and would it matter (money at stake)?
Rules: write the reason FIRST, then the score. Judge the evidence only: do not reward a longer or shorter text, and do not prefer
the first or the last item. Use only the facts given: invent no figure. If the data cannot settle a point, score it 3 and say what is missing.
Answer with JSON only: {"scores":[{"criterion":"evidence","reason":"...","score":1-5},...4 items],"summary":"one sentence"}`;

const SYSTEM = `You are a sharp, skeptical reviewer of marketing funnel verdicts for a healthcare company in Riyadh. You never write the verdict; you test it. ${RUBRIC}`;

// A stable order from the content itself: neither the verdict nor the findings are always first
function order<T>(xs: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return xs.map((x, i) => ({ x, k: Math.imul(h ^ (i + 1), 2654435761) >>> 0 })).sort((a, b) => a.k - b.k).map(o => o.x);
}

export function criticPrompt(c: Claim, fs: Finding[]): string {
  const v = c.verdict;
  const claim = [`step: ${v.step ?? 'none (no problem)'}`, `level: ${v.level}`, `owner: ${v.owner ?? 'none'}`,
    ...(v.confidence ? [`confidence: ${v.confidence}`] : []), ...(v.coverage != null ? [`attribution coverage: ${(100 * v.coverage).toFixed(0)}%`] : []),
    ...(v.rule ? [`rule: ${v.rule}`] : []), ...c.steps.map(s => `${s.key}: now ${s.now == null ? 'n/a' : s.now.toFixed(2)}, level ${s.level}${s.unattributed ? ', not linked to ads' : ''}`)];
  const audit = fs.filter(f => f.effect !== 'info').map(f => `${f.effect} | ${f.id} | ${f.text.en}`);
  const blocks = order([`VERDICT UNDER REVIEW\n${claim.map(x => `- ${x}`).join('\n')}`, `AUDITOR FINDINGS (rules)\n${audit.map(x => `- ${x}`).join('\n') || '- none'}`], claim.join('|') + audit.join('|'));
  return `${blocks.join('\n\n')}\n\nReview the verdict against the rubric.`;
}

export async function critique(e: CriticEnv, c: Claim, fs: Finding[], f?: typeof fetch, ctx?: UsageCtx): Promise<Critique> {
  // Routed to OpenRouter by the owner (src/lib/ai-routes.ts)? Try it first; on a failure Claude answers when its key is there.
  let text = '', used = '';
  if (ctx && await viaOpenRouter(e, 'overview', ctx)) {
    try {
      const o = await generate(withoutFallback(e), 'overview', { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: criticPrompt(c, fs) }], max_tokens: 1500 }, f ?? fetch, ctx);
      text = o.response; used = o.model;
    } catch (err) { console.warn('critic_openrouter_failed', (err as Error).message); if (!e.ANTHROPIC_API_KEY) throw err; }
  }
  if (!used) {
    if (!e.ANTHROPIC_API_KEY) throw new Error('no_key');
    const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 1, ...(f ? { fetch: f } : {}) });
    const model = (e.ANTHROPIC_MODEL || '').replace(/[^a-z0-9.\-_]/gi, '') || CRITIC_MODEL;
    const r = await client.beta.messages.create({
      model, max_tokens: 1500, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'medium' }, system: SYSTEM,
      messages: [{ role: 'user', content: criticPrompt(c, fs) }],
    });
    record(ctx, 'overview', { provider: 'anthropic', model: r.model, usage: { in: r.usage?.input_tokens ?? 0, out: r.usage?.output_tokens ?? 0 } });
    if (r.stop_reason === 'refusal') throw new Error('refused');
    text = r.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
    used = r.model;
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('empty');
  let j: { scores?: { criterion?: string; reason?: string; score?: number }[]; summary?: string };
  try { j = JSON.parse(m[0]); } catch { throw new Error('bad_json'); }
  const scores = CRITERIA.map(k => {
    const s = j.scores?.find(x => x.criterion === k);
    return { criterion: k, reason: String(s?.reason ?? '').slice(0, 400), score: Math.max(1, Math.min(5, Math.round(Number(s?.score) || 3))) };
  });
  return { draft: true, model: used, scores, overall: Math.round((10 * scores.reduce((a, s) => a + s.score, 0)) / scores.length) / 10, summary: String(j.summary ?? '').slice(0, 300) };
}
