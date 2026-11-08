// «المدقق»: runs both parts on a claim and returns one result: the headline verdict's status (confirmed / weakened /
// contradicted), the status of each step, and every finding once. Pure: no network, no key, no clock.
import { type AuditConfig, type AuditResult, type Claim, type Finding, type StepAudit, type StepKey, DEFAULT_CONFIG, statusOf } from './contract';
import { type Raw, recompute } from './facts';
import { integrity } from './checks';
import { advocate } from './advocate';

export function audit(data: Raw, c: Claim, cfg: AuditConfig = DEFAULT_CONFIG): AuditResult {
  const f = recompute(data, c.from, c.to, c.by, c.plat);
  const a = integrity(c, f, cfg), b = advocate(c, f, cfg);
  const findings: Finding[] = [...a.findings, ...b.findings];
  const steps: Partial<Record<StepKey, StepAudit>> = {};
  for (const s of c.steps) { const fs = findings.filter(x => x.step === s.key); steps[s.key] = { status: statusOf(fs), findings: fs }; }
  // The headline: its own findings, and those of the step it names
  const vf = findings.filter(x => x.step === 'verdict' || (c.verdict.step != null && x.step === c.verdict.step));
  const verdict = { status: statusOf(vf), findings: vf };
  return { status: verdict.status, verdict, steps, findings, checked: a.checked + b.checked };
}
