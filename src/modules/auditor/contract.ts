// «المدقق»: the contract between a verdict and its auditor. A Claim is what a verdict SAYS (the numbers it quotes, the step it
// names, the owner, how sure it is), whatever code produced it. The auditor never imports the judge's calculations: it
// recomputes from the raw dash.json (facts.ts) and compares. Fields the judge does not state yet are optional, and a check
// whose input is missing is skipped, never guessed. Judge-specific mapping lives in adapter.ts only.
// cpa = cost per closing, roas = return on spend (the marketing judge's CRM-side steps)
export type StepKey = 'cpm' | 'click' | 'lead' | 'sale' | 'cpl' | 'cpa' | 'roas';
export type Level = 'bad' | 'watch' | 'ok';
export type Confidence = 'high' | 'medium' | 'low';
export type Status = 'confirmed' | 'weakened' | 'contradicted';
export type Bi = { ar: string; en: string };

export interface ClaimStep {
  key: StepKey;
  // Left out when the judge reads the figure differently from the auditor's facts (see adapter.ts)
  now?: number | null; prev?: number | null; median?: number | null;
  // The target the step is held to (a floor for the rates), and whether someone set it or it is still the shipped default
  target?: number | null; targetEdited?: boolean;
  level: Level;
  unattributed: boolean;
  owner: string;
  sarAtStake?: number | null;
}
export interface ClaimVerdict {
  step: StepKey | null; level: Level; owner: string | null;
  sarAtStake?: number | null;
  confidence?: Confidence; coverage?: number | null;
  // The range the judge says the closing rate could be in, given the attribution gap (percent)
  range?: { best: number; worst: number } | null;
  rule?: string; whatWouldChange?: string;
}
export interface Claim {
  from: string; to: string; plat?: string | undefined; by: 'lead' | 'paid';
  verdict: ClaimVerdict; steps: ClaimStep[];
  // How the judge computes SAR at stake: 'shortfall' = spend × (1 − now / target) on a rate step
  sarMethod?: 'shortfall';
  minSample?: Partial<Record<'impr' | 'clicks' | 'results' | 'crmLeads', number>>;
}

// A finding of the auditor. `contradicts` = the verdict is wrong or unsupported; `weakens` = it may be right but the data
// does not carry it; `info` = worth knowing. `needs` = what data would settle it.
export interface Finding {
  id: string; kind: 'integrity' | 'consistency' | 'challenge';
  effect: 'contradicts' | 'weakens' | 'info';
  step: StepKey | 'verdict';
  text: Bi; needs?: Bi;
}
export interface StepAudit { status: Status; findings: Finding[] }
export interface AuditResult {
  status: Status;                       // the headline verdict's status
  verdict: StepAudit;
  steps: Partial<Record<StepKey, StepAudit>>;
  findings: Finding[];                  // every finding, once
  checked: number;                      // how many individual checks ran (a skipped check is not counted)
}

export const rankStatus: Record<Status, number> = { confirmed: 0, weakened: 1, contradicted: 2 };
export const statusOf = (fs: Finding[]): Status =>
  fs.some(f => f.effect === 'contradicts') ? 'contradicted' : fs.some(f => f.effect === 'weakens') ? 'weakened' : 'confirmed';

// The auditor's own copy of the rule table (ids, not the judge's text). A test ties it to the judge's OWNERS so a change
// on one side fails the build instead of passing silently.
export const OWNER_RULE: Record<StepKey | 'crm', Bi> = {
  cpm: { ar: 'المشتري الإعلامي', en: 'Media buyer' },
  click: { ar: 'الإنتاج / الكريتيف', en: 'Production / creative' },
  lead: { ar: 'الإنتاج + صفحة الهبوط / النموذج', en: 'Production + landing page / form' },
  sale: { ar: 'المبيعات', en: 'Sales' },
  cpl: { ar: 'المشتري الإعلامي', en: 'Media buyer' },
  cpa: { ar: 'المشتري الإعلامي', en: 'Media buyer' },
  roas: { ar: 'التسويق / الإدارة', en: 'Marketing / management' },
  crm: { ar: 'نظام العملاء / العمليات', en: 'CRM / operations' },
};

// Thresholds of the auditor. Its own, on purpose: they do not follow the judge's constants silently.
export interface AuditConfig {
  floors: Record<'click' | 'lead' | 'sale', number>;
  watch: number;                         // a step is weak only if this much below every reference
  minSample: Record<'impr' | 'clicks' | 'results' | 'crmLeads', number>;
  coverageHigh: number; coverageLow: number;
  immatureShare: number;                 // share of the period's CRM leads still younger than the usual close time
  prevMinDays: number;                   // share of the comparison period's days that must have data
  tol: number;                           // absolute tolerance on quoted numbers (they may be rounded to 2 decimals)
}
export const DEFAULT_CONFIG: AuditConfig = {
  floors: { click: 0.7, lead: 1.5, sale: 2 }, watch: 0.85,
  minSample: { impr: 1000, clicks: 100, results: 30, crmLeads: 30 },
  coverageHigh: 0.6, coverageLow: 0.3, immatureShare: 0.25, prevMinDays: 0.7, tol: 0.006,
};
