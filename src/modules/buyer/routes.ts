// /api/buyer/*: the media buyer's recommendations for the user's company, computed from stored numbers, and the approved-execution
// layer on top of them (exec-routes.ts). `report` and `rules` below never talk to an ad platform; only exec/ does, and only after
// the owner's own approval. The company's rules and limits are saved by the owner into control_settings.guardrails.buyer (database, never the repo).
import { json, readJson, handle, requireUser, audit, sb } from '../../lib/auth';
import { cleanRules } from './rules';
import { PLATS } from './playbook';
import { buildReport, DB_KEY, settings } from './report';

export { actions, propose, decide, apply, rollback, execution } from './exec-routes';

export const report = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'buyer');
  const b = await buildReport(cfg, user);
  if (!b.ok) return json(500, { error: 'ما قدرت أقرأ أرقام الإعلانات' });
  return json(200, { ...b.report, readOnly: true });
}) };

// Only the owner (Leen) reads and saves the company's rules («قواعد الإدارة» in the decisions board). Only the rule list changes; the stop line and ladder stay as they were.
export const rules = {
  GET: handle(async (request, e) => {
    const { cfg } = await requireUser(request, e, 'owner', { well: true });
    return json(200, { rules: (await settings(cfg)).rules });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true, well: true });
    const b = await readJson(request, 100_000);
    const c = cleanRules(b.rules);
    if ('error' in c) return json(400, { error: c.error });
    // A preview: the same validation, nothing saved
    if (b.dry === true) return json(200, { ok: true, dry: true, rules: c.rules });
    const s = await settings(cfg);
    for (const p of PLATS) {
      const existing = s.rows.find(r => r.platform === DB_KEY[p]);
      const guard = { ...(existing?.guardrails ?? {}) }; const buyer = { ...(guard.buyer ?? {}), rules: c.rules.filter(r => r.platform === p) };
      const w = await sb(cfg, '/rest/v1/control_settings', { method: 'POST', admin: true, headers: { Prefer: 'return=representation,resolution=merge-duplicates' }, body: { platform: DB_KEY[p], guardrails: { ...guard, buyer }, updated_by: user.email, updated_at: new Date().toISOString() } });
      if (!w.ok) return json(500, { error: 'ما انحفظت القواعد' });
    }
    // counts only: the rules themselves (names, limits) never go to the log
    await audit(cfg, user, 'buyer_rules_saved', { target: { rules: c.rules.length } });
    return json(200, { ok: true, rules: c.rules.length });
  }),
};
