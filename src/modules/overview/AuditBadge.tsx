// A short result badge next to the verdict, for the OWNER ONLY («المدقق»): the auditor re-checks what the judge says on the same
// data and says confirmed / weaker than it looks / contradicted, with a link to the audit page. Anyone else gets nothing at all:
// no element, no wording, no request beyond the one that tells whether they are the owner.
import * as React from 'react';
import { audit } from '../auditor/audit';
import { claimFromJudge } from '../auditor/adapter';
import type { Raw } from '../auditor/facts';
import type { Dash } from './numbers';
import type { CrmBy } from './analytics';
import { pageLang, pick } from './lang';

let owner: Promise<boolean> | null = null;
const isOwner = (): Promise<boolean> => (owner ??= fetch('/api/account/password', { credentials: 'same-origin' }).then(r => (r.ok ? (r.json() as Promise<{ role?: string }>) : null)).then(j => j?.role === 'owner').catch(() => false));

const TEXT = { ar: { confirmed: 'مؤكَّد', weakened: 'أضعف مما يبدو', contradicted: 'مناقَض', label: 'تدقيق' }, en: { confirmed: 'Confirmed', weakened: 'Weaker than it looks', contradicted: 'Contradicted', label: 'Audit' } } as const;
const TONE = { confirmed: 'border-primary/40 text-primary', weakened: 'border-amber-500/50 text-amber-700 dark:text-amber-400', contradicted: 'border-destructive/50 text-destructive' } as const;

export function AuditBadge({ data, from, to, by, plat }: { data: Dash; from: string; to: string; by: CrmBy; plat?: string | undefined }) {
  const [owns, setOwns] = React.useState(false);
  React.useEffect(() => { let on = true; isOwner().then(v => { if (on) setOwns(v); }); return () => { on = false; }; }, []);
  const r = React.useMemo(() => (owns ? audit(data as Dash & Raw, claimFromJudge(data, from, to, by, plat)) : null), [owns, data, from, to, by, plat]);
  if (!r) return null;
  const l = pageLang(), t = TEXT[l], first = r.verdict.findings.find(f => f.effect !== 'info');
  return (
    <a href={`/maestro/audit/${l === 'en' ? '?lang=en' : ''}`} data-astro-reload title={first ? first.text[l] : pick(l, 'ما لقينا شي يناقض الحكم', 'Nothing found against the verdict')}
      className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs no-underline ${TONE[r.status]}`} data-testid="audit-badge">
      <span className="text-muted-foreground">{t.label}:</span><b>{t[r.status]}</b>
    </a>
  );
}
