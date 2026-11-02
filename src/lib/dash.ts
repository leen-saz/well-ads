// Phase 4.2 (docs/phase-4.md): which copy of the dashboard data a user may read (build.py writes them) and where
// it sits in R2. Used by /api/dash/data.
import { can, type Session, type Cfg } from './auth';
import { WELL_COMPANY } from './tenant';

const DEPT = /^[a-z]+$/;

// Which copy this user may read, or null. `pick` = ?d= for a manager of several departments.
export function dataCopy(s: Session, cfg: Cfg, pick: string | null): string | null {
  const scope: string[] = Array.isArray(s.depts) ? s.depts : [];
  if (scope.length && (can(s, 'ceo', cfg) || can(s, 'creative', cfg))) {
    const d = pick && scope.includes(pick) ? pick : scope[0];
    return d && DEPT.test(d) ? `dept/${d}.json` : null;
  }
  if (can(s, 'ceo', cfg)) return 'all.json';
  if (can(s, 'creative', cfg)) return 'c.json';
  return null;
}

// Well's copies are where the pipeline uploads them today; other companies get their own prefix once the pull runs
// per company, and until then simply have no data (never Well's).
export const dataKey = (company: string, copy: string): string =>
  company === WELL_COMPANY ? `site/data/${copy}` : `companies/${company}/data/${copy}`;
