// One customer inside one journey = one Workflow instance. It sleeps between steps (minutes to 90 days)
// without a server running, and each send is its own durable step: retried on failure, never sent twice.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { env as cfgOf, sb, type AuthEnv } from './auth';
import { WELL_COMPANY } from './tenant';
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
        // Platform tokens: the vault holds Well's today; per-company vault names come with ADR-0006's next step
        const v = companyId === WELL_COMPANY ? await sb<{ name: string; value: string }[]>(cfg, '/rest/v1/rpc/connector_env', { method: 'POST', admin: true, body: {} }) : null;
        const t = Object.fromEntries((v?.ok && Array.isArray(v.data) ? v.data : []).map(x => [x.name, x.value]));
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
