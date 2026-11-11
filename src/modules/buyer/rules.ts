// The company's own media-buyer rules: validation of what the owner saves. Names and limits are the company's business data,
// so they live in control_settings.guardrails.buyer (database), never in this repo. Pure: no network.
import type { CompanyRule, Owner, RuleKind } from './buyer';
import { PLATS, type Plat } from './playbook';

const KINDS: RuleKind[] = ['scale', 'stop_idle', 'resume', 'reduce', 'replace_creative', 'alert_stalled'];
const OWNERS: Owner[] = ['media_buyer', 'video_agent', 'production', 'landing'];
const pos = (v: unknown, max: number) => { const n = Number(v); return v != null && v !== '' && isFinite(n) && n > 0 && n <= max ? n : undefined; };
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

export function cleanRules(input: unknown): { rules: CompanyRule[] } | { error: string } {
  if (!Array.isArray(input) || input.length > 100) return { error: 'القواعد لازم تكون قائمة، وأقصاها 100' };
  const out: CompanyRule[] = [], seen = new Set<string>();
  for (const raw of input) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = text(r.id, 60), kind = r.kind as RuleKind, platform = r.platform as Plat;
    const match = Array.isArray(r.match) ? r.match.map(m => text(m, 80)).filter((m): m is string => !!m).slice(0, 20) : [];
    if (!id || seen.has(id)) return { error: 'كل قاعدة لها معرّف فريد' };
    if (!KINDS.includes(kind) || !PLATS.includes(platform)) return { error: `نوع أو منصة غير معروفة في القاعدة ${id}` };
    if (!match.length) return { error: `القاعدة ${id} تحتاج اسم حملة أو إعلان تطابقه` };
    if ((kind === 'scale' || kind === 'resume') && !pos(r.maxCpl, 10000)) return { error: `القاعدة ${id} تحتاج حد تكلفة الليد (maxCpl)` };
    if (kind === 'replace_creative' && !pos(r.minCtr, 100)) return { error: `القاعدة ${id} تحتاج حد نسبة النقر (minCtr)` };
    seen.add(id);
    const owner = OWNERS.includes(r.owner as Owner) ? (r.owner as Owner) : undefined;
    out.push({ id, kind, platform, match, ...(pos(r.maxCpl, 10000) ? { maxCpl: pos(r.maxCpl, 10000)! } : {}), ...(pos(r.stepPct, 100) ? { stepPct: pos(r.stepPct, 100)! } : {}),
      ...(pos(r.everyDays, 30) ? { everyDays: pos(r.everyDays, 30)! } : {}), ...(pos(r.minIdleDays, 90) ? { minIdleDays: pos(r.minIdleDays, 90)! } : {}),
      ...(pos(r.minCtr, 100) ? { minCtr: pos(r.minCtr, 100)! } : {}), ...(pos(r.minResults, 1000) ? { minResults: pos(r.minResults, 1000)! } : {}),
      ...(r.judgeBy === 'cpl' || r.judgeBy === 'ctr' ? { judgeBy: r.judgeBy } : {}), ...(owner ? { owner } : {}),
      ...(text(r.followUp, 600) ? { followUp: text(r.followUp, 600)! } : {}), ...(text(r.open, 300) ? { open: text(r.open, 300)! } : {}) });
  }
  return { rules: out };
}
