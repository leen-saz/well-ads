// التغيّر عن الفترة السابقة، ومكتوب جنبه وش يقارن عشان ما يطلع رقم بدون معنى (مثل اللوحة الرئيسية: «▲ 12% عن الفترة السابقة»).
import { change } from './numbers';

export const VS = 'عن الفترة السابقة';

// lowerIsBetter colours a drop in cost as good news; null = neither. Nothing when there is no valid comparison.
export function Delta({ now, was, lowerIsBetter, className = '' }: { now: number | null; was: number | null; lowerIsBetter: boolean | null; className?: string }) {
  const d = change(now, was);
  if (d == null) return null;
  const good = lowerIsBetter == null ? null : lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={`text-xs tabular-nums ${good == null ? 'text-muted-foreground' : good ? 'text-primary' : 'text-destructive'} ${className}`}>
      {d > 0 ? '▲' : '▼'} <span dir="ltr">{Math.abs(d).toFixed(1)}%</span> <span className="text-muted-foreground">{VS}</span>
    </span>
  );
}
