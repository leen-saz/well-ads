// Types for 00-judge.js (a plain script the main page inlines; Overview imports it through src/modules/overview/judge.ts)
export type Lang = 'ar' | 'en';
export type Severity = 'fine' | 'watch' | 'problem' | 'disaster' | 'na';
export type Confidence = 'high' | 'medium' | 'low';
export type StepKey = 'click' | 'lead' | 'sale' | 'cpl' | 'cpa' | 'roas';
export type OwnerKey = 'creative' | 'landing' | 'sales' | 'buyer' | 'mgmt' | 'crm';
export interface Targets { ctr: number; clickToLead: number; leadToClose: number; cpl: number; costShare: number; roas: number; maturityDays: number; costPerPayer?: number }
export interface Field { key: keyof Targets; unit: '%' | 'sar' | 'share' | 'x' | 'days'; label: [string, string] }
export interface Formats { pct(v: number): string; sar(v: number): string; x(v: number): string; qty(v: number): string; num(v: number, digits: number): string }
export interface Cohort { mature: number; young: number; matureClosings: number; medianDays: number | null; cut: string }
export interface Input {
  top: { impr: number; clicks: number; results: number; spend: number; cpl: number | null;
    /** WhatsApp-destination ads (no platform leads): their spend and clicks, and the clicks of the ads that can report leads */
    waSpend?: number; waClicks?: number; leadClicks?: number };
  sale: { crm: boolean; results: number; spend: number; closings: number; paid: number; adClosings: number; adLeads: number; wide: boolean };
  cohort: Cohort | null;
}
export interface Step {
  key: StepKey; kind: 'rate' | 'cost' | 'ratio'; link: number; label: string; now: number | null; target: number | null;
  ownerKey: OwnerKey; owner: string; fix: string; unattributed: boolean;
  level: Severity; ratio: number | null; score: number | null; small: boolean; sar: number | null; confidence: Confidence;
  line: string; evidence: string; rule: string; change: string; range: { worst: number; best: number | null } | null; waDest?: boolean;
}
export interface Verdict {
  level: Severity; step: StepKey | null; stage: string; title: string; owner: string | null; why: string; todo: string;
  evidence: string; sar: number | null; confidence: Confidence; rule: string; change: string;
  steps: Step[];
  e2e: { now: number; target: number; level: Severity; line: string } | null;
  losses: { key: OwnerKey; owner: string; sar: number }[];
  biggest: string | null;
  trust: { coverage: number | null; confidence: Confidence; line: string };
  cohort: (Cohort & { line: string }) | null;
  unlinked: { owner: string; why: string; todo: string } | null;
  targets: Targets & { cpa: number | null };
  wa: { spend: number; clicks: number; cpc: number | null; only: boolean; line: string } | null;
  payer: Payer;
}
export interface Payer { value: number | null; target: number | null; level: Severity; text: string; closings: number; note: string }
export interface Judge {
  DEFAULTS: Targets; FIELDS: Field[]; MIN: { clicks: number; leads: number };
  SEV: Record<Severity, [string, string]>; RANK: Record<Severity, number>;
  RULES: { key: StepKey; owner: OwnerKey; kind: 'rate' | 'cost' | 'ratio'; target: string }[];
  OWNERS: Record<OwnerKey, { who: [string, string]; fix: [string, string] }>;
  targets(...layers: unknown[]): Targets;
  cohort(byDay: [string, number][], paid: [string, string | null][], from: string, to: string, asOf: string, maturityDays: number): Cohort;
  payer(sale: Input['sale'], target: number | null, l: Lang, f: Formats): Payer;
  judge(input: Input, targets: Targets, l: Lang, f: Formats): Verdict;
  pick(l: Lang, x: [string, string]): string;
}
declare global { var WELL_JUDGE: Judge }
