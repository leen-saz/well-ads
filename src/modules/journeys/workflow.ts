// One customer inside one journey = one Workflow instance. It sleeps between steps (minutes to 90 days)
// without a server running, and each send is its own durable step: retried on failure, never sent twice.
import { tokensOf } from '../../mcp/vault';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { env as cfgOf, sb, type AuthEnv } from '../../lib/auth';
import { killOn } from '../../lib/guardrails';
import { send, type Contact, type Step } from './journeys';

export interface JourneyParams { runId: number; companyId: string; steps: Step[]; contact: Contact }

export class JourneyRun extends WorkflowEntrypoint<AuthEnv, JourneyParams> {
  override async run(event: Readonly<WorkflowEvent<JourneyParams>>, step: WorkflowStep) {
    const { runId, companyId, steps, contact } = event.payload;
    const cfg = cfgOf(this.env);
    const log: { i: number; type: string; ok: boolean; error?: string; at: string }[] = [];
    for (const [i, s] of steps.entries()) {
      if (s.type === 'wait') { await step.sleep(`wait-${i}`, `${s.hours} hours`); continue; }
      const r = await step.do(`send-${i}`, { retries: { limit: 3, delay: '1 minute', backoff: 'exponential' } }, async () => {
        // The emergency stop also stops the messages of runs already waiting between steps
        if (await killOn(cfg)) return { ok: false, error: 'زر الطوارئ شغّال' };
        // Platform tokens: this company's own, from the Token Vault (src/mcp/vault.ts)
        const t = await tokensOf(cfg, companyId);
        return send(s, contact, t);
      });
      log.push({ i, type: s.type, ...r, at: new Date().toISOString() });
      await step.do(`log-${i}`, async () => {
        await sb(cfg, `/rest/v1/journey_runs?id=eq.${runId}&company_id=eq.${companyId}`, { method: 'PATCH', admin: true, body: { log } });
        return true;
      });
    }
    await step.do('done', async () => {
      await sb(cfg, `/rest/v1/journey_runs?id=eq.${runId}&company_id=eq.${companyId}`, { method: 'PATCH', admin: true,
        body: { status: log.some(x => !x.ok) ? 'failed' : 'done', log } });
      return true;
    });
  }
}
