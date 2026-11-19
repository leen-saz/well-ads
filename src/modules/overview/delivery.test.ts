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
    expect(bestDelivery([{ live: true, delivery: 'no_spend' }, { live: true, delivery: 'delivering' }])).toBe('delivering');
    expect(bestDelivery([{ live: false, delivery: 'off' }, { live: true, delivery: 'scheduled' }])).toBe('scheduled');
    expect(bestDelivery([])).toBe('off');
    expect(bestAd([{ live: true, delivery: 'ended', delivery_reason: 'x' }, { live: false, delivery: 'off' }])?.delivery_reason).toBe('x');
  });
  it('words in both languages, reasons translated', () => {
    expect(deliveryWord('delivering', false)).toBe('يصرف');
    expect(deliveryWord('no_spend', true)).toBe('On, not spending');
    expect(reasonText('مرفوض من المنصة', true)).toBe('Rejected by the platform');
    expect(reasonText('المجموعة متوقفة', true)).toBe('المجموعة متوقفة');
  });
  it('badge snapshot: delivering, on-but-not-spending with days and reason, rejected', () => {
    const html = (ad: object) => renderToStaticMarkup(createElement(DeliveryBadge, { ad }));
    expect(html({ live: true, delivery: 'delivering' })).toContain('يصرف');
    const idle = html({ live: true, delivery: 'no_spend', delivery_days: 5, delivery_reason: 'مفعّل لكن بدون صرف أو ظهور آخر 3 أيام' });
    expect(idle).toContain('نشط بدون صرف · 5 أيام');
    expect(idle).toContain('data-delivery="no_spend"');
    expect(idle).toContain('title="مفعّل لكن بدون صرف أو ظهور آخر 3 أيام"');
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
