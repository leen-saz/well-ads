// Delivery layer (pipeline/delivery.py). `live` only means "switched on"; `delivery` says whether the ad is really
// delivering, and if not, why. Pure helpers shared by the creatives views. An old dash.json without `delivery` falls back to the switch.

export type Delivery = 'delivering' | 'no_spend' | 'rejected' | 'in_review' | 'scheduled' | 'ended' | 'budget' | 'off';
export const DELIVERY_ORDER: Delivery[] = ['delivering', 'no_spend', 'rejected', 'in_review', 'scheduled', 'ended', 'budget', 'off'];

export interface DeliveryFields { live?: boolean | undefined; delivery?: string | undefined; delivery_reason?: string | undefined; delivery_days?: number | undefined }

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
  delivering: 'يصرف', no_spend: 'نشط بدون صرف', rejected: 'مرفوض', in_review: 'قيد المراجعة', scheduled: 'مجدول', ended: 'انتهى', budget: 'الميزانية خلصت', off: 'متوقف',
};
const EN: Record<Delivery, string> = {
  delivering: 'Delivering', no_spend: 'On, not spending', rejected: 'Rejected', in_review: 'In review', scheduled: 'Scheduled', ended: 'Ended', budget: 'Budget used up', off: 'Paused',
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
  'الميزانية خلصت': 'The budget is used up',
  'مفعّل لكن بدون صرف أو ظهور آخر 3 أيام': 'On, but no spend or impressions in the last 3 days',
  'مفعّل لكن بدون صرف أو ظهور آخر 3 أيام (حالة المراجعة والجدولة من المنصة غير متاحة الحين، والحكم من الصرف الفعلي فقط)': 'On, but no spend or impressions in the last 3 days (platform review and schedule status unavailable, judged by actual spend only)',
  'حالة المراجعة والجدولة من المنصة غير متاحة الحين، والحكم من الصرف الفعلي فقط': 'The platform review and schedule status is unavailable right now, judged by actual spend only',
};
export const reasonText = (reason: string, en: boolean): string => (en ? REASON_EN[reason] ?? reason : reason);
