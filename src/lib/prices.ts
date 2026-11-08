// What each model costs, in US dollars per 1,000,000 tokens (input / output): the unit the providers invoice in.
// ESTIMATES: these are NOT copied from a provider invoice. Each row says where to check it and the date it was last
// looked at; `verified` stays false until the owner has matched a real invoice with the reconciliation check
// (Maestro → spend). A model with no row is recorded with priced=false and cost 0, so it shows as «سعر غير معروف»
// instead of silently looking free. Workers AI is free inside Cloudflare's daily allowance and is recorded as 0.
import type { Provider } from './llm';

// The providers a cost can be billed to: the text models of src/lib/llm.ts, and Gemini (audio, video, images, speech: src/lib/gemini.ts)
export type Billed = Provider | 'gemini';
export interface Price { provider: Billed; match: string; inUsd: number; outUsd: number; audioInUsd?: number; source: string; date: string; verified: boolean }

const OPENAI = 'platform.openai.com/docs/pricing';
const XAI = 'docs.x.ai/docs/models';
const GEMINI = 'ai.google.dev/gemini-api/docs/pricing';

// Longest `match` that the model id starts with wins, so a dated or versioned id still finds its family
export const PRICES: Price[] = [
  { provider: 'openai', match: 'gpt-6.1', inUsd: 2.5, outUsd: 10, source: OPENAI, date: '2026-11-06', verified: false },
  { provider: 'xai', match: 'grok-4', inUsd: 3, outUsd: 15, source: XAI, date: '2026-11-06', verified: false },
  // Gemini: audio and video input cost more per token than text; the speech model bills its output as audio tokens
  { provider: 'gemini', match: 'gemini-3-flash', inUsd: 0.3, outUsd: 2.5, audioInUsd: 1, source: GEMINI, date: '2026-11-08', verified: false },
  { provider: 'gemini', match: 'gemini-3.1-flash-tts', inUsd: 1, outUsd: 20, source: GEMINI, date: '2026-11-08', verified: false },
  { provider: 'workers', match: '@cf/', inUsd: 0, outUsd: 0, source: 'developers.cloudflare.com/workers-ai/platform/pricing (free daily allowance)', date: '2026-11-06', verified: false },
];

export function priceOf(provider: Billed, model: string): Price | null {
  let best: Price | null = null;
  for (const p of PRICES) if (p.provider === provider && model.startsWith(p.match) && (!best || p.match.length > best.match.length)) best = p;
  return best;
}

export const per = (tokens: number, usdPerMillion: number): number => (tokens * usdPerMillion) / 1_000_000;
