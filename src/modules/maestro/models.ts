// /api/maestro/models: which provider and model each AI task runs on (docs/ai-providers.md). Owner only.
// GET: the providers (on or «غير مفعّل» by whether their key is set), and per task its default, its route and what it uses now.
// POST: set or clear one task's route. Nothing is stored but the provider and the model id; the keys stay Worker secrets.
import { sb, json, readJson, handle, requireUser, audit, missingSchema, notApplied, type AuthEnv } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { pick, type LlmEnv, type Provider } from '../../lib/llm';
import { TASKS, TASK_KEYS, ROUTE_PROVIDERS, OR_MODEL, cleanModel, clearRoutes, routesOf } from '../../lib/ai-routes';

const MIGRATION = 'migration 029_openrouter_routes.sql';
type Env = AuthEnv & LlmEnv & { ANTHROPIC_API_KEY?: string };
const PROVIDERS = (e: Env) => [
  { key: 'openai', ar: 'OpenAI', on: !!e.OPENAI_API_KEY },
  { key: 'xai', ar: 'Grok (xAI)', on: !!e.XAI_API_KEY },
  { key: 'openrouter', ar: 'OpenRouter', on: !!e.OPENROUTER_API_KEY },
  { key: 'workers', ar: 'المجاني (Workers AI)', on: !!e.AI },
];

export const models = {
  GET: handle(async (request, e: Env) => {
    const { cfg, user } = await requireUser(request, e, 'owner');
    const routes = await routesOf(cfg, user.co);
    return json(200, {
      providers: PROVIDERS(e),
      tasks: TASKS.map(t => {
        const r = routes.get(t.key), now = pick(e, t.key === 'compliance' || t.key === 'knowledge' ? 'content' : t.key, false, r);
        // the Debugger and the critic stay on Claude (their own key) unless the route sends them to OpenRouter
        const using = t.def === 'anthropic' ? (r?.provider === 'openrouter' && now?.provider === 'openrouter' ? 'openrouter' : e.ANTHROPIC_API_KEY ? 'anthropic' : null) : now?.provider ?? null;
        return { task: t.key, ar: t.ar, en: t.en, default: t.def, route: r ? { provider: r.provider, model: r.model ?? '' } : null, using, model: using === 'anthropic' ? '' : now?.model ?? '' };
      }),
    });
  }),
  POST: handle(async (request, e: Env) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
    const b = await readJson(request, 2000);
    const task = String(b.task || ''), provider = String(b.provider || '');
    if (!TASK_KEYS.has(task)) return json(400, { error: 'اختر المهمة' });
    if (provider === '') {
      const r = await sb(cfg, scoped(`/rest/v1/ai_routes?task=eq.${task}`, user.co), { method: 'DELETE', admin: true, headers: { Prefer: 'return=minimal' } });
      if (!r.ok) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(user, MIGRATION) : 'ما انحفظ الاختيار' });
      clearRoutes(); await audit(cfg, user, 'ai_route_cleared', { target: { task } });
      return json(200, { ok: true });
    }
    if (!ROUTE_PROVIDERS.includes(provider as Provider)) return json(400, { error: 'اختر المزوّد' });
    if (!PROVIDERS(e).find(p => p.key === provider)?.on) return json(409, { error: 'هالمزوّد غير مفعّل. فعّل مفتاحه أول.' });
    const model = cleanModel(b.model);
    if (provider === 'openrouter' && !OR_MODEL.test(model)) return json(400, { error: 'اكتب معرّف الموديل مثل openai/gpt-5 (اسم المطوّر ثم الموديل)' });
    if ((provider === 'openai' || provider === 'xai') && model && !/^[a-z0-9.\-_:]{1,80}$/i.test(model)) return json(400, { error: 'معرّف الموديل غير صحيح' });
    const keep = provider === 'workers' ? null : model || null;
    const r = await sb(cfg, '/rest/v1/ai_routes?on_conflict=company_id,task', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { company_id: user.co, task, provider, model: keep, updated_by: user.email, updated_at: new Date().toISOString() } });
    if (!r.ok) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(user, MIGRATION) : 'ما انحفظ الاختيار' });
    clearRoutes(); await audit(cfg, user, 'ai_route_set', { target: { task, provider, model: keep } });
    return json(200, { ok: true });
  }),
};
