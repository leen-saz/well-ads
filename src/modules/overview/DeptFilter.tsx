// The department filter: one department or all. The choice lives in the address (?dept=iv), so a link shares it and a reload keeps it.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DeptOption } from './dept';
import { T } from './lang';

export const DEPT_PARAM = 'dept';
export const readDept = (): string | null => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(DEPT_PARAM));
export function writeDept(key: string): void {
  try {
    const u = new URL(window.location.href);
    if (key === 'all') u.searchParams.delete(DEPT_PARAM); else u.searchParams.set(DEPT_PARAM, key);
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
  } catch { /* the address stays as it was */ }
}

// withAll: false for a department manager, who has no «all»
export function DeptFilter({ value, options, withAll = true, onChange }: { value: string; options: DeptOption[]; withAll?: boolean; onChange: (key: string) => void }) {
  if (options.length < 2 && !withAll) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-52" aria-label={T('القسم', 'Department')}><SelectValue /></SelectTrigger>
      <SelectContent>
        {withAll && <SelectItem value="all">{T('كل الأقسام', 'All departments')}</SelectItem>}
        {options.map(o => <SelectItem key={o.key} value={o.key}>{o.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
