import { Badge } from '@/components/ui/badge';
import { pageLang } from './lang';
import { bestAd, bestDelivery, deliveryOf, deliveryWord, noSpendDays, reasonText, type Delivery, type DeliveryFields } from './delivery';

const DOT: Record<Delivery, string> = {
  delivering: 'bg-emerald-600', rejected: 'bg-rose-500', in_review: 'bg-slate-400', scheduled: 'bg-slate-400', ended: 'bg-slate-300', budget: 'bg-amber-500', off: 'bg-slate-300', unknown: 'bg-slate-400',
};

// One ad (`ad`) or a group of ads (`ads`). The word is the platform's verdict (pipeline/delivery.py). "No spend for N days"
// is a secondary note under it, never the verdict. The reason shows on hover and under the badge.
export function DeliveryBadge({ ad, ads }: { ad?: DeliveryFields; ads?: DeliveryFields[] }) {
  const list = ads ?? (ad ? [ad] : []);
  const d = ads ? bestDelivery(list) : deliveryOf(ad);
  const src = (ads ? bestAd(list) : ad) ?? {};
  const en = pageLang() === 'en';
  const n = d === 'off' ? 0 : noSpendDays(src);
  const why = d !== 'delivering' && d !== 'off' ? src.delivery_reason || '' : '';
  return (
    <span className="inline-grid gap-0.5">
      <Badge variant={d === 'delivering' ? 'default' : 'outline'} data-delivery={d} title={why ? reasonText(why, en) : undefined} className="gap-1.5">
        <span className={`inline-block size-1.5 rounded-full ${DOT[d]}`} aria-hidden="true" />
        {deliveryWord(d, en)}
      </Badge>
      {why && <span className="text-[11px] text-muted-foreground">{reasonText(why, en)}</span>}
      {n > 0 && <span data-note="no-spend" className="text-[11px] text-amber-700">{en ? `No spend for ${n} ${n === 1 ? 'day' : 'days'}` : `بدون صرف من ${n} ${n === 1 ? 'يوم' : 'أيام'}`}</span>}
    </span>
  );
}
