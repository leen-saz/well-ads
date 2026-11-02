// Learning loop per tab (docs/learning-loops.md, L1): every tab's lessons live in one table, per company and tab.
// A tab's lessons are read with that tab's view level and decided with its approve level.
import { isModule } from '../modules/registry';
import type { Need } from './auth';

export const STATUSES = ['new', 'reviewed', 'approved', 'ignored', 'exported'] as const;
export type Status = typeof STATUSES[number];

// Lessons from the ads loop belong to the decision board; any other tab is its module key
export function needOf(module: string): Need | null {
  if (module === 'ads') return 'control';
  return isModule(module) ? (module as Need) : null;
}

// approve / ignore: only a lesson nobody decided yet (or one Maestro reviewed)
export const decision = (action: unknown): Status | null => action === 'approve' ? 'approved' : action === 'ignore' ? 'ignored' : null;
