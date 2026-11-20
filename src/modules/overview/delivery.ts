// Delivery layer (pipeline/delivery.py). `live` only means "switched on"; `delivery` says whether the ad is really
// delivering, and if not, why. Pure helpers shared by the creatives views. An old dash.json without `delivery` falls back to the switch.

export type Delivery = 'delivering' | 'rejected' | 'in_review' | 'scheduled' | 'ended' | 'budget' | 'off' | 'unknown';
export const DELIVERY_ORDER: Delivery[] = ['delivering', 'rejected', 'in_review', 'scheduled', 'ended', 'budget', 'off', 'unknown'];

export interface DeliveryFields { live?: boolean | undefined; delivery?: string | undefined; delivery_reason?: string | undefined; delivery_days_no_spend?: number | undefined }

export function deliveryOf(a?: DeliveryFields | null): Delivery {
  const d = a?.delivery as Delivery | undefined;
  return d && DELIVERY_ORDER.includes(d) ? d : a?.live ? 'delivering' : 'off';
}

// A group of ads (an idea, a version): the best state wins, an all-off group is off.
export function bestDelivery(list: Array<DeliveryFields | null | undefined>): Delivery {
  let best: Delivery = 'off';
  for (const a of list) { const d = deliveryOf(a); if (DELIVERY_ORDER.indexOf(d) < DELIVERY_ORDER.indexOf(best)) best = d; }
  return best;
}

const AR: Record<Delivery, string> = {
  delivering: 'يصرف', rejected: 'مرفوض', in_review: 'قيد المراجعة', scheduled: 'مجدول', ended: 'انتهى', budget: 'الميزانية خلصت', off: 'متوقف', unknown: 'غير معروف',
};
const EN: Record<Delivery, string> = {
  delivering: 'Delivering', rejected: 'Rejected', in_review: 'In review', scheduled: 'Scheduled', ended: 'Ended', budget: 'Budget used up', off: 'Paused', unknown: 'Unknown',
};
export const deliveryWord = (d: Delivery, en: boolean): string => (en ? EN : AR)[d];

// The ad to take the reason and days from for a group: the first one in the best state
export function bestAd<T extends DeliveryFields>(list: T[]): T | undefined {
  const d = bestDelivery(list);
  return list.find(a => deliveryOf(a) === d);
}

// The pipeline writes a fixed set of Arabic reasons (pipeline/delivery.py REASON); any other text (a platform status word) shows as is.
const REASON_EN: Record<string, string> = {
  'مرفوض من المنصة': 'Rejected by the platform',
  'قيد المراجعة عند المنصة': 'In review at the platform',
  'مجدول ولم يبدأ بعد': 'Scheduled, not started yet',
  'انتهت مدة الجدولة': 'The schedule has ended',
  'مفعّل، وصل حد الصرف (الميزانية خلصت)': 'Switched on, the spend limit was reached (budget used up)',
  'ما قدرنا نقرأ الحالة من المنصة': 'We could not read the status from the platform',
};
export const reasonText = (reason: string, en: boolean): string => (en ? REASON_EN[reason] ?? reason : reason);

// Secondary note, never the verdict: switched on and no spend or impressions for N days (delivery_days_no_spend)
export const noSpendDays = (a?: DeliveryFields | null): number => (a?.live && (a.delivery_days_no_spend ?? 0) > 0 ? (a.delivery_days_no_spend as number) : 0);
