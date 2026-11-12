import { describe, expect, it } from 'vitest';
import health from '../../public/modules/health/client.js?raw';
import { LINKED_DEF_AR, linkedShare } from './linked';
import { joinRates } from '../modules/maestro/datahealth';

const crm = { total: 10, unmatched: 4, rows: [['m1', 'd', 'd', 1, 5], ['m1', 'd', 'd', 1, 7], ['m2', 'd', '', 0, 0], ['m3', 'd', '', 0, 0], ['m4', 'd', '', 0, 0], ['m5', 'd', '', 0, 0]],
  paid_all: [[], [], [], [], []] };

describe('linked to an ad: one definition', () => {
  it('counts linked leads and closings and the unattributed rest', () => {
    expect(linkedShare(crm)).toEqual({ leads: 10, linked: 6, unlinked: 4, leadsPct: 60, closings: 5, closingsLinked: 2, closingsUnlinked: 3, closingsPct: 40 });
  });
  it('linked closings never exceed all closings, and a missing block is null', () => {
    expect(linkedShare({ total: 1, rows: [['m', 'd', 'd', 1, 1], ['m', 'd', 'd', 1, 1]], paid_all: [[]] })?.closingsUnlinked).toBe(0);
    expect(linkedShare(undefined)).toBeNull();
    expect(linkedShare({ rows: 3 })).toBeNull();
  });
  it('the data-health page reads the same numbers', () => {
    const j = joinRates(crm), L = linkedShare(crm)!;
    expect([j.matched, j.matched_pct, j.closings_all, j.closings_with_ad, j.closings_unattributed, j.closings_pct]).toEqual([L.linked, L.leadsPct, L.closings, L.closingsLinked, L.closingsUnlinked, L.closingsPct]);
  });
  it('the page script states the same definition as the shared one', () => {
    expect(health).toContain(LINKED_DEF_AR);
  });
});
