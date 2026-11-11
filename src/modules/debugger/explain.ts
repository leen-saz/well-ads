// "اشرح لي وش أسوي": Claude reads the tracking findings and writes a short plan, in order, in Saudi Arabic.
// Leen's choice: the Debugger runs on Claude (Anthropic). PAID: Anthropic bills every call (like the Grok bot).
// Without ANTHROPIC_API_KEY the button says it is off; the findings themselves never need it.
import Anthropic from '@anthropic-ai/sdk';
import type { Finding } from './debugger';
import { generate, withoutFallback, type LlmEnv } from '../../lib/llm';
import type { UsageCtx } from '../../lib/usage';

export interface ClaudeEnv { ANTHROPIC_API_KEY?: string; ANTHROPIC_MODEL?: string }
export const CLAUDE_MODEL = 'claude-sonnet-5-5'; // Leen: Sonnet (half the price of Opus); ANTHROPIC_MODEL overrides
type Platforms = Record<string, { spend7: number; leads7: number; lastDay: string | null; crm7: number }>;

const SYSTEM = `أنت خبير تتبع إعلانات (Meta و Snapchat و TikTok و Google) وربطها بالـ CRM، لشركة رعاية صحية في الرياض.
تكلم بالسعودي الواضح، مخاطبة المذكر، بجمل قصيرة. لا تخترع أرقام أو مشاكل غير اللي في الفحص.`;

export function explainPrompt(findings: Finding[], platforms: Platforms): string {
  const f = findings.filter(x => x.level !== 'ok').slice(0, 30);
  return `هذا فحص التتبع اليوم.
المشاكل (المستوى | العنوان | التفاصيل | الحل المقترح):
${f.map(x => `- ${x.level} | ${x.title} | ${x.detail} | ${x.fix}`).join('\n') || '- ما فيه مشاكل'}
كل منصة آخر 7 أيام (الصرف | ليدز المنصة | ليدز الـ CRM | آخر يوم فيه أرقام):
${Object.entries(platforms).map(([p, v]) => `- ${p} | ${v.spend7} | ${v.leads7} | ${v.crm7} | ${v.lastDay || '-'}`).join('\n') || '- ما فيه'}
المطلوب: رتّب الشغل حسب الأثر على الصرف والليدز. لكل خطوة: وش تسوي بالضبط، ووين (اسم الشاشة في المنصة)، وكيف تتأكد إنها انحلت.
بحد أقصى 7 خطوات مرقمة. بدون مقدمة.`;
}

// The same plan on OpenRouter, when the owner routed the Debugger there (src/lib/ai-routes.ts). Workers AI is not a fallback here:
// a failure throws, and the caller goes back to Claude.
export async function explainViaOpenRouter(e: LlmEnv, findings: Finding[], platforms: Platforms, ctx: UsageCtx, f: typeof fetch = fetch): Promise<{ text: string; model: string }> {
  const out = await generate(withoutFallback(e), 'debugger', { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: explainPrompt(findings, platforms) }], max_tokens: 3000 }, f, ctx);
  return { text: out.response.slice(0, 6000), model: out.model };
}

export async function explain(e: ClaudeEnv, findings: Finding[], platforms: Platforms, f?: typeof fetch): Promise<{ text: string; model: string; usage: { in: number; out: number } }> {
  if (!e.ANTHROPIC_API_KEY) throw new Error('no_key');
  const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 1, ...(f ? { fetch: f } : {}) });
  const model = (e.ANTHROPIC_MODEL || '').replace(/[^a-z0-9.\-_]/gi, '') || CLAUDE_MODEL;
  // fallbacks "default": a declined request is re-run on Anthropic's recommended model instead of coming back empty
  const r = await client.beta.messages.create({
    model, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'medium' }, system: SYSTEM,
    messages: [{ role: 'user', content: explainPrompt(findings, platforms) }],
  });
  if (r.stop_reason === 'refusal') throw new Error('refused');
  const text = r.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('').trim().slice(0, 6000);
  if (!text) throw new Error('empty');
  return { text, model: r.model, usage: { in: r.usage?.input_tokens ?? 0, out: r.usage?.output_tokens ?? 0 } };
}
