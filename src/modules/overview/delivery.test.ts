import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { bestAd, bestDelivery, deliveryOf, deliveryWord, reasonText } from './delivery';
import { DeliveryBadge } from './DeliveryBadge';
import { byAd, type Dash } from './numbers';

describe('delivery layer', () => {
  it('reads delivery, and falls back to the switch for an older dash.json', () => {
    expect(deliveryOf({ live: true, delivery: 'rejected' })).toBe('rejected');
    expect(deliveryOf({ live: true })).toBe('delivering');
    expect(deliveryOf({ live: false })).toBe('off');
    expect(deliveryOf({ live: true, delivery: 'nonsense' })).toBe('delivering');
    expect(deliveryOf(undefined)).toBe('off');
  });
  it('a group takes its best state', () => {
    expect(bestDelivery([{ live: true, delivery: 'unknown' }, { live: true, delivery: 'delivering' }])).toBe('delivering');
    expect(bestDelivery([{ live: false, delivery: 'off' }, { live: true, delivery: 'scheduled' }])).toBe('scheduled');
    expect(bestDelivery([])).toBe('off');
    expect(bestAd([{ live: true, delivery: 'ended', delivery_reason: 'x' }, { live: false, delivery: 'off' }])?.delivery_reason).toBe('x');
  });
  it('words in both languages, reasons translated', () => {
    expect(deliveryWord('delivering', false)).toBe('يصرف');
    expect(deliveryWord('unknown', true)).toBe('Unknown');
    expect(reasonText('مرفوض من المنصة', true)).toBe('Rejected by the platform');
    expect(reasonText('المجموعة متوقفة', true)).toBe('المجموعة متوقفة');
  });
  it('badge snapshot: delivering, on-but-not-spending with days and reason, rejected', () => {
    const html = (ad: object) => renderToStaticMarkup(createElement(DeliveryBadge, { ad }));
    expect(html({ live: true, delivery: 'delivering' })).toContain('يصرف');
    // the verdict stays the platform's; "no spend for N days" is a secondary note
    const note = html({ live: true, delivery: 'delivering', delivery_days_no_spend: 5 });
    expect(note).toContain('data-delivery="delivering"');
    expect(note).toContain('بدون صرف من 5 أيام');
    expect(html({ live: false, delivery: 'off', delivery_days_no_spend: 5 })).not.toContain('بدون صرف');
    const unk = html({ live: true, delivery: 'unknown', delivery_reason: 'ما قدرنا نقرأ الحالة من المنصة' });
    expect(unk).toContain('غير معروف'); expect(unk).toContain('title="ما قدرنا نقرأ الحالة من المنصة"');
    const bad = html({ live: true, delivery: 'rejected', delivery_reason: 'مرفوض من المنصة' });
    expect(bad).toContain('مرفوض'); expect(bad).not.toContain('يصرف');
    expect(html({ live: false, delivery: 'off', delivery_reason: 'متوقف' })).not.toContain('title=');
  });
  it('the ads table carries delivery next to live, and live is untouched', () => {
    const d: Dash = {
      range: { start: '2026-11-01', end: '2026-11-02', today: '2026-11-03' },
      ads: { a: { name: 'x', campaign: 'c', platform: 'snap', live: true, delivery: 'rejected', delivery_reason: 'مرفوض من المنصة' } },
      rows: [['a', '2026-11-02', 10, 100, 5, 1, 0]],
    };
    const r = byAd(d, '2026-11-01', '2026-11-02')[0]!;
    expect(r.live).toBe(true); expect(r.delivery).toBe('rejected');
  });
});
