import { Badge } from '@/components/ui/badge';
import { pageLang } from './lang';
import { bestAd, bestDelivery, deliveryOf, deliveryWord, reasonText, type Delivery, type DeliveryFields } from './delivery';

const DOT: Record<Delivery, string> = {
  delivering: 'bg-emerald-600', no_spend: 'bg-amber-500', rejected: 'bg-rose-500', in_review: 'bg-slate-400', scheduled: 'bg-slate-400', ended: 'bg-slate-300', budget: 'bg-amber-500', off: 'bg-slate-300',
};

// One ad (`ad`) or a group of ads (`ads`). Shows the delivery word, the number of days for "on, not spending", and the reason on hover.
export function DeliveryBadge({ ad, ads }: { ad?: DeliveryFields; ads?: DeliveryFields[] }) {
  const list = ads ?? (ad ? [ad] : []);
  const d = ads ? bestDelivery(list) : deliveryOf(ad);
  const src = (ads ? bestAd(list) : ad) ?? {};
  const en = pageLang() === 'en';
  const days = d === 'no_spend' && (src.delivery_days ?? 0) > 0 ? ` · ${src.delivery_days} ${en ? (src.delivery_days === 1 ? 'day' : 'days') : (src.delivery_days === 1 ? 'يوم' : 'أيام')}` : '';
  const why = d !== 'delivering' && d !== 'off' ? src.delivery_reason || '' : '';
  return (
    <Badge variant={d === 'delivering' ? 'default' : 'outline'} data-delivery={d} title={why ? reasonText(why, en) : undefined} className="gap-1.5">
      <span className={`inline-block size-1.5 rounded-full ${DOT[d]}`} aria-hidden="true" />
      {deliveryWord(d, en)}{days}
    </Badge>
  );
}
