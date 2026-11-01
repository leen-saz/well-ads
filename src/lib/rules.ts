// New-campaign rules, same as pipeline/modules/core/rules.py
const OBJECTIVES = ['leads', 'sales'];

export function check(f: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (!OBJECTIVES.includes(String(f.objective))) issues.push('الهدف لازم Sales أو Leads');
  if (f.advantage_plus) issues.push('بدون Advantage+');
  if (Number(f.age_min) < 30) issues.push('العمر يبدأ من 30');
  if (f.budget !== '' && !(Number(f.budget) > 0)) issues.push('الميزانية لازم رقم أكبر من صفر');
  return issues;
}

