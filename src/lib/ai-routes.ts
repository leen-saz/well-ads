// Which provider and model each AI task runs on. The default is the table in llm.ts (PROVIDER) and nothing changes until the
// owner picks something here (maestro → «الموديلات»). Stored in ai_routes, read at most once a minute per isolate like the caps.
// A route naming a provider whose key is missing is ignored: the task keeps its current provider.
import { sb, type Cfg } from './auth';
import { scoped } from './tenant';
import type { Provider } from './llm';

export interface Route { provider: Provider; model?: string | undefined }
export interface Task { key: string; ar: string; en: string; def: Provider | 'anthropic' }

// THE source of each tab's default provider (llm.ts, the owner screen and docs/ai-providers.md all read it). A tab with no entry is on the free Workers AI.
export const PROVIDER: Record<string, Provider> = { content: 'openai', design: 'openai', copy: 'openai', motion: 'openai', video: 'openai', social: 'xai', maestro: 'xai', listening: 'xai', ahlam: 'openrouter', ahlam_campaign: 'openrouter' };
// Tasks that call generate() under another module name (compliance and knowledge write with the content model)
const ALIAS: Record<string, string> = { compliance: 'content', knowledge: 'content' };
// The Debugger and the critic call Anthropic directly unless the owner routes them elsewhere
const DIRECT_CLAUDE = new Set(['debugger', 'overview']);
export const defaultOf = (key: string): Provider | 'anthropic' => DIRECT_CLAUDE.has(key) ? 'anthropic' : PROVIDER[ALIAS[key] ?? key] ?? 'workers';

// Keys are the tab a call is billed to (tabOf in usage.ts), so a task's route, cost and cap all line up
const LIST: [string, string, string][] = [
  ['debugger', 'الديبقر: شرح التتبع', 'Debugger: tracking explanation'],
  ['overview', 'مراجعة المدقق (الناقد)', 'Auditor review (critic)'],
  ['copy', 'الكاتب', 'Copywriter'],
  ['content', 'المحتوى', 'Content'],
  ['design', 'التصميم والموشن', 'Design and motion'],
  ['video', 'الفيديو: الموجز والسكربت', 'Video: brief and script'],
  ['compliance', 'إعادة صياغة الامتثال', 'Compliance rewrite'],
  ['knowledge', 'المعرفة', 'Knowledge'],
  ['social', 'السوشال', 'Social'],
  ['listening', 'الرصد', 'Listening'],
  ['maestro', 'المدير', 'Manager'],
  ['journeys', 'الرحلات', 'Journeys'],
  ['ahlam_campaign', 'احلم: حملة جديدة', 'Ahlam: new campaign'],
  ['ahlam', 'احلم (الصفحة الرئيسية)', 'Ahlam (home page)'],
];
export const TASKS: Task[] = LIST.map(([key, ar, en]) => ({ key, ar, en, def: defaultOf(key) }));
export const TASK_KEYS = new Set(TASKS.map(t => t.key));
export const ROUTE_PROVIDERS: Provider[] = ['openai', 'xai', 'openrouter', 'workers'];
// OpenRouter ids are «author/model» with optional :variant (openai/gpt-5, meta-llama/llama-4:free)
export const OR_MODEL = /^[a-z0-9][a-z0-9._~-]{0,60}\/[a-z0-9][a-z0-9._:~+-]{0,80}$/i;
// The task that runs on OpenRouter by default (when its key is set): its model, until the owner picks another in «الموديلات»
export const OR_DEFAULT: Record<string, string> = { ahlam: 'openai/gpt-4.1-mini', ahlam_campaign: 'openai/gpt-4.1' };
export const cleanModel = (s: unknown): string => String(s ?? '').trim().slice(0, 120);

const SNAP_MS = 60_000;
const SNAPS = new Map<string, { at: number; routes: Map<string, Route> }>();
export const clearRoutes = (): void => SNAPS.clear();

export async function routesOf(cfg: Cfg, co: string, now = Date.now()): Promise<Map<string, Route>> {
  const hit = SNAPS.get(co);
  if (hit && now - hit.at < SNAP_MS) return hit.routes;
  const snap = { at: now, routes: new Map<string, Route>() };
  SNAPS.set(co, snap);   // set first: a failing read is not retried on every call
  try {
    const r = await sb<{ task: string; provider: Provider; model: string | null }[]>(cfg, scoped('/rest/v1/ai_routes?select=task,provider,model', co), { admin: true });
    if (r.ok && Array.isArray(r.data)) for (const x of r.data) if (ROUTE_PROVIDERS.includes(x.provider)) snap.routes.set(x.task, { provider: x.provider, model: x.model || undefined });
  } catch { /* no routes: every task keeps its default */ }
  return snap.routes;
}
