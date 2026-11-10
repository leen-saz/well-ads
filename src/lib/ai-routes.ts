// Which provider and model each AI task runs on. The default is the table in llm.ts (PROVIDER) and nothing changes until the
// owner picks something here (maestro → «الموديلات»). Stored in ai_routes, read at most once a minute per isolate like the caps.
// A route naming a provider whose key is missing is ignored: the task keeps its current provider.
import { sb, type Cfg } from './auth';
import { scoped } from './tenant';
import type { Provider } from './llm';

export interface Route { provider: Provider; model?: string | undefined }
export interface Task { key: string; ar: string; en: string; def: Provider | 'anthropic' }
// Keys are the tab a call is billed to (tabOf in usage.ts), so a task's route, cost and cap all line up
export const TASKS: Task[] = [
  { key: 'debugger', ar: 'الديبقر: شرح التتبع', en: 'Debugger: tracking explanation', def: 'anthropic' },
  { key: 'overview', ar: 'مراجعة المدقق (الناقد)', en: 'Auditor review (critic)', def: 'anthropic' },
  { key: 'copy', ar: 'الكاتب', en: 'Copywriter', def: 'openai' },
  { key: 'content', ar: 'المحتوى', en: 'Content', def: 'openai' },
  { key: 'design', ar: 'التصميم والموشن', en: 'Design and motion', def: 'openai' },
  { key: 'compliance', ar: 'إعادة صياغة الامتثال', en: 'Compliance rewrite', def: 'openai' },
  { key: 'knowledge', ar: 'المعرفة', en: 'Knowledge', def: 'openai' },
  { key: 'social', ar: 'السوشال', en: 'Social', def: 'xai' },
  { key: 'listening', ar: 'الرصد', en: 'Listening', def: 'xai' },
  { key: 'maestro', ar: 'المدير', en: 'Manager', def: 'xai' },
  { key: 'journeys', ar: 'الرحلات', en: 'Journeys', def: 'workers' },
  { key: 'ahlam', ar: 'احلم (الصفحة الرئيسية)', en: 'Ahlam (home page)', def: 'openrouter' },
];
export const TASK_KEYS = new Set(TASKS.map(t => t.key));
export const ROUTE_PROVIDERS: Provider[] = ['openai', 'xai', 'openrouter', 'workers'];
// OpenRouter ids are «author/model» with optional :variant (openai/gpt-5, meta-llama/llama-4:free)
export const OR_MODEL = /^[a-z0-9][a-z0-9._~-]{0,60}\/[a-z0-9][a-z0-9._:~+-]{0,80}$/i;
// The task that runs on OpenRouter by default (when its key is set): its model, until the owner picks another in «الموديلات»
export const OR_DEFAULT: Record<string, string> = { ahlam: 'openai/gpt-4.1-mini' };
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
