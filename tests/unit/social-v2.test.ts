// Publishing v2 (docs/PRD.md §3.2, milestone M6): text per platform, queue slots in Riyadh time
import { describe, expect, it } from 'vitest';
import { validate, bodyFor, cleanOverrides, publishPost } from '../../src/modules/social/social';
import { cleanSlot, nextSlot, slotTimes, LEAD_MS } from '../../src/modules/social/slots';

const NOW = Date.parse('2026-11-20T09:00:00Z');   // Friday 12:00 Riyadh
const at = new Date(NOW + 3600_000).toISOString();

describe('text per platform', () => {
  it('keeps only chosen platforms whose text really differs', () => {
    expect(cleanOverrides({ x: { body: ' short ' }, linkedin: { body: 'base' }, tiktok: { body: 'not chosen' } }, ['x', 'linkedin'], 'base')).toEqual({ x: { body: 'short' } });
    expect(cleanOverrides('nope', ['x'], 'b')).toEqual({});
  });
  it('each platform is checked against its own text', () => {
    const long = 'ا'.repeat(400);
    // the shared text is too long for X, but X has its own short text: accepted
    const ok = validate({ platforms: ['facebook', 'x'], body: long, overrides: { x: { body: 'نص قصير لـ X' } }, publish_at: at }, NOW, [], () => true);
    expect(ok.error).toBeUndefined();
    expect(ok.draft!.overrides).toEqual({ x: { body: 'نص قصير لـ X' } });
    // without it: refused, naming X
    const bad = validate({ platforms: ['facebook', 'x'], body: long, publish_at: at }, NOW, [], () => true);
    expect(bad.error).toMatch(/X/);
  });
  it('no overrides: the draft is exactly as before (no new field)', () => {
    const v = validate({ platforms: ['facebook'], body: 'نص', publish_at: at }, NOW, [], () => true);
    expect(v.draft).toEqual({ platforms: ['facebook'], body: 'نص', media: [], publish_at: new Date(Date.parse(at)).toISOString(), mode: 'manual' });
  });
  it('bodyFor falls back to the shared text', () => {
    expect(bodyFor({ body: 'a', overrides: { x: { body: 'b' } } }, 'x')).toBe('b');
    expect(bodyFor({ body: 'a', overrides: { x: { body: 'b' } } }, 'facebook')).toBe('a');
    expect(bodyFor({ body: 'a', overrides: null }, 'x')).toBe('a');
  });
  it('publishing sends each platform its own text', async () => {
    const sent: Record<string, string> = {};
    const f = (async (url: string, init?: RequestInit) => {
      const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body ?? ''));
      if (String(url).includes('/feed')) sent.facebook = body.get('message') || '';
      return new Response(JSON.stringify({ id: 'p_1' }));
    }) as typeof fetch;
    await publishPost({ platforms: ['facebook'], body: 'shared', media: [], publish_at: at, mode: 'manual', overrides: { facebook: { body: 'own text' } } },
      { META_PAGE_ACCESS_TOKEN: 't', META_PAGE_ID: '1' }, f);
    expect(sent.facebook).toBe('own text');
  });
});

describe('queue slots', () => {
  it('cleans a slot or refuses it', () => {
    expect(cleanSlot({ weekday: 0, at_local: '20:00' })).toEqual({ weekday: 0, at_local: '20:00' });
    expect(cleanSlot({ weekday: 7, at_local: '20:00' })).toBeNull();
    expect(cleanSlot({ weekday: 1, at_local: '25:00' })).toBeNull();
    expect(cleanSlot({ weekday: 1, at_local: '9:00' })).toBeNull();
  });
  it('Riyadh time: Sunday 20:00 Riyadh is 17:00 UTC', () => {
    const t = slotTimes([{ weekday: 0, at_local: '20:00' }], NOW, 7);
    expect(new Date(t[0]!).toISOString()).toBe('2026-11-22T17:00:00.000Z');
  });
  it('a slot just after Riyadh midnight lands on the right day (UTC is still the day before)', () => {
    const t = slotTimes([{ weekday: 6, at_local: '01:30' }], NOW, 7);   // Saturday 01:30 Riyadh = Friday 22:30 UTC
    expect(new Date(t[0]!).toISOString()).toBe('2026-11-20T22:30:00.000Z');
  });
  it('first free slot, skipping taken ones and slots closer than the lead time', () => {
    const slots = [{ weekday: 5, at_local: '12:05' }, { weekday: 5, at_local: '18:00' }, { weekday: 0, at_local: '20:00' }];
    // Friday 12:05 is within LEAD_MS of now: skipped
    expect(LEAD_MS).toBeGreaterThan(5 * 60_000);
    expect(nextSlot(slots, [], NOW)).toBe('2026-11-20T15:00:00.000Z');
    expect(nextSlot(slots, ['2026-11-20T15:00:00.000Z'], NOW)).toBe('2026-11-22T17:00:00.000Z');
    expect(nextSlot([], [], NOW)).toBeNull();
  });
});
